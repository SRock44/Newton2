// Types + pure derive logic for the "Watch Newton verify, live" demo section
// (src/components/DemoTranscript.tsx). Split out from the component so the actual
// frame-folding logic — the part with real correctness risk (matching tool_end frames
// back to the right tool_start, deciding when the plan chip is "done", etc.) — can be
// unit tested directly against the real captured data without needing to render
// anything or fake timers.

export interface UserMessageSavedFrame {
  type: "user_message_saved";
  id: string;
}

export interface PlanChunkFrame {
  type: "plan_chunk";
  content: string;
}

export interface ToolStartFrame {
  type: "tool_start";
  tool: string;
  label: string;
}

export interface ToolEndFrame {
  type: "tool_end";
  tool: string;
  label: string;
  verified: boolean;
}

export interface ChunkFrame {
  type: "chunk";
  content: string;
}

export interface DoneFrame {
  type: "done";
  [key: string]: unknown;
}

export type DemoFrame =
  | UserMessageSavedFrame
  | PlanChunkFrame
  | ToolStartFrame
  | ToolEndFrame
  | ChunkFrame
  | DoneFrame;

export interface DemoScenario {
  id: string;
  label: string;
  user_message: string;
  frames: DemoFrame[];
}

export interface ToolChipState {
  key: string;
  tool: string;
  label: string;
  running: boolean;
  verified: boolean;
}

export interface DerivedDemoState {
  showUserMessage: boolean;
  /** The plan-narration chip's accumulated real text, or null if this scenario never
   * emits a plan_chunk (only "code-check-fails" does, in the real captured data). */
  planText: string | null;
  /** A plan chip reads as "done" once real reply content starts arriving — mirrors
   * MessageBubble.tsx's `planNarrationDone` in the real desktop app. */
  planDone: boolean;
  toolChips: ToolChipState[];
  replyText: string;
  isDone: boolean;
}

/**
 * Folds the first `count` frames of a real captured transcript into the state the demo
 * UI renders. Deliberately a pure function of (frames, count) rather than incremental
 * mutable state — replaying a scenario, restarting it, or jumping straight to its final
 * state (prefers-reduced-motion) are then all just "pick a different count", with a
 * single code path computing what's on screen either way.
 */
export function deriveDemoState(frames: DemoFrame[], count: number): DerivedDemoState {
  const applied = frames.slice(0, Math.max(0, Math.min(count, frames.length)));

  let showUserMessage = false;
  let planText: string | null = null;
  let planDone = false;
  const toolChips: ToolChipState[] = [];
  let replyText = "";
  let isDone = false;

  for (const frame of applied) {
    switch (frame.type) {
      case "user_message_saved":
        showUserMessage = true;
        break;
      case "plan_chunk":
        planText = (planText ?? "") + frame.content;
        break;
      case "tool_start":
        toolChips.push({
          key: `${toolChips.length}-${frame.tool}`,
          tool: frame.tool,
          label: frame.label,
          running: true,
          verified: false,
        });
        break;
      case "tool_end": {
        // Matches the most recent still-running chip for this tool — real transcripts
        // can run the same tool more than once in a row (see math-catches-mistake's two
        // symbolic_math calls), so this must not just grab the first chip with that name.
        for (let i = toolChips.length - 1; i >= 0; i -= 1) {
          if (toolChips[i].tool === frame.tool && toolChips[i].running) {
            toolChips[i] = { ...toolChips[i], running: false, verified: frame.verified === true };
            break;
          }
        }
        break;
      }
      case "chunk":
        if (planText !== null) planDone = true;
        replyText += frame.content;
        break;
      case "done":
        isDone = true;
        break;
    }
  }

  return { showUserMessage, planText, planDone, toolChips, replyText, isDone };
}

/**
 * How long to hold after revealing `frame` before advancing to the next one. `frame` is
 * null for the very first tick (nothing revealed yet). Timings are chosen to feel snappy
 * rather than replay the network at literal speed — the CONTENT is always the real
 * captured text, only this pacing is synthesized.
 */
export function delayForFrame(frame: DemoFrame | null): number {
  if (frame === null) return 300;
  switch (frame.type) {
    case "user_message_saved":
      return 500;
    case "plan_chunk":
      return 450;
    case "tool_start":
      return 550;
    case "tool_end":
      return 260;
    case "chunk": {
      // A little longer for a chunk that ends a sentence/paragraph so the reveal has a
      // natural cadence instead of a flat metronome; still capped so a long chunk never
      // stalls the reveal.
      const endsClause = /[.,!?\n]\s*$/.test(frame.content);
      return Math.min(70, 16 + frame.content.length * 1.4 + (endsClause ? 60 : 0));
    }
    case "done":
      return 0;
    default:
      return 20;
  }
}
