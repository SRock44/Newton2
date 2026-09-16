import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ContextMenuProps {
  onDeleteSession: (sessionId: string) => void;
  /** Message editing (ROADMAP.md): starts editing the student's own previous message —
   * offered only on user-role messages that already have a real, persisted id (see
   * types.ts's ChatMessage.id doc comment). Optional so existing call sites/tests that
   * never need editing (e.g. the login/age-gate screens) don't need to pass it. */
  onEditMessage?: (messageId: string, content: string) => void;
  /** True while a reply is generating — editing an earlier message mid-stream would
   * race the in-flight generation, so the "Edit message" item is offered but disabled,
   * same as Composer already disables sending a new message while `isStreaming`. */
  editDisabled?: boolean;
}

/** Replaces the WebView's default right-click menu (Reload/Print/Inspect — none of it
 * applies to a native-feeling desktop app) with one built from whatever was actually
 * right-clicked, found via the nearest ancestor's `data-context-menu` attribute: a chat
 * session in the sidebar gets "Delete chat", a message bubble gets "Copy message", a text
 * input gets Cut/Copy/Paste/Select all (re-implemented on top of `document.execCommand`
 * since suppressing the native menu also suppresses the browser's own edit commands).
 * Falls back to a plain "Copy" when there's a text selection but no recognized target, and
 * to no menu at all otherwise — the native menu is still gone, but there's nothing useful
 * to offer. Mounted once near the root; listens on `document`, so it works everywhere. */
function ContextMenu({ onDeleteSession, onEditMessage, editDisabled }: ContextMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleContextMenu(e: MouseEvent) {
      e.preventDefault();

      const target = e.target as HTMLElement | null;
      const menuTarget = target?.closest<HTMLElement>("[data-context-menu]") ?? null;
      let items: ContextMenuItem[] = [];

      const kind = menuTarget?.dataset.contextMenu;
      if (kind === "session" && menuTarget?.dataset.sessionId) {
        const sessionId = menuTarget.dataset.sessionId;
        items = [{ label: "Delete chat", danger: true, onSelect: () => onDeleteSession(sessionId) }];
      } else if (kind === "message") {
        const content = menuTarget?.dataset.messageContent ?? "";
        const role = menuTarget?.dataset.messageRole;
        const messageId = menuTarget?.dataset.messageId;
        items = [
          {
            label: "Copy message",
            disabled: !content,
            onSelect: () => void navigator.clipboard.writeText(content),
          },
        ];
        // Edit is only ever offered on the student's OWN messages (never Newton's
        // replies — this is "edit what I said," not "edit what Newton said"), and only
        // once a real, persisted id is known (see types.ts's ChatMessage.id doc
        // comment) — without it there's nothing to pass to the delete-and-truncate
        // endpoint.
        if (role === "user" && messageId && onEditMessage) {
          items.push({
            label: "Edit message",
            disabled: Boolean(editDisabled),
            onSelect: () => onEditMessage(messageId, content),
          });
        }
      } else if (kind === "editable") {
        const field = menuTarget as HTMLInputElement | HTMLTextAreaElement;
        const hasSelection = field.selectionStart !== field.selectionEnd;
        items = [
          { label: "Cut", disabled: !hasSelection, onSelect: () => document.execCommand("cut") },
          { label: "Copy", disabled: !hasSelection, onSelect: () => document.execCommand("copy") },
          { label: "Paste", onSelect: () => document.execCommand("paste") },
          { label: "Select all", onSelect: () => document.execCommand("selectAll") },
        ];
      }

      if (items.length === 0) {
        const selected = window.getSelection()?.toString();
        if (selected) {
          items = [{ label: "Copy", onSelect: () => void navigator.clipboard.writeText(selected) }];
        }
      }

      setMenu(items.length > 0 ? { x: e.clientX, y: e.clientY, items } : null);
    }

    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, [onDeleteSession, onEditMessage, editDisabled]);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 6;
    let { x, y } = menu;
    if (x + rect.width > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (y + rect.height > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    if (x !== menu.x || y !== menu.y) {
      setMenu((m) => (m ? { ...m, x, y } : m));
    }
  }, [menu]);

  useEffect(() => {
    if (!menu) return;

    function close(e: Event) {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    }

    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
    >
      {menu.items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`context-menu-item${item.danger ? " context-menu-item--danger" : ""}`}
          disabled={item.disabled}
          onClick={() => {
            item.onSelect();
            setMenu(null);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default ContextMenu;
