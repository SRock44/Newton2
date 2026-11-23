import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH,
  CONTEXT_PANEL_DEFAULT_WIDTH, CONTEXT_PANEL_MIN_WIDTH, CONTEXT_PANEL_MAX_WIDTH,
  getSidebarCollapsed, setSidebarCollapsed, getSidebarWidth, setSidebarWidth,
  getContextPanelCollapsed, setContextPanelCollapsed, getContextPanelWidth, setContextPanelWidth,
} from "../lib/preferences";
import { usePanelResize } from "../lib/usePanelResize";
import { webSidebarsEnabled } from "../lib/webSidebars";
import PanelResizeHandle from "./PanelResizeHandle";
import SidebarIcon from "./web/SidebarIcon";

interface SlotState {
  toggle: ReactNode;
  open: boolean;
  pinned: boolean;
}

interface SidebarFrameProps {
  side: "left" | "right";
  label: string;
  tour?: string;
  rail: (state: SlotState) => ReactNode;
  children: (state: SlotState) => ReactNode;
}

/** Owns panel chrome only; Sidebar and ContextPanel supply their content once. */
export default function SidebarFrame(props: SidebarFrameProps) {
  return webSidebarsEnabled() ? <WebSidebarFrame {...props} /> : <DesktopSidebarFrame {...props} />;
}

function DesktopSidebarFrame({ side, label, tour, rail, children }: SidebarFrameProps) {
  const left = side === "left";
  const [collapsed, setCollapsed] = useState(left ? getSidebarCollapsed : getContextPanelCollapsed);
  const persistCollapsed = left ? setSidebarCollapsed : setContextPanelCollapsed;
  const min = left ? SIDEBAR_MIN_WIDTH : CONTEXT_PANEL_MIN_WIDTH;
  const max = left ? SIDEBAR_MAX_WIDTH : CONTEXT_PANEL_MAX_WIDTH;
  const resize = usePanelResize({
    initial: left ? getSidebarWidth() : getContextPanelWidth(),
    defaultWidth: left ? SIDEBAR_DEFAULT_WIDTH : CONTEXT_PANEL_DEFAULT_WIDTH,
    min, max, direction: left ? 1 : -1,
    persist: left ? setSidebarWidth : setContextPanelWidth,
  });
  const action = `${collapsed ? "Expand" : "Collapse"} ${label}`;
  const toggle = (
    <button
      type="button" className="sidebar-collapse-toggle" aria-label={action} title={action}
      onClick={() => setCollapsed((previous) => {
        const next = !previous;
        persistCollapsed(next);
        return next;
      })}
    >
      {left === collapsed ? "»" : "«"}
    </button>
  );
  const state = { toggle, open: !collapsed, pinned: !collapsed };
  const className = left ? "sidebar" : "right-panel";

  if (collapsed) {
    return <aside className={`${className} ${className}--collapsed`} data-tour={tour}>{rail(state)}</aside>;
  }

  const handle = <PanelResizeHandle label={`Resize ${label}`} min={min} max={max} {...resize} />;
  return (
    <>
      {/* Desktop handles remain siblings on the inner edge of each panel. */}
      {!left && handle}
      <aside
        className={className} data-tour={tour}
        style={{ [left ? "--sidebar-width" : "--context-panel-width"]: `${resize.width}px` } as CSSProperties}
      >
        {children(state)}
      </aside>
      {left && handle}
    </>
  );
}

function WebSidebarFrame({ side, label, tour, rail, children }: SidebarFrameProps) {
  const left = side === "left";
  const persistCollapsed = left ? setSidebarCollapsed : setContextPanelCollapsed;
  const [collapsed, setCollapsed] = useState(left ? getSidebarCollapsed : getContextPanelCollapsed);
  const [preview, setPreview] = useState(false);
  const collapsedRef = useRef(collapsed);
  const rootRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerInside = useRef(false);
  const pointerFocus = useRef(false);
  const suppressFocus = useRef(false);
  const focusAfterToggle = useRef<"rail" | "panel" | null>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = !collapsed || preview;
  const min = left ? SIDEBAR_MIN_WIDTH : CONTEXT_PANEL_MIN_WIDTH;
  const max = left ? SIDEBAR_MAX_WIDTH : CONTEXT_PANEL_MAX_WIDTH;
  const resize = usePanelResize({
    initial: left ? getSidebarWidth() : getContextPanelWidth(),
    defaultWidth: left ? SIDEBAR_DEFAULT_WIDTH : CONTEXT_PANEL_DEFAULT_WIDTH,
    min, max, direction: left ? 1 : -1,
    persist: left ? setSidebarWidth : setContextPanelWidth,
  });

  const clearTimers = useCallback(() => {
    if (enterTimer.current !== null) clearTimeout(enterTimer.current);
    if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    enterTimer.current = null;
    leaveTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  function scheduleClose() {
    clearTimers();
    leaveTimer.current = setTimeout(() => {
      if (collapsedRef.current && !pointerInside.current && !rootRef.current?.contains(document.activeElement)) {
        setPreview(false);
      }
    }, 180);
  }

  function changePinned(pinned: boolean, keyboard: boolean) {
    clearTimers();
    collapsedRef.current = !pinned;
    setPreview(false);
    setCollapsed(!pinned);
    persistCollapsed(!pinned);
    focusAfterToggle.current = pinned ? "panel" : keyboard ? "rail" : null;
    if (!pinned && !keyboard && document.activeElement instanceof HTMLElement && rootRef.current?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  useLayoutEffect(() => {
    const destination = focusAfterToggle.current;
    if (destination) {
      focusAfterToggle.current = null;
      suppressFocus.current = true;
      (destination === "rail" ? railRef : panelRef).current
        ?.querySelector<HTMLButtonElement>("[data-sidebar-toggle]")?.focus({ preventScroll: true });
      suppressFocus.current = false;
      return;
    }
    if (open && railRef.current?.contains(document.activeElement)) {
      const action = (document.activeElement as HTMLElement).dataset.sidebarAction;
      const target = action
        ? panelRef.current?.querySelector<HTMLButtonElement>(`[data-sidebar-action="${action}"]`)
        : null;
      (target ?? panelRef.current?.querySelector<HTMLButtonElement>("[data-sidebar-toggle]"))?.focus({ preventScroll: true });
    }
  }, [open, collapsed]);

  function toggleControl() {
    const icon = left
      ? collapsed ? "panel-left-open" : "panel-left-close"
      : collapsed ? "panel-right-open" : "panel-right-close";
    const action = `${collapsed ? "Pin" : "Unpin"} ${label}`;
    return (
      <button
        type="button" className="web-sidebar-toggle" data-sidebar-toggle data-sidebar-action="toggle"
        aria-label={action} title={action} aria-pressed={!collapsed}
        onClick={(event) => changePinned(collapsed, event.detail === 0)}
      >
        <SidebarIcon name={icon} />
      </button>
    );
  }

  return (
    <aside
      ref={rootRef} className={`web-sidebar web-sidebar--${side}`} aria-label={left ? "Navigation sidebar" : "Newton context"}
      data-pinned={!collapsed} data-open={open} data-tour={tour}
      style={{ "--web-sidebar-width": `${resize.width}px` } as CSSProperties}
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") return;
        pointerInside.current = true;
        clearTimers();
        if (collapsedRef.current) enterTimer.current = setTimeout(() => setPreview(true), 100);
      }}
      onPointerLeave={() => { pointerInside.current = false; pointerFocus.current = false; scheduleClose(); }}
      onPointerDownCapture={() => { pointerFocus.current = true; clearTimers(); }}
      onPointerUpCapture={(event) => {
        pointerFocus.current = false;
        if (event.pointerType !== "touch" && collapsedRef.current && pointerInside.current) {
          enterTimer.current = setTimeout(() => setPreview(true), 100);
        }
      }}
      onPointerCancel={() => { pointerFocus.current = false; scheduleClose(); }}
      onFocusCapture={() => {
        if (suppressFocus.current || pointerFocus.current) return;
        clearTimers();
        if (collapsedRef.current) setPreview(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !pointerInside.current) scheduleClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        changePinned(false, true);
      }}
    >
      <div ref={railRef} className="web-sidebar-rail" aria-hidden={open} inert={open}>
        {rail({ toggle: toggleControl(), open, pinned: !collapsed })}
      </div>
      <div ref={panelRef} className="web-sidebar-panel" aria-hidden={!open} inert={!open}>
        {children({ toggle: toggleControl(), open, pinned: !collapsed })}
        {!collapsed && (
          <div className="web-sidebar-resize">
            <PanelResizeHandle label={left ? "Resize sidebar" : "Resize Newton context"} min={min} max={max} {...resize} />
          </div>
        )}
      </div>
    </aside>
  );
}
