import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import Composer from "./Composer";

interface HomeComposerProps {
  token: string;
  busy: boolean;
  error: string | null;
  onSend: (text: string) => Promise<boolean>;
}

export function HomeLayout({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return enabled ? <div className="web-home">{children}</div> : <>{children}</>;
}

export default function HomeComposer({ token, busy, error, onSend }: HomeComposerProps) {
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock || typeof ResizeObserver === "undefined") return;
    const updateClearance = () => {
      dock.parentElement?.style.setProperty("--home-composer-height", `${Math.ceil(dock.getBoundingClientRect().height)}px`);
    };
    const observer = new ResizeObserver(updateClearance);
    observer.observe(dock);
    updateClearance();
    return () => observer.disconnect();
  }, []);

  return (
    <div className="home-composer-dock" ref={dockRef}>
      {error && <div className="banner banner--error" role="alert">{error}</div>}
      <Composer home token={token} sessionId={null} disabled={busy} onSend={onSend} />
    </div>
  );
}
