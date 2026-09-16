/** The shared microphone/MediaRecorder mechanics behind both the Notepad's lecture
 * capture and the chat composer's dictation button (see lib/useVoiceRecorder.ts).
 *
 * jsdom has neither MediaRecorder nor getUserMedia, so both are stubbed here with the
 * smallest fakes that still exercise the real control flow the hook depends on:
 * ondataavailable pushing chunks, .stop() firing onstop, and the hook's own decision
 * about whether to start another segment afterwards. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useVoiceRecorder } from "../useVoiceRecorder";
import * as api from "../../api";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof api>("../../api");
  return { ...actual, transcribeAudio: vi.fn() };
});

const transcribeAudio = api.transcribeAudio as ReturnType<typeof vi.fn>;

/** Every MediaRecorder this test created, newest last — so a test can drive the exact
 * recorder instance the hook is currently holding. */
let recorders: FakeMediaRecorder[] = [];
let stoppedTracks = 0;

class FakeMediaRecorder {
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "audio/webm";
  state: "inactive" | "recording" = "inactive";

  constructor(public stream: MediaStream) {
    recorders.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    if (this.state !== "recording") return;
    this.state = "inactive";
    // A real recorder flushes whatever it captured, then fires onstop.
    this.ondataavailable?.({ data: new Blob(["audio-bytes"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

function fakeStream(): MediaStream {
  return {
    getTracks: () => [
      {
        stop: () => {
          stoppedTracks += 1;
        },
      },
    ],
  } as unknown as MediaStream;
}

/** A minimal host component so the hook runs inside a real React tree. */
function Harness({ token = "tok", segmentMs, onText }: { token?: string | null; segmentMs?: number; onText?: (t: string) => void }) {
  const recorder = useVoiceRecorder({
    token,
    segmentMs,
    onTranscript: (text) => onText?.(text),
  });
  return (
    <div>
      <button type="button" onClick={() => void recorder.start()}>
        start
      </button>
      <button type="button" onClick={() => recorder.stop()}>
        stop
      </button>
      <button type="button" onClick={() => recorder.stop({ discard: true })}>
        abandon
      </button>
      <span data-testid="state">
        {recorder.recording ? "recording" : "idle"}
        {recorder.transcribing ? "+transcribing" : ""}
      </span>
      <span data-testid="elapsed">{recorder.elapsedSeconds}</span>
      <span data-testid="error">{recorder.error ?? ""}</span>
    </div>
  );
}

const getUserMedia = vi.fn();

beforeEach(() => {
  recorders = [];
  stoppedTracks = 0;
  transcribeAudio.mockReset().mockResolvedValue("hello from the microphone");
  getUserMedia.mockReset().mockResolvedValue(fakeStream());
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useVoiceRecorder", () => {
  it("asks for the microphone and starts a real recorder on start()", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("start"));

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }));
    expect(recorders).toHaveLength(1);
    expect(recorders[0].state).toBe("recording");
    expect(screen.getByTestId("state")).toHaveTextContent("recording");
  });

  it("transcribes what was captured and hands the text to onTranscript on stop()", async () => {
    const user = userEvent.setup();
    const onText = vi.fn();
    render(<Harness onText={onText} />);

    await user.click(screen.getByText("start"));
    await waitFor(() => expect(recorders).toHaveLength(1));
    await user.click(screen.getByText("stop"));

    await waitFor(() => expect(transcribeAudio).toHaveBeenCalledTimes(1));
    expect(transcribeAudio.mock.calls[0][0]).toBe("tok");
    expect(transcribeAudio.mock.calls[0][1]).toBeInstanceOf(Blob);
    await waitFor(() => expect(onText).toHaveBeenCalledWith("hello from the microphone"));
  });

  it("releases the microphone on stop(), so the OS recording indicator goes away", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("start"));
    await waitFor(() => expect(recorders).toHaveLength(1));
    await user.click(screen.getByText("stop"));

    expect(stoppedTracks).toBe(1);
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  it("delivers whitespace-trimmed text, and delivers nothing at all for an empty transcription", async () => {
    const user = userEvent.setup();
    const onText = vi.fn();
    transcribeAudio.mockResolvedValue("   ");
    render(<Harness onText={onText} />);

    await user.click(screen.getByText("start"));
    await waitFor(() => expect(recorders).toHaveLength(1));
    await user.click(screen.getByText("stop"));

    await waitFor(() => expect(transcribeAudio).toHaveBeenCalled());
    expect(onText).not.toHaveBeenCalled();
  });

  it("surfaces the server's own message when transcription fails — a Pro gate reads as a plan message, not a breakage", async () => {
    const user = userEvent.setup();
    transcribeAudio.mockRejectedValue(new api.ApiError("Voice is a Pro feature — upgrade to Newton Pro."));
    render(<Harness />);

    await user.click(screen.getByText("start"));
    await waitFor(() => expect(recorders).toHaveLength(1));
    await user.click(screen.getByText("stop"));

    expect(await screen.findByText(/Voice is a Pro feature/)).toBeInTheDocument();
  });

  it("reports a denied/unavailable microphone instead of silently doing nothing", async () => {
    const user = userEvent.setup();
    getUserMedia.mockRejectedValue(new Error("NotAllowedError"));
    render(<Harness />);

    await user.click(screen.getByText("start"));

    expect(await screen.findByText("Couldn't access the microphone.")).toBeInTheDocument();
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  it("reports an environment with no MediaRecorder at all rather than throwing", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("MediaRecorder", undefined);
    render(<Harness />);

    await user.click(screen.getByText("start"));

    expect(await screen.findByText(/isn't supported in this browser/i)).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("does nothing without a token — the Notepad renders before the main window has pushed it one", async () => {
    const user = userEvent.setup();
    render(<Harness token={null} />);

    await user.click(screen.getByText("start"));

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  it("ignores a second start() while already recording, rather than opening a second stream", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("start"));
    await waitFor(() => expect(recorders).toHaveLength(1));
    await user.click(screen.getByText("start"));

    expect(recorders).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  describe("segmented recording (the Notepad's lecture capture)", () => {
    it("rolls over to a new segment on the interval, transcribing each one as it finishes", async () => {
      vi.useFakeTimers();
      const onText = vi.fn();
      render(<Harness segmentMs={45_000} onText={onText} />);

      await act(async () => {
        screen.getByText("start").click();
      });
      expect(recorders).toHaveLength(1);

      // One segment elapses: the first recorder stops (and uploads), a second starts
      // immediately on the same stream so nothing is missed in between.
      await act(async () => {
        vi.advanceTimersByTime(45_000);
      });
      expect(transcribeAudio).toHaveBeenCalledTimes(1);
      expect(recorders).toHaveLength(2);
      expect(recorders[1].state).toBe("recording");
      expect(recorders[1].stream).toBe(recorders[0].stream);

      await act(async () => {
        vi.advanceTimersByTime(45_000);
      });
      expect(transcribeAudio).toHaveBeenCalledTimes(2);
      expect(recorders).toHaveLength(3);
    });

    it("stop() ends the chain — the final segment is still transcribed, but no new one begins", async () => {
      vi.useFakeTimers();
      render(<Harness segmentMs={45_000} />);

      await act(async () => {
        screen.getByText("start").click();
      });
      await act(async () => {
        vi.advanceTimersByTime(45_000);
      });
      expect(recorders).toHaveLength(2);

      await act(async () => {
        screen.getByText("stop").click();
      });

      expect(transcribeAudio).toHaveBeenCalledTimes(2); // the rollover plus the final one
      expect(recorders).toHaveLength(2); // nothing new started
    });
  });

  describe("unsegmented recording (the chat composer's dictation)", () => {
    it("never rolls over on a timer — one recording, transcribed once when the student stops", async () => {
      vi.useFakeTimers();
      render(<Harness />);

      await act(async () => {
        screen.getByText("start").click();
      });
      await act(async () => {
        vi.advanceTimersByTime(10 * 60_000);
      });

      expect(recorders).toHaveLength(1);
      expect(transcribeAudio).not.toHaveBeenCalled();

      await act(async () => {
        screen.getByText("stop").click();
      });
      expect(transcribeAudio).toHaveBeenCalledTimes(1);
    });

    it("still runs the elapsed clock, for a live recording readout", async () => {
      vi.useFakeTimers();
      render(<Harness />);

      await act(async () => {
        screen.getByText("start").click();
      });
      expect(screen.getByTestId("elapsed")).toHaveTextContent("0");

      await act(async () => {
        vi.advanceTimersByTime(3_000);
      });
      expect(screen.getByTestId("elapsed")).toHaveTextContent("3");
    });
  });

  it("stop({ discard: true }) ends the recording without transcribing — for when the text's destination is gone", async () => {
    const user = userEvent.setup();
    const onText = vi.fn();
    render(<Harness onText={onText} />);

    await user.click(screen.getByText("start"));
    await waitFor(() => expect(recorders).toHaveLength(1));
    await user.click(screen.getByText("abandon"));

    expect(recorders[0].state).toBe("inactive");
    expect(stoppedTracks).toBe(1);
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
  });

  it("a discarded recording doesn't poison the next one — the following stop() still transcribes", async () => {
    const user = userEvent.setup();
    const onText = vi.fn();
    render(<Harness onText={onText} />);

    await user.click(screen.getByText("start"));
    await waitFor(() => expect(recorders).toHaveLength(1));
    await user.click(screen.getByText("abandon"));

    await user.click(screen.getByText("start"));
    await waitFor(() => expect(recorders).toHaveLength(2));
    await user.click(screen.getByText("stop"));

    await waitFor(() => expect(onText).toHaveBeenCalledWith("hello from the microphone"));
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
  });

  it("releases the microphone if the surface unmounts mid-recording", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);

    await user.click(screen.getByText("start"));
    await waitFor(() => expect(recorders).toHaveLength(1));

    unmount();

    expect(stoppedTracks).toBe(1);
  });
});
