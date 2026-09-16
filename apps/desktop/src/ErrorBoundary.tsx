import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
  info: string | null;
}

/** Last-resort safety net for the whole app (mounted once in main.tsx, wrapping both
 * <App/> and <NotepadWindow/> — this app had zero error boundary anywhere until now).
 * Without this, ANY uncaught render-time exception in EITHER window silently produces
 * a fully blank white screen with no visible clue what happened, in either window's
 * own devtools-free daily use — exactly what surfaced as a real, unexplained "Notepad
 * just shows a white screen" report. This renders the actual error message and
 * component stack as real, readable text instead of nothing, so a real bug is always
 * diagnosable from what's on screen, not just from re-reading source code blind. */
class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: info.componentStack ?? null });
    // eslint-disable-next-line no-console
    console.error("Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          padding: 20,
          fontFamily: "monospace",
          fontSize: 13,
          whiteSpace: "pre-wrap",
          color: "#1a1b23",
          background: "#fdf9f0",
          height: "100vh",
          overflow: "auto",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Newton hit an unexpected error</h2>
        <p>{this.state.error.message}</p>
        <p>{this.state.error.stack}</p>
        {this.state.info && (
          <>
            <h3>Component stack</h3>
            <p>{this.state.info}</p>
          </>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
