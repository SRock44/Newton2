# SearXNG (self-hosted web search backend)

`searxng/searxng` running as an internal-only metasearch engine that the `api` service's
`web_search` tool queries over `newton2_net`. Nothing here is published to the host or the
public internet — SearXNG needs genuine outbound internet access (to actually reach Google,
Bing, DuckDuckGo, etc.) but nothing needs to reach *it* from outside the Docker network.

This mirrors the `infra/keycloak/` pattern: a config file checked into the repo and mounted
read-only into the container. `settings.yml` here already has `search.formats: [html, json]`
enabled (disabled by default upstream) and a non-default `secret_key`, so no extra env vars are
required for the app to work.

## Compose service to add to `infra/docker-compose.yml`

Add a `searxng_data` named volume alongside the existing ones (it's SearXNG's on-disk favicon/
result cache — small, but the container's entrypoint insists `__SEARXNG_DATA_PATH`
(`/var/cache/searxng`) exists and is writable, so it can't just be left unmounted):

```yaml
volumes:
  # ...existing volumes...
  newton_searxngdata:
```

Service block:

```yaml
  searxng:
    image: searxng/searxng:latest
    restart: unless-stopped
    volumes:
      - ./searxng/settings.yml:/etc/searxng/settings.yml:ro
      - newton_searxngdata:/var/cache/searxng
    networks: [newton_net]
    mem_limit: 256m
    # No `ports:` — intentionally not published to the host. Only `api` (over
    # newton_net, service name "searxng") ever needs to reach this.
```

No changes needed to the `api`/`worker` `x-api-env` anchor: `SEARXNG_URL` defaults to
`http://searxng:8080` in `app/core/config.py`, which is exactly this service's name and internal
port on `newton_net`, so the default just works. If that ever needs overriding, add
`SEARXNG_URL: http://searxng:8080` to `x-api-env` explicitly.

Internal port is **8080** (SearXNG's Granian server binds `::`/all-interfaces on 8080 inside the
container by default — confirmed via `docker image inspect`, not guessed). That's what `api`
should dial; nothing needs publishing to `127.0.0.1:*` on the host for this service at all.

## Why this is safe to enable JSON output for

`search.formats: [html, json]` in `settings.yml` turns on `GET /search?q=...&format=json`. This
is normally left off in SearXNG's defaults because on a *public* instance it's an easy way for
scrapers to bulk-harvest results. Here it's irrelevant: the container has no published port, so
the only way to reach `/search` at all is from another container already on `newton2_net` —
i.e. `api`.

## Manual verification performed

Brought up a standalone container on the remote box (`sr@192.168.1.101`), attached to the real
`newton2_net` network so DNS/reachability matched the eventual deployment exactly, with this
same `settings.yml` mounted:

```
docker run -d --name searxng-test \
  --network newton2_net \
  -p 127.0.0.1:58090:8080 \
  -v ~/dev/newton2/infra/searxng/settings.yml:/etc/searxng/settings.yml:ro \
  searxng/searxng:latest
```

`curl 'http://127.0.0.1:58090/search?q=test&format=json'` returned real JSON with populated
`results` (title/url/content/engine per hit) — see the top-level task report for the exact
numbers and caveats about upstream engines rate-limiting a fresh self-hosted instance.
`web_search.py` was pointed directly at `http://127.0.0.1:58090` (bypassing the API container)
to confirm parsing end-to-end. The test container and its volume were removed afterward
(`docker rm -f searxng-test`); nothing from this test was left running on the box.
