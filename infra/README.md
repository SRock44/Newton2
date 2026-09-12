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
