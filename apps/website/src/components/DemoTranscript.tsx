"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import demoTranscriptsData from "@/data/demo-transcripts.json";
import { useInView } from "@/hooks/useInView";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { deriveDemoState, delayForFrame, type DemoScenario } from "@/lib/demoTranscript";
import { renderReplyMarkdown } from "@/lib/renderReplyMarkdown";
import styles from "./DemoTranscript.module.css";

// Real captured WebSocket wire frames from the actual Newton backend (see
// apps/website/src/data/demo-transcripts.json) — three real chat turns, replayed
// client-side. No network call to the real API happens here; this is the "scripted"
// half of WEBSITE-ROADMAP.md's Phase 5, not a live chat client.
const scenarios = demoTranscriptsData as DemoScenario[];

function VerifiedBadge() {
  return (
    <span className={styles.verifiedBadge} aria-label="Verified: computed, not guessed">
      Verified
    </span>
  );
}

export default function DemoTranscript() {
  const [activeId, setActiveId] = useState(scenarios[0].id);
  const [count, setCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hasAutoplayed, setHasAutoplayed] = useState(false);
  // Bumped every time a fresh (non-reduced-motion) playback should start — the frame
  // timer effect below keys on this, not on `count`. `count` changes every ~20-70ms as
  // frames reveal, and a real "next timer" needs to be scheduled from INSIDE the
  // previous timer's own callback (see the effect below) rather than re-derived by a
  // React effect re-running after each state update — the latter depends on exactly
  // when React chooses to flush passive effects, which isn't reliably "immediately",
  // and produced real stalls under both real browsers' own scheduling and fake timers.
  const [playToken, setPlayToken] = useState(0);
  const reducedMotion = useReducedMotion();
  const { ref: sectionRef, inView } = useInView<HTMLDivElement>({ threshold: 0.35, fallbackInView: false });

  const activeScenario = useMemo(
    () => scenarios.find((s) => s.id === activeId) ?? scenarios[0],
    [activeId]
  );

  /** Starts (or, for reduced motion, instantly finishes) a fresh playback of `id`. */
  function playScenario(id: string) {
    setActiveId(id);
    if (reducedMotion) {
      const target = scenarios.find((s) => s.id === id) ?? scenarios[0];
      setCount(target.frames.length);
      setPlaying(false);
    } else {
      setCount(0);
      setPlaying(true);
      setPlayToken((t) => t + 1);
    }
  }

  // Autoplay the first scenario the first time the section scrolls into view.
  useEffect(() => {
    if (!inView || hasAutoplayed) return;
    setHasAutoplayed(true);
    playScenario(scenarios[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, hasAutoplayed]);

  // The actual frame-advance engine: a self-contained recursive setTimeout chain (not a
  // chain of separate effect re-runs), started fresh every time playToken changes —
  // i.e. every real playScenario() call, always from frame 0 (see playScenario above).
  useEffect(() => {
    if (playToken === 0 || reducedMotion) return;
    let cancelled = false;
    const frames = activeScenario.frames;
    let index = 0;

    const tick = () => {
      if (cancelled) return;
      if (index >= frames.length) {
        setPlaying(false);
        return;
      }
      const previousFrame = index > 0 ? frames[index - 1] : null;
      const delay = delayForFrame(previousFrame);
      setTimeout(() => {
        if (cancelled) return;
        index += 1;
        setCount(index);
        tick();
      }, delay);
    };

    tick();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playToken]);

  const state = useMemo(() => deriveDemoState(activeScenario.frames, count), [activeScenario, count]);

  const replyNodes = useMemo(
    () =>
      renderReplyMarkdown(state.replyText, {
        paragraph: styles.replyParagraph,
        bulletList: styles.replyBulletList,
        codeBlock: styles.replyCodeBlock,
      }),
    [state.replyText]
  );

  const canReplay = count > 0;

  return (
    <div ref={sectionRef} className={styles.demo}>
      <div className={styles.scenarioTabs} role="tablist" aria-label="Demo scenario">
        {scenarios.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            role="tab"
            id={`demo-tab-${scenario.id}`}
            aria-selected={scenario.id === activeId}
            aria-controls={`demo-panel-${scenario.id}`}
            className={`${styles.scenarioTab} ${scenario.id === activeId ? styles.scenarioTabActive : ""}`}
            onClick={() => playScenario(scenario.id)}
          >
            {scenario.label}
          </button>
        ))}
      </div>

      <div
        className={styles.transcriptCard}
        role="tabpanel"
        id={`demo-panel-${activeScenario.id}`}
        aria-labelledby={`demo-tab-${activeScenario.id}`}
      >
        <div className={styles.transcriptHeader}>
          <span className={styles.transcriptHeaderDot} aria-hidden="true" />
          <span className={styles.transcriptHeaderDot} aria-hidden="true" />
          <span className={styles.transcriptHeaderDot} aria-hidden="true" />
          <span className={styles.transcriptHeaderLabel}>Newton — real captured session</span>
        </div>

        <div className={styles.transcriptBody}>
          {state.showUserMessage && (
            <div className={`${styles.entry} ${styles.entryUser}`}>
              <p className={styles.userMessage}>{activeScenario.user_message}</p>
            </div>
          )}

          {(state.planText !== null || state.toolChips.length > 0 || state.replyText.length > 0) && (
            <div className={`${styles.entry} ${styles.entryAssistant}`}>
              {state.planText !== null && (
                <div className={styles.toolActivity} aria-label="Newton's plan">
                  <span
                    className={`${styles.chip} ${styles.planChip} ${state.planDone ? styles.chipDone : styles.chipRunning}`}
                  >
                    <span className={styles.chipIcon} aria-hidden="true" />
                    <span>{state.planText}</span>
                  </span>
                </div>
              )}

              {state.toolChips.length > 0 && (
                <div className={styles.toolActivity} aria-label="Newton's tool activity">
                  {state.toolChips.map((chip, i) => (
                    <span
                      key={chip.key}
                      className={`${styles.chip} ${chip.running ? styles.chipRunning : styles.chipDone} ${
                        chip.verified ? styles.chipVerified : ""
                      }`}
                      style={{ animationDelay: `${Math.min(i, 6) * 70}ms` }}
                      title={chip.verified ? "Computed with real math/code, not guessed" : undefined}
                    >
                      <span className={styles.chipIcon} aria-hidden="true" />
                      {chip.label}
                      {chip.verified && <VerifiedBadge />}
                    </span>
                  ))}
                </div>
              )}

              {state.replyText.length > 0 && (
                <div className={styles.replyText} aria-live="polite">
                  {replyNodes}
                  {!state.isDone && (
                    <span className={styles.streamCursor} aria-hidden="true">
                      ▍
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {!state.showUserMessage && (
            <p className={styles.transcriptIdle}>Scroll down, or pick a scenario above, to watch a real reply.</p>
          )}
        </div>

        <div className={styles.transcriptFooter}>
          <button
            type="button"
            className={styles.replayButton}
            onClick={() => playScenario(activeScenario.id)}
            disabled={!canReplay && playing}
          >
            <span aria-hidden="true">↺</span> Replay
          </button>
          <p className={styles.transcriptDisclaimer}>
            A real transcript captured from Newton&apos;s actual backend, replayed here — not a live chat.
          </p>
        </div>
      </div>
    </div>
  );
}
