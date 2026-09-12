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
