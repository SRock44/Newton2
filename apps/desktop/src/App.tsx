import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import {
  ApiError,
  createSession,
  deleteSession,
  getAccountStatus,
  getMessages,
  listFlashcards,
  listSessions,
  listStudyPlan,
  openChatSocket,
  uploadChatImage,
} from "./api";
import { TokenManager, decodeJwtPayload } from "./auth";
import type { TokenSet } from "./auth";
import { notifyStudyReminders } from "./notifications";
import { getStudyRemindersEnabled } from "./lib/preferences";
import { hasSeenOnboarding, markOnboardingSeen } from "./lib/onboarding";
import type {
  AccountConsentStatus,
  ChatMessage,
  ChatSession,
  ConnectionStatus,
  MainView,
  UploadedDocument,
} from "./types";
import { sessionDisplayTitle } from "./lib/sessionTitle";
import AgeGateScreen from "./components/AgeGateScreen";
import LoginScreen from "./components/LoginScreen";
import TitleBar from "./components/TitleBar";
import NewtonMark from "./components/NewtonMark";
import Sidebar from "./components/Sidebar";
import ChatPane from "./components/ChatPane";
import Composer from "./components/Composer";
import type { ComposerHandle } from "./components/Composer";
import DocumentsPanel from "./components/DocumentsPanel";
import StudyPlanPanel from "./components/StudyPlanPanel";
import FlashcardsPanel from "./components/FlashcardsPanel";
import PracticeExamsPanel from "./components/PracticeExamsPanel";
import SettingsPanel from "./components/SettingsPanel";
import ContextPanel from "./components/ContextPanel";
import HelpModal from "./components/HelpModal";
import ContextMenu from "./components/ContextMenu";
import ScreenSnipModal from "./components/ScreenSnipModal";

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  open: "connected",
  connecting: "connecting…",
  closed: "offline",
};

// Auto-generated conversation titles (ROADMAP.md): how long to wait after the 2nd
// assistant reply before re-fetching the session list once, giving app/jobs/titling.
// py's generate_session_title arq job (enqueued server-side right after that same
// reply) time to actually finish and write the title. Live-verified against the real
// deployed stack: the job itself (one real model call) took ~13.5s wall-clock in
// practice, well past a naive "a few seconds" guess -- this is set with real headroom
// above that rather than the original guess, since a late (but eventually correct)
// refetch is harmless and a too-early one just wastes the one shot this gets.
const TITLE_REFETCH_DELAY_MS = 15_000;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function usernameFromAccessToken(accessToken: string): string {
  const claims = decodeJwtPayload(accessToken);
  return (claims.preferred_username as string) || (claims.email as string) || (claims.name as string) || "";
}

// A stable per-account key for the first-run welcome card (see lib/onboarding.ts) —
// prefers the JWT's own subject claim (a stable UUID that survives every token
// refresh), falling back to other stable identity claims, and finally to a fixed
// sentinel so a token with no recognizable claims at all still gets a single
// consistent identity rather than "seen" state that resets on every refresh.
function userIdFromAccessToken(accessToken: string): string {
  const claims = decodeJwtPayload(accessToken);
  return (
    (claims.sub as string) || (claims.preferred_username as string) || (claims.email as string) || "unknown-user"
  );
}

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  // One handler for every path that lands a token — a fresh sign-in, a launch-time
  // session restore, or an ordinary background refresh — so username/userId are always
  // derived consistently instead of each caller re-deriving them (or, worse, forgetting
  // to).
  const [tokenManager] = useState(
    () =>
      new TokenManager((accessToken) => {
        setToken(accessToken);
        setUsername(accessToken ? usernameFromAccessToken(accessToken) : "");
        setUserId(accessToken ? userIdFromAccessToken(accessToken) : "");
      }),
  );
  // Whether this account has already dismissed (or acted on) the first-run welcome
  // card — see lib/onboarding.ts and OnboardingWelcome.tsx. Starts `true` (hidden) so
  // it never flashes on screen before userId is known; the effect below corrects it
  // for a genuinely new account the moment sign-in resolves.
  const [onboardingSeen, setOnboardingSeen] = useState(true);

  useEffect(() => {
    setOnboardingSeen(userId ? hasSeenOnboarding(userId) : true);
  }, [userId]);

  const handleDismissOnboarding = useCallback(() => {
    if (userId) markOnboardingSeen(userId);
    setOnboardingSeen(true);
  }, [userId]);
  // True only for the brief moment on launch where we're checking whether a
  // previously signed-in session can be silently resumed (see auth.ts's
  // tryRestoreSession) — avoids flashing the login screen for someone who's actually
  // already signed in.
  const [bootstrapping, setBootstrapping] = useState(true);
  // Minor-consent / age-gate scaffolding (ROADMAP.md Phase 7 -- see
  // docs/data-retention-and-privacy.md). null while unknown (still loading, or not
  // signed in) -- distinct from "loaded and consent isn't needed", which is
  // { needs_consent: false, ... }. See the effect below and AgeGateScreen.tsx.
  const [accountStatus, setAccountStatus] = useState<AccountConsentStatus | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [firstMessageBySession, setFirstMessageBySession] = useState<Record<string, string>>({});

  const [isStreaming, setIsStreaming] = useState(false);
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>("closed");
  // Which UI fills the main content area next to the always-visible sidebar/title bar
  // — a general mechanism (see types.ts's MainView) rather than a Documents-specific
  // boolean, since Documents is likely the first of more panels to get this "real page,
  // not a modal" treatment. Going back to "chat" happens from several obvious places:
  // toggling the sidebar's Documents button again, picking any chat session, starting a
  // new one, or finishing "Chat about this document" (see the handlers below).
  const [mainView, setMainView] = useState<MainView>("chat");
  // Set when an attached-document chip in a chat message (see MessageBubble /
  // AttachedDocumentChip) sends the student to a specific document — read once by
  // DocumentsPanel as its initial selection when it mounts fresh into the "documents"
  // view (see handleOpenDocument below).
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);
  const [showStudyPlan, setShowStudyPlan] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [showPracticeExams, setShowPracticeExams] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [snipDataUrl, setSnipDataUrl] = useState<string | null>(null);
  const [snipError, setSnipError] = useState<string | null>(null);
  // Set by handleChatAboutDocument right after it creates and activates a new session —
  // consumed by Composer as soon as it renders for that exact session, pre-attaching
  // the document exactly the way manually picking it from the "+" menu's "Attach an
  // existing document" flow would. Deliberately does NOT send anything on the
  // student's behalf; they still type and send their own opening message.
  const [pendingComposerDocument, setPendingComposerDocument] = useState<
    { sessionId: string; id: string; name: string } | null
  >(null);

  const wsRef = useRef<WebSocket | null>(null);
  // Kept in sync with `sessions` (see the effect below) purely so the WebSocket
  // message handler -- set up once per socket in an effect keyed only on
  // activeSessionId, so it closes over a `sessions` value that can go stale the moment
  // the sidebar list changes for any other reason -- can always read the active
  // session's current title without forcing a socket reconnect on every session-list
  // update.
  const sessionsRef = useRef<ChatSession[]>([]);
  // For a "paper-plan" card's "Request Changes" action (see ChatPane/PaperPlanCard) —
  // puts the cursor in the composer so the student can type their own tweaks, without
  // anything being sent on their behalf.
  const composerRef = useRef<ComposerHandle>(null);
  const remindersCheckedRef = useRef(false);
  // A session id we just created client-side (see createNewSession) — its history is
  // known to be empty, so the message-history effect below should skip fetching it
  // rather than race a pending optimistic send (e.g. handleChatAboutDocument's opener):
  // the GET can resolve *after* the send and overwrite `messages` with the stale-empty
  // history it captured before the send landed, silently wiping the just-sent message.
  const skipNextHistoryFetchRef = useRef<string | null>(null);

  const rememberFirstMessage = useCallback((sessionId: string, content: string) => {
    setFirstMessageBySession((prev) => (prev[sessionId] ? prev : { ...prev, [sessionId]: content }));
  }, []);

  function handleLoginSuccess(tokens: TokenSet) {
    tokenManager.setTokens(tokens);
  }

  // Runs once, before rendering the login screen: try to silently resume whatever
  // session a previous run of the app persisted (see auth.ts) so signing in isn't
  // required every single time the app is opened.
  useEffect(() => {
    let cancelled = false;
    tokenManager.tryRestoreSession().finally(() => {
      if (!cancelled) setBootstrapping(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Loads (or re-checks, on every sign-in) whether this account still needs the
  // age-gate step -- deliberately server-side (see AccountConsentStatus/GET /account)
  // rather than a local "seen" flag, so it survives a reinstall/new device and means
  // something as a compliance record. Fails OPEN (treated as "no consent needed") on a
  // network/API error rather than locking a signed-in student out of the whole app
  // over a transient failure -- a real production version of this gate would likely
  // want to fail closed instead; see docs/data-retention-and-privacy.md's gap list.
  useEffect(() => {
    if (!token) {
      setAccountStatus(null);
      return;
    }
    let cancelled = false;
    getAccountStatus(token)
      .then((status) => {
        if (!cancelled) setAccountStatus(status);
      })
      .catch(() => {
        if (!cancelled) setAccountStatus({ age_band: null, consented_at: null, needs_consent: false });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function handleSignOut() {
    wsRef.current?.close();
    wsRef.current = null;
    tokenManager.clear();
    setUsername("");
    setSessions([]);
    setActiveSessionId(null);
    setMessages([]);
    setFirstMessageBySession({});
    setIsStreaming(false);
    setWsStatus("closed");
    setMainView("chat");
    setOpenDocumentId(null);
    setShowStudyPlan(false);
    setShowFlashcards(false);
    setShowPracticeExams(false);
    setShowSettings(false);
    setShowHelp(false);
    setSnipDataUrl(null);
    setSnipError(null);
    setPendingComposerDocument(null);
    remindersCheckedRef.current = false;
  }

  // The crop modal hands back a File the same way Composer's own file-attach input does
  // — reuse that exact upload-then-tag-in-message path rather than inventing a second one.
  async function handleSnipCapture(file: File) {
    if (!activeSessionId) {
      setSnipDataUrl(null);
      setSnipError("Open a chat before sending a snip.");
      return;
    }
    try {
      const imageId = await uploadChatImage(token as string, activeSessionId, file);
      setSnipDataUrl(null);
      handleSend(`[Attached image: ${imageId}]`);
    } catch (err) {
      setSnipError(errorMessage(err, "Couldn't send that snip."));
    }
  }

  // System tray "Review flashcards" quick action: the Rust side shows/focuses the
  // window itself and emits this event, so all the frontend needs to do is open the
  // right panel once it arrives. Dynamically imported and defensively caught since
  // there's no real Tauri IPC bridge under a test runner (jsdom) — listen() would have
  // nothing to attach to there.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen("tray-open-flashcards", () => setShowFlashcards(true)))
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // No Tauri context — nothing to listen to.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // "Newton Snip" (global hotkey or tray "Take a Newton Snip"): Rust captures the screen
  // and emits it here as a data URL for the crop modal — see src-tauri/src/lib.rs's
  // `capture_and_emit_snip`. Same dynamic-import/defensive-catch pattern as the tray
  // listener above, for the same reason (no real Tauri IPC bridge under jsdom).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ dataUrl: string }>("newton-snip-captured", (event) => {
          setSnipError(null);
          setSnipDataUrl(event.payload.dataUrl);
        }),
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // No Tauri context — nothing to listen to.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Pushes a live, valid access token to the Notepad window (if open) — see
  // NotepadWindow.tsx, which listens for this event and has no login/API access of its
  // own otherwise. Fires once whenever `token` first becomes non-null (a fresh sign-in
  // or a restored session) AND again every time TokenManager's onChange callback fires
  // for an ordinary background refresh (that's the only thing that ever changes `token`
  // — see the `[tokenManager]` useState above), so the Notepad window's own copy never
  // goes stale either. A no-op (nothing listening on the other end) if the Notepad
  // window isn't currently open.
  useEffect(() => {
    import("@tauri-apps/api/event")
      .then(({ emit }) => emit("notepad-auth", { token }))
      .catch(() => {
        // No Tauri context — nothing listening on the other end.
      });
  }, [token]);

  // Keeps the displayed/passed-down `token` fresh even when nothing is actively
  // fetching — otherwise a session left idle for over an hour would only discover
  // its token expired the next time some component happened to make a request.
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(() => {
      tokenManager.getValidAccessToken().catch(() => handleSignOut());
    }, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Once per sign-in (not a repeating poll — that would just nag), nudge the user if
  // they have flashcards due or study plan deadlines coming up soon. Only fires while
  // the app is actually open; see notifications.ts.
  useEffect(() => {
    if (!token || remindersCheckedRef.current) return;
    remindersCheckedRef.current = true;
    if (!getStudyRemindersEnabled()) return;
    const DUE_SOON_DAYS = 3;

    (async () => {
      try {
        const accessToken = await tokenManager.getValidAccessToken();
        const [dueFlashcards, studyPlan] = await Promise.all([
          listFlashcards(accessToken, true),
          listStudyPlan(accessToken),
        ]);
        const dueSoonCutoff = Date.now() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000;
        const dueSoonItems = studyPlan.filter((item) => {
          if (!item.due_date) return false;
          const dueTime = new Date(item.due_date).getTime();
          return !Number.isNaN(dueTime) && dueTime <= dueSoonCutoff;
        });
        await notifyStudyReminders(dueFlashcards.length, dueSoonItems.length);
      } catch {
        // A missed reminder shouldn't disrupt sign-in or show an error banner.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Load the user's sessions once signed in; start a first chat if they have none.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setSessionsLoading(true);
    setSessionsError(null);
    (async () => {
      try {
        const accessToken = await tokenManager.getValidAccessToken();
        let list = await listSessions(accessToken);
        if (!cancelled && list.length === 0) {
          const newId = await createSession(accessToken);
          list = await listSessions(accessToken);
          if (list.length === 0) {
            list = [{ id: newId, title: null, status: "active", created_at: new Date().toISOString() }];
          }
        }
        if (cancelled) return;
        setSessions(list);
        setActiveSessionId((current) => current ?? list[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) setSessionsError(errorMessage(err, "Couldn't load your chats."));
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Load message history whenever the active session changes.
  useEffect(() => {
    if (!token || !activeSessionId) {
      setMessages([]);
      return;
    }
    // A session we just created client-side (createNewSession) is known to have zero
    // messages — skip the fetch entirely rather than let it race a pending optimistic
    // send (e.g. "Chat about this document"'s opener) and silently overwrite it with
    // the stale-empty history the GET captured before that send landed.
    if (skipNextHistoryFetchRef.current === activeSessionId) {
      skipNextHistoryFetchRef.current = null;
      setMessages([]);
      setMessagesLoading(false);
      setMessagesError(null);
      setIsStreaming(false);
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    setMessagesError(null);
    setIsStreaming(false);
    (async () => {
      try {
        const accessToken = await tokenManager.getValidAccessToken();
        const history = await getMessages(accessToken, activeSessionId);
        if (cancelled) return;
        setMessages(history);
        const firstUser = history.find((m) => m.role === "user");
        if (firstUser) rememberFirstMessage(activeSessionId, firstUser.content);
      } catch (err) {
        if (!cancelled) setMessagesError(errorMessage(err, "Couldn't load this conversation."));
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, activeSessionId, rememberFirstMessage]);

  // Keep exactly one live socket, following the active session. Deliberately does NOT
  // depend on `token` — a WebSocket is only auth-checked once, at connect time, so an
  // in-place token refresh must never force a reconnect. Instead, every time we're about
  // to open a *new* socket (i.e. activeSessionId changed), we ask the TokenManager for a
  // guaranteed-fresh token first. This is the direct fix for "clicking between chats says
  // invalid or expired token": previously this effect closed over whatever `token` value
  // was current when the effect last ran, which could be minutes stale by the time the
  // user actually switched chats.
  useEffect(() => {
    if (!tokenManager.hasSession() || !activeSessionId) return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    let titleRefetchTimeout: ReturnType<typeof setTimeout> | null = null;
    setWsStatus("connecting");

    // Auto-generated conversation titles (ROADMAP.md): the backend enqueues a real
    // title-generation job right after the 2nd assistant reply lands (see chat.py's
    // _maybe_enqueue_title_job), but that job runs asynchronously — this schedules ONE
    // bounded follow-up listSessions() fetch a little later to pick up the
    // eventually-written title in the sidebar, not a repeating poll.
    const scheduleTitleRefetchOnce = () => {
      if (titleRefetchTimeout) return; // already scheduled once for this turn
      titleRefetchTimeout = setTimeout(async () => {
        titleRefetchTimeout = null;
        if (cancelled) return;
        try {
          const freshToken = await tokenManager.getValidAccessToken();
          const list = await listSessions(freshToken);
          if (!cancelled) setSessions(list);
        } catch {
          // Best-effort only -- a missed refresh just means the sidebar keeps showing
          // the fallback title a little longer, nothing to surface to the student.
        }
      }, TITLE_REFETCH_DELAY_MS);
    };

    (async () => {
      let accessToken: string;
      try {
        accessToken = await tokenManager.getValidAccessToken();
      } catch {
        if (!cancelled) setWsStatus("closed");
        return;
      }
      if (cancelled) return;

      ws = openChatSocket(accessToken, activeSessionId);
      wsRef.current = ws;

      ws.onopen = () => setWsStatus("open");
      ws.onclose = () => setWsStatus("closed");
      ws.onerror = () => setWsStatus("closed");
      ws.onmessage = (event) => {
        let payload: {
          type?: string;
          content?: string;
          tool?: string;
          label?: string;
          panel?: string;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
        };
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        if (payload.type === "plan_chunk") {
          // Always fires (if at all) before any real answer text/tool activity for the
          // same reply. Updates the streaming placeholder handleSend already pushed
          // synchronously the moment the user's message was sent (see ROADMAP.md's
          // "always-visible thinking indicator" entry) -- it's guaranteed to already
          // exist by the time any WS frame lands, so this is a plain in-place update,
          // never a second/duplicate message.
          setIsStreaming(true);
          const planNarration = payload.content ?? "";
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== "assistant" || !last.streaming) return prev;
            return [...prev.slice(0, -1), { ...last, planNarration }];
          });
        } else if (payload.type === "chunk") {
          setIsStreaming(true);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== "assistant" || !last.streaming) return prev;
            return [...prev.slice(0, -1), { ...last, content: last.content + (payload.content ?? "") }];
          });
        } else if (payload.type === "tool_start" || payload.type === "tool_end") {
          setIsStreaming(true);
          const tool = payload.tool ?? "";
          const label = payload.label ?? tool;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== "assistant" || !last.streaming) return prev;
            const activity = last.activity ?? [];
            if (payload.type === "tool_start") {
              return [...prev.slice(0, -1), { ...last, activity: [...activity, { tool, label, done: false }] }];
            }
            // tool_end: mark the most recent not-yet-done entry for this tool as done.
            let markedIndex = -1;
            for (let i = activity.length - 1; i >= 0; i -= 1) {
              if (activity[i]!.tool === tool && !activity[i]!.done) {
                markedIndex = i;
                break;
              }
            }
            if (markedIndex === -1) return prev;
            const nextActivity = activity.map((entry, i) => (i === markedIndex ? { ...entry, done: true } : entry));
            return [...prev.slice(0, -1), { ...last, activity: nextActivity }];
          });
        } else if (payload.type === "suggested_action") {
          // Always follows the tool_end for the generation tool that produced it (see
          // the backend's _TOOL_TO_SUGGESTED_ACTION), so the reply it belongs to is
          // still the in-progress streaming message — append rather than clobber, since
          // one reply can plausibly earn more than one (e.g. two generation tools
          // called in the same turn).
          const panel = payload.panel ?? "";
          const label = payload.label ?? "";
          if (!panel || !label) return;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== "assistant" || !last.streaming) return prev;
            const suggestedActions = [...(last.suggestedActions ?? []), { panel, label }];
            return [...prev.slice(0, -1), { ...last, suggestedActions }];
          });
        } else if (payload.type === "done" || payload.type === "stopped") {
          setIsStreaming(false);
          const stoppedByUser = payload.type === "stopped";
          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.streaming
                ? {
                    ...m,
                    streaming: false,
                    stoppedByUser,
                    prompt_tokens: payload.prompt_tokens ?? null,
                    completion_tokens: payload.completion_tokens ?? null,
                  }
                : m,
            );
            // Auto-generated conversation titles (ROADMAP.md): right as the session
            // gets its 2nd assistant reply (done or stopped both persist a real
            // assistant ChatMessage server-side — see chat.py's
            // _maybe_enqueue_title_job, which counts both the same way), and it still
            // has no real title, schedule one bounded follow-up sessions refetch to
            // pick up the title once the backend's titling job finishes.
            const assistantReplies = updated.filter((m) => m.role === "assistant").length;
            if (assistantReplies === 2) {
              const activeSession = sessionsRef.current.find((s) => s.id === activeSessionId);
              const titleLooksUnset = !activeSession?.title || activeSession.title.trim().length === 0;
              if (titleLooksUnset) scheduleTitleRefetchOnce();
            }
            return updated;
          });
        } else if (payload.type === "error") {
          setIsStreaming(false);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.streaming) {
              return [
                ...prev.slice(0, -1),
                { ...last, streaming: false, error: true, content: payload.content ?? "Something went wrong." },
              ];
            }
            return [
              ...prev,
              { role: "assistant", content: payload.content ?? "Something went wrong.", error: true },
            ];
          });
        }
      };
    })();

    return () => {
      cancelled = true;
      if (titleRefetchTimeout) clearTimeout(titleRefetchTimeout);
      ws?.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  function handleSend(text: string) {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !activeSessionId) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: "Not connected right now — please wait a moment and try again.", error: true },
      ]);
      return;
    }
    // The user's message AND an immediate "Newton is thinking" placeholder land in the
    // same synchronous update, before any WebSocket frame can possibly arrive -- so
    // there is always visible activity from the instant Send is pressed, not just once
    // the first real frame eventually lands (see ROADMAP.md's "always-visible thinking
    // indicator" entry; MessageBubble.tsx's showStreamingDots renders this placeholder
    // state, and every WS handler above updates this same message in place from here
    // on, never creating a second one).
    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "", streaming: true }]);
    rememberFirstMessage(activeSessionId, text);
    socket.send(JSON.stringify({ type: "user_message", content: text }));
    setIsStreaming(true);
  }

  function handleFocusComposer() {
    composerRef.current?.focus();
  }

  function handleStop() {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
    }
  }

  // Shared by handleNewChat and handleChatAboutDocument — the only place that knows
  // how to create a session and make it the active one. Returns the new session id,
  // or null if creation failed (already surfaced via sessionsError).
  async function createNewSession(): Promise<string | null> {
    if (!tokenManager.hasSession() || creatingChat) return null;
    setCreatingChat(true);
    try {
      const accessToken = await tokenManager.getValidAccessToken();
      const id = await createSession(accessToken);
      const newSession: ChatSession = {
        id,
        title: null,
        status: "active",
        created_at: new Date().toISOString(),
      };
      skipNextHistoryFetchRef.current = id;
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(id);
      return id;
    } catch (err) {
      setSessionsError(errorMessage(err, "Couldn't start a new chat."));
      return null;
    } finally {
      setCreatingChat(false);
    }
  }

  async function handleNewChat() {
    await createNewSession();
    setMainView("chat");
  }

  // Sidebar session click: switch chats and, if Documents was showing, bring chat back
  // into view — one of several obvious ways back (see the mainView comment above).
  function handleSelectSession(id: string) {
    setActiveSessionId(id);
    setMainView("chat");
  }

  // "Chat about this document" (DocumentsPanel): start a fresh chat, then hand the
  // document to the Composer as a pending attachment the moment it renders for that
  // exact session — the *same* end state as manually clicking "+" -> "Attach an
  // existing document" and picking it there. Deliberately does not send anything on
  // the student's behalf: they still write and send their own opening message, with
  // the document already attached and ready.
  async function handleChatAboutDocument(doc: UploadedDocument) {
    const id = await createNewSession();
    if (!id) return;
    setPendingComposerDocument({ sessionId: id, id: doc.id, name: doc.filename });
  }

  // Sidebar's "Documents" nav button: toggle between the chat view and the Documents
  // page (see the mainView comment above) — a second click is the obvious way back.
  function handleToggleDocuments() {
    setMainView((v) => (v === "documents" ? "chat" : "documents"));
  }

  // An attached-document chip in a chat message (see MessageBubble/AttachedDocumentChip)
  // was clicked: jump to the Documents page with that exact document selected.
  function handleOpenDocument(documentId: string) {
    setOpenDocumentId(documentId);
    setMainView("documents");
  }

  // Backs every "Open Flashcards"-style suggested-action button on a message (see
  // MessageBubble) -- reuses the exact same show-state setters the Sidebar's own nav
  // buttons call, so there's exactly one place that knows how to open each panel.
  function handleOpenSuggestedPanel(panel: string) {
    if (panel === "flashcards") setShowFlashcards(true);
    else if (panel === "practice_exams") setShowPracticeExams(true);
    else if (panel === "study_plan") setShowStudyPlan(true);
    else if (panel === "documents") setMainView("documents");
  }

  async function handleDeleteSession(sessionId: string) {
    try {
      const accessToken = await tokenManager.getValidAccessToken();
      await deleteSession(accessToken, sessionId);
    } catch (err) {
      setSessionsError(errorMessage(err, "Couldn't delete this chat."));
      return;
    }

    const remaining = sessions.filter((s) => s.id !== sessionId);
    setSessions(remaining);
    setFirstMessageBySession((prev) => {
      if (!(sessionId in prev)) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    if (activeSessionId === sessionId) {
      setActiveSessionId(remaining[0]?.id ?? null);
    }
  }

  if (bootstrapping) {
    return (
      <div className="app-root">
        <TitleBar title="Newton" />
        <div className="login-screen">
          <span className="bootstrap-mark" aria-label="Signing you in…">
            <NewtonMark size={26} />
          </span>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="app-root">
        <TitleBar title="Newton" />
        <LoginScreen onSuccess={handleLoginSuccess} />
        <ContextMenu onDeleteSession={handleDeleteSession} />
      </div>
    );
  }

  // Signed in, but the age-gate check hasn't resolved yet — same brief spinner as the
  // bootstrapping state above, just gated on a server round-trip instead of local
  // storage.
  if (accountStatus === null) {
    return (
      <div className="app-root">
        <TitleBar title="Newton" />
        <div className="login-screen">
          <span className="bootstrap-mark" aria-label="Loading your account…">
            <NewtonMark size={26} />
          </span>
        </div>
      </div>
    );
  }

  // Minor-consent / age-gate scaffolding (ROADMAP.md Phase 7 -- see
  // docs/data-retention-and-privacy.md). Blocks the entire rest of the app, every
  // sign-in, until answered -- see AgeGateScreen.tsx for why "under 13" never clears
  // this.
  if (accountStatus.needs_consent) {
    return (
      <div className="app-root">
        <TitleBar title="Newton" />
        <AgeGateScreen token={token} onResolved={setAccountStatus} />
        <ContextMenu onDeleteSession={handleDeleteSession} />
      </div>
    );
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const headerTitle = activeSession
    ? sessionDisplayTitle(activeSession, activeSessionId ? firstMessageBySession[activeSessionId] : undefined)
    : "Newton";
  // The window title bar and main-pane header both track whichever view is actually
  // showing, not always the chat title — "Documents" while browsing the drive.
  const pageTitle = mainView === "documents" ? "Documents" : headerTitle;

  return (
    <div className="app-root">
      <TitleBar title={pageTitle} />
      <div className="app-shell">
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          firstMessageBySession={firstMessageBySession}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          onDeleteSession={handleDeleteSession}
          creatingChat={creatingChat}
          username={username || "student"}
          onSignOut={handleSignOut}
          onOpenDocuments={handleToggleDocuments}
          onOpenStudyPlan={() => setShowStudyPlan(true)}
          onOpenFlashcards={() => setShowFlashcards(true)}
          onOpenPracticeExams={() => setShowPracticeExams(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenHelp={() => setShowHelp(true)}
        />

        <main className="main-pane">
          <header className="main-header">
            <h1 className="main-header-title">{pageTitle}</h1>
            {mainView === "chat" && (
              <span className="main-header-status" title={`Connection: ${wsStatus}`}>
                <span className={`live-dot live-dot--${wsStatus}`} aria-hidden="true" />
                {CONNECTION_LABEL[wsStatus]}
              </span>
            )}
          </header>

          {mainView === "documents" ? (
            // A real page filling the same space chat normally occupies — no modal
            // backdrop, no floating dialog (see DocumentsPanel.tsx and App.css's
            // ".documents-page" rules). onClose here is what "Chat about this
            // document" uses to hand back to the chat view once it's done.
            <DocumentsPanel
              token={token}
              onClose={() => setMainView("chat")}
              onChatAboutDocument={handleChatAboutDocument}
              initialSelectedDocumentId={openDocumentId}
            />
          ) : (
            <>
              {sessionsError && <div className="banner banner--error chat-pane-banner">{sessionsError}</div>}

              {sessionsLoading && sessions.length === 0 ? (
                <div className="chat-empty-state">
                  <p>Loading your chats…</p>
                </div>
              ) : (
                <>
                  <ChatPane
                    messages={messages}
                    loading={messagesLoading}
                    loadError={messagesError}
                    token={token}
                    sessionId={activeSessionId}
                    onOpenSuggestedPanel={handleOpenSuggestedPanel}
                    onOpenDocument={handleOpenDocument}
                    onSend={handleSend}
                    onFocusComposer={handleFocusComposer}
                    firstRun={!onboardingSeen}
                    onDismissFirstRun={handleDismissOnboarding}
                  />
                  {/* MathLive's virtual keyboard is retargeted here instead of its
                      default page-covering overlay — see lib/mathKeyboardDock.ts and
                      App.css's ".math-keyboard-dock" for the full "why". A flex
                      sibling of ChatPane/Composer: showing the keyboard pushes the
                      composer down rather than ever overlapping it, and starts at
                      zero height so it takes no space until actually shown. */}
                  <div id="math-keyboard-dock" className="math-keyboard-dock" />
                  <Composer
                    ref={composerRef}
                    onSend={handleSend}
                    onStop={handleStop}
                    disabled={isStreaming || !activeSessionId}
                    streaming={isStreaming}
                    token={token}
                    sessionId={activeSessionId}
                    pendingAttachment={
                      pendingComposerDocument?.sessionId === activeSessionId ? pendingComposerDocument : null
                    }
                    onPendingAttachmentConsumed={() => setPendingComposerDocument(null)}
                  />
                </>
              )}
            </>
          )}
        </main>

        <ContextPanel
          token={token}
          sessionCount={sessions.length}
          messageCount={messages.length}
          totalTokens={messages.reduce(
            (sum, m) => sum + (m.prompt_tokens ?? 0) + (m.completion_tokens ?? 0),
            0,
          )}
        />
      </div>

      {showStudyPlan && <StudyPlanPanel token={token} onClose={() => setShowStudyPlan(false)} />}
      {showFlashcards && (
        <FlashcardsPanel
          getAccessToken={() => tokenManager.getValidAccessToken()}
          onClose={() => setShowFlashcards(false)}
        />
      )}
      {showPracticeExams && (
        <PracticeExamsPanel token={token} onClose={() => setShowPracticeExams(false)} />
      )}
      {showSettings && (
        <SettingsPanel token={token} username={username || "student"} onClose={() => setShowSettings(false)} />
      )}
      {showHelp && <HelpModal token={token} onClose={() => setShowHelp(false)} />}

      <ContextMenu onDeleteSession={handleDeleteSession} />

      {snipDataUrl && (
        <ScreenSnipModal
          dataUrl={snipDataUrl}
          onCancel={() => setSnipDataUrl(null)}
          onCapture={handleSnipCapture}
        />
      )}
      {snipError && (
        <div className="banner banner--error snip-error-toast">
          {snipError}
          <button type="button" onClick={() => setSnipError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
