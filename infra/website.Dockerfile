# syntax=docker/dockerfile:1

# Builds and serves apps/website (the marketing site) PLUS apps/web (the real signed-in
# app) as one Next.js server -- apps/web has no server-rendering needs of its own (a pure
# client SPA, see apps/web/vite.config.ts's `base: "/chat/"`), so its production build
# just becomes static files Next.js serves under public/chat/. See
# apps/website/next.config.ts's own comment for why: in dev, Next proxies /chat/* to a
# live Vite dev server; in production there is no second process, this bakes the SPA's
# build output into this same image instead. Build context MUST be the repo root (not
# apps/website) because apps/web's source tree lives inside apps/desktop/src and is
# loaded from there directly -- see apps/web/vite.config.ts's own comment on why there's
# no second copy. The root .dockerignore keeps that context from including the Rust
# build output or any node_modules tree.

FROM node:22-slim AS web-build
WORKDIR /repo
COPY apps/desktop/package.json apps/desktop/package-lock.json ./apps/desktop/
RUN cd apps/desktop && npm ci
COPY apps/desktop ./apps/desktop
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN cd apps/web && npm ci
COPY apps/web ./apps/web
# Inlined into the built JS at this exact step (Vite's import.meta.env.VITE_* are
# compile-time constants, not read at runtime) -- must be the real public API origin,
# never a loopback/tunnel address, or every fetch/WebSocket call in a real visitor's
# browser would try to reach their OWN machine instead of this one.
ARG VITE_API_URL
ARG VITE_KEYCLOAK_URL
RUN cd apps/web && VITE_API_URL=$VITE_API_URL VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL npm run build

FROM node:22-slim AS website-build
WORKDIR /app
COPY apps/website/package.json apps/website/package-lock.json ./
RUN npm ci
COPY apps/website .
COPY --from=web-build /repo/apps/web/dist ./public/chat
# Also inlined at build time (Next's own NEXT_PUBLIC_* convention, same rule as Vite's
# above) -- apps/website/src/lib/env.ts's APP_URL falls back to a dev-only localhost
# address without this.
ARG NEXT_PUBLIC_APP_URL
RUN NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=website-build /app/node_modules ./node_modules
COPY --from=website-build /app/.next ./.next
COPY --from=website-build /app/public ./public
COPY --from=website-build /app/package.json ./package.json
COPY --from=website-build /app/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["npm", "run", "start", "--", "--port", "3000"]
