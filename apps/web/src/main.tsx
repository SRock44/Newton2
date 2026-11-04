// apps/web's entire entry point: mount the exact same app apps/desktop mounts, via the
// exact same bootstrap function — not a second, independently-maintained copy of it. See
// apps/desktop/src/bootstrap.tsx's own comment for why this is correct (every import it
// makes resolves against apps/desktop/node_modules automatically because that file is
// physically inside apps/desktop/src) and vite.config.ts's comment for the one thing that
// actually needs aliasing here (react/react-dom, so there's only ever one copy loaded).
import "../../desktop/src/bootstrap";
