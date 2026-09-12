# Dev infra

`docker-compose.yml` brings up everything Newton's backend needs locally: Postgres+pgvector,
MinIO, Redis, Keycloak, and the FastAPI `api` service.

**Isolation:** every port is published to `127.0.0.1` only (never `0.0.0.0`), on high, unique
ports (55432, 56379, 59000/59001, 58180, 58001, 58080) chosen to avoid every port already in
use on a shared box. The whole stack lives under its own Compose project (`name: newton2`) and its
own Docker network (`newton2_net`) — it cannot see or collide with unrelated containers/stacks
on the same host.

```bash
cd infra
cp .env.example .env   # fill in real values
docker compose up -d
docker compose ps
```

Keycloak auto-imports a `newton` realm with a public client `newton-api` and a dev user
(`student1` / `newton-dev`) — dev-only credentials, not for production use.

To get a token and hit the authenticated health check (from inside the network, so the
issuer matches what the API validates against):

```bash
docker compose exec api python -c "
import httpx
tok = httpx.post('http://keycloak:8080/realms/newton/protocol/openid-connect/token', data={
    'grant_type': 'password', 'client_id': 'newton-api',
    'username': 'student1', 'password': 'newton-dev',
}).json()['access_token']
r = httpx.get('http://localhost:8000/health/secure', headers={'Authorization': f'Bearer {tok}'})
print(r.status_code, r.json())
"
```

Tear down: `docker compose down` (add `-v` to also drop the named volumes).

## Enabling a real model

Every agent-driven code path — chat, memory consolidation, study-plan extraction — goes
through the single provider adapter (`services/api/app/providers/registry.py`). Until a
key is set, all of it runs on the keyless `EchoProvider`, which just echoes the input back
(useful for testing the pipeline, useless for actual answers).

Set in `.env`:
```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731   # this is the default already; override if you want a different model
```
then `docker compose up -d --build api worker` (the key applies to both — `worker` runs
the same provider adapter for session-summary consolidation). No other config or code
change is needed; every feature that calls an agent picks this up automatically.

Current model choice: `deepseek/deepseek-v4-flash-0731` via OpenRouter — chosen for cost
($0.03/$0.07 per million input/output tokens) and a 1M context window, used uniformly for
every agent role rather than a tiered "cheap model here, expensive model there" split,
since it's cheap enough that the tiering isn't worth the complexity right now. A user's own
BYOK Anthropic key (if they supply one) still always takes precedence over this — see
`registry.py`.

## Remote dev box

Docker isn't available on the primary Windows dev machine, so this stack runs on a shared
Ubuntu box instead (`sr@192.168.1.101`, key `~/.ssh/id_claude`) that also hosts unrelated
projects. To stay isolated from those:
- Code lives under `~/dev/newton2` on that box (separate from everything else in `~`), synced
  from this repo (e.g. `tar -czf - infra services/api | ssh sr@192.168.1.101 'tar -xzf - -C ~/dev/newton2'`).
- Every port this stack publishes is `127.0.0.1`-only and picked to avoid every port already
  bound on that box (5432, 6379, 80/443, 8000, 8080, 8096, 8920, 9000, 27015, 27020 were all
  taken by other stacks — see `docker ps`/`ss -tlnp` before adding a new published port).
- Real secrets for that box's `.env` are generated on the box itself and never committed.

For local development against it (e.g. running the Tauri app on Windows), open an SSH local
port-forward so `127.0.0.1:58001` etc. on the dev machine reach the same ports on the box:

```
ssh -N -L 58001:127.0.0.1:58001 -L 58080:127.0.0.1:58080 -L 58180:127.0.0.1:58180 -i ~/.ssh/id_claude sr@192.168.1.101
```
