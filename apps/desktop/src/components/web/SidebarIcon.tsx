export type SidebarIconName =
  | "house" | "square-pen" | "files" | "clipboard-list" | "calendar-days"
  | "layers" | "clipboard-check" | "settings" | "circle-question-mark" | "log-out"
  | "panel-left-open" | "panel-left-close" | "panel-right-open" | "panel-right-close";

export default function SidebarIcon({ name }: { name: SidebarIconName }) {
  return <span className="web-sidebar-icon" data-sidebar-icon={name} aria-hidden="true" />;
}
