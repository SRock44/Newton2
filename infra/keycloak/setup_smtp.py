"""One-time (or re-run-safe) setup: configures the "newton" realm's outbound email
(SMTP) settings, so Keycloak can actually send the verification emails required by
`verifyEmail: true` (see realm-newton.json) when a user self-registers with email +
password. The realm import file deliberately does NOT contain SMTP credentials --
those are a real secret and don't belong in a file committed to a public repo.

The `api` container does NOT carry KEYCLOAK_ADMIN_PASSWORD or the SMTP credentials in
its standing environment (deliberately -- no reason for the long-running app process to
hold admin creds it only needs for this one-time setup). Pass them at exec time, read
from the host's own .env, from infra/ (same pattern as setup_google_idp.py):

    ADMIN_PW=$(grep KEYCLOAK_ADMIN_PASSWORD .env | cut -d= -f2)
    SMTP_HOST=$(grep '^SMTP_HOST=' .env | cut -d= -f2-)
    SMTP_PORT=$(grep '^SMTP_PORT=' .env | cut -d= -f2-)
    SMTP_LOGIN=$(grep '^SMTP_LOGIN=' .env | cut -d= -f2-)
    SMTP_PASSWORD=$(grep '^SMTP_PASSWORD=' .env | cut -d= -f2-)
    SMTP_FROM_EMAIL=$(grep '^SMTP_FROM_EMAIL=' .env | cut -d= -f2-)
    SMTP_FROM_NAME=$(grep '^SMTP_FROM_NAME=' .env | cut -d= -f2-)
    docker compose exec \
      -e KEYCLOAK_ADMIN_PASSWORD="$ADMIN_PW" \
      -e SMTP_HOST="$SMTP_HOST" -e SMTP_PORT="$SMTP_PORT" \
      -e SMTP_LOGIN="$SMTP_LOGIN" -e SMTP_PASSWORD="$SMTP_PASSWORD" \
      -e SMTP_FROM_EMAIL="$SMTP_FROM_EMAIL" -e SMTP_FROM_NAME="$SMTP_FROM_NAME" \
      api python /app/keycloak_setup_smtp.py

(copy this file into the container first, e.g. `docker compose cp
../infra/keycloak/setup_smtp.py api:/app/keycloak_setup_smtp.py` -- see
infra/README.md for the general remote-box workflow.)
"""

import os

import httpx

KEYCLOAK_INTERNAL_URL = "http://keycloak:8080"
REALM = "newton"


def main() -> None:
    admin_password = os.environ["KEYCLOAK_ADMIN_PASSWORD"]

    token = httpx.post(
        f"{KEYCLOAK_INTERNAL_URL}/realms/master/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": "admin",
            "password": admin_password,
        },
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    smtp_server = {
        "host": os.environ["SMTP_HOST"],
        "port": os.environ["SMTP_PORT"],
        "from": os.environ["SMTP_FROM_EMAIL"],
        "fromDisplayName": os.environ.get("SMTP_FROM_NAME", "Newton"),
        "auth": "true",
        "user": os.environ["SMTP_LOGIN"],
        "password": os.environ["SMTP_PASSWORD"],
        "starttls": "true",
        "ssl": "false",
    }

    resp = httpx.put(
        f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{REALM}",
        headers=headers,
        json={"smtpServer": smtp_server},
    )
    print("updated realm SMTP settings:", resp.status_code)


if __name__ == "__main__":
    main()
