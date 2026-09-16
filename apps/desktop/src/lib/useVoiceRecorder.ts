/** The microphone-recording mechanics behind every "talk instead of typing" surface in
 * this app: get a MediaStream, run a real MediaRecorder over it, and hand each finished
 * blob to the existing Pro-gated POST /voice/transcribe (see api.ts's transcribeAudio).
 *
 * Extracted from NotepadWindow.tsx, which had the only working implementation, when the
 * main chat composer needed the same thing. What's shared is genuinely only the
 * mechanics — permission, stream lifecycle, recorder lifecycle, segment timing, the
 * elapsed clock, and the transcribe call. What each caller does with the resulting TEXT
 * is entirely its own business and stays there: the Notepad appends it to the open
 * note's markdown, the composer inserts it into the draft at the cursor. That's the
 * whole reason this is a hook taking an `onTranscript` callback rather than anything
 * that knows about notes or drafts.
 *
 * `segmentMs` is the one real behavioral difference between the two callers, and it
 * falls out of the same code path rather than branching it:
 *   - set (the Notepad's lecture capture): the recorder is stopped and immediately
 *     restarted on that interval, each finished segment transcribed and delivered as
 *     soon as it's ready, so a failure mid-lecture loses at most one segment rather
 *     than the whole recording.
 *   - unset (the composer's dictate-a-message button): one recording, transcribed once
 *     when the student stops it. A chat message is short; there's nothing to protect
 *     against by chopping it up, and partial deliveries would just fragment the draft.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, transcribeAudio } from "../api";

export interface UseVoiceRecorderOptions {
  /** Access token for the transcribe call. Nullable because the Notepad window renders
   * before the main window has pushed it one (see NotepadWindow.tsx's auth handshake);
   * start() is simply a no-op until there's a real token to transcribe with. */
  token: string | null;
  /** Called with each non-empty, trimmed transcription, in order. Read from a ref
   * internally, so it always sees the caller's current state — no need to memoize it. */
  onTranscript: (text: string) => void;
  /** See the module comment: set to chunk a long recording into segments of this
   * length, leave unset for a single recording transcribed once on stop. */
  segmentMs?: number;
}

export interface VoiceRecorder {
  recording: boolean;
  /** True while a finished blob is in flight to /voice/transcribe. Can overlap with
   * `recording` when segmented: segment N uploads while segment N+1 is being recorded. */
  transcribing: boolean;
  /** Seconds since start(), for a live "● 0:42" readout. Resets on each start(). */
  elapsedSeconds: number;
  /** A microphone-permission, unsupported-environment, or transcription failure — the
   * server's own message where there is one (e.g. the 402 "Voice is a Pro feature"
   * detail), so a plan gate reads as a plan gate rather than a generic breakage. */
  error: string | null;
  clearError: () => void;
  start: () => Promise<void>;
  /** Ends the recording and transcribes what was captured. `discard: true` ends it
   * without transcribing — for when the surface the text would have gone to is no
   * longer the one in front of the student (switching chats, closing a note), where
   * delivering it anyway would drop words into somewhere they don't belong. */
  stop: (options?: { discard?: boolean }) => void;
}

export function useVoiceRecorder({ token, onTranscript, segmentMs }: UseVoiceRecorderOptions): VoiceRecorder {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Read inside recorder callbacks that outlive the render they were created in.
  const activeRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const segmentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const segmentMsRef = useRef(segmentMs);
  segmentMsRef.current = segmentMs;

  const discardRef = useRef(false);

  const stop = useCallback((options?: { discard?: boolean }) => {
    activeRef.current = false;
    discardRef.current = options?.discard === true;
    if (segmentTimeoutRef.current) {
      clearTimeout(segmentTimeoutRef.current);
      segmentTimeoutRef.current = null;
    }
    if (clockRef.current) {
      clearInterval(clockRef.current);
      clockRef.current = null;
    }
    // .stop() fires onstop, which is what actually transcribes the final blob — the
    // stream tracks are released here regardless so the mic indicator goes away
    // immediately rather than waiting on a network round trip.
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecording(false);
  }, []);

  // Releases the microphone and clears timers if the component unmounts mid-recording.
  // stop() already covers every in-app way to end a recording; this only covers the
  // whole surface going away underneath it.
  useEffect(() => {
    return () => {
      if (clockRef.current) clearInterval(clockRef.current);
      if (segmentTimeoutRef.current) clearTimeout(segmentTimeoutRef.current);
      activeRef.current = false;
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    if (!tokenRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording isn't supported in this browser/environment.");
      return;
    }
    setError(null);

    async function transcribeSegment(blob: Blob) {
      if (!tokenRef.current || blob.size === 0) return;
      setTranscribing(true);
      try {
        const text = (await transcribeAudio(tokenRef.current, blob)).trim();
        if (text) onTranscriptRef.current(text);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't transcribe that recording.");
      } finally {
        setTranscribing(false);
      }
    }

    function startSegment(stream: MediaStream) {
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (discardRef.current) {
          discardRef.current = false;
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        void transcribeSegment(blob);
        // Still active (so this wasn't stop()): immediately begin the next segment on
        // the same stream, so nothing is missed in the gap between segments.
        if (activeRef.current) startSegment(stream);
      };
      recorder.start();
      recorderRef.current = recorder;
      if (segmentMsRef.current !== undefined) {
        segmentTimeoutRef.current = setTimeout(() => recorder.stop(), segmentMsRef.current);
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      activeRef.current = true;
      discardRef.current = false;
      setRecording(true);
      setElapsedSeconds(0);
      clockRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
      startSegment(stream);
    } catch {
      setError("Couldn't access the microphone.");
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { recording, transcribing, elapsedSeconds, error, clearError, start, stop };
}
