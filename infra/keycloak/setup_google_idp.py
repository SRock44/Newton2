"""One-time (or re-run-safe) setup: registers Google as a Keycloak Identity Provider
for the "newton" realm, so the desktop app's login screen can offer "Sign in with
Google" alongside local username/password. Run this after any fresh realm import
(the realm-newton.json import file deliberately does NOT contain the Google client
secret -- that's a real credential and does not belong in a file committed to a
public repo).

The `api` container does NOT carry KEYCLOAK_ADMIN_PASSWORD or the Google credentials
in its standing environment (deliberately -- no reason for the long-running app process
to hold admin creds it only needs for this one-time setup). Pass them at exec time,
read from the host's own .env, from infra/:

    ADMIN_PW=$(grep KEYCLOAK_ADMIN_PASSWORD .env | cut -d= -f2)
    GCLIENT_ID=$(grep GOOGLE_CLASSROOM_CLIENT_ID .env | cut -d= -f2-)
    GCLIENT_SECRET=$(grep GOOGLE_CLASSROOM_CLIENT_SECRET .env | cut -d= -f2-)
    docker compose exec \
      -e KEYCLOAK_ADMIN_PASSWORD="$ADMIN_PW" \
      -e GOOGLE_CLASSROOM_CLIENT_ID="$GCLIENT_ID" \
      -e GOOGLE_CLASSROOM_CLIENT_SECRET="$GCLIENT_SECRET" \
      api python /app/keycloak_setup_google_idp.py

(copy this file into the container first, e.g. `docker compose cp
../infra/keycloak/setup_google_idp.py api:/app/keycloak_setup_google_idp.py` --
see infra/README.md for the general remote-box workflow.)
"""

import os

import httpx

KEYCLOAK_INTERNAL_URL = "http://keycloak:8080"
REALM = "newton"


def main() -> None:
    admin_password = os.environ["KEYCLOAK_ADMIN_PASSWORD"]
    client_id = os.environ["GOOGLE_CLASSROOM_CLIENT_ID"]
    client_secret = os.environ["GOOGLE_CLASSROOM_CLIENT_SECRET"]

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

    payload = {
        "alias": "google",
        "providerId": "google",
        "enabled": True,
        "trustEmail": True,
        "storeToken": False,
        "addReadTokenRoleOnCreate": False,
        "config": {
            "clientId": client_id,
            "clientSecret": client_secret,
            "syncMode": "IMPORT",
            "useJwksUrl": "true",
            "defaultScope": "openid email profile",
        },
    }

    existing = httpx.get(
        f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{REALM}/identity-provider/instances/google",
        headers=headers,
    )
    if existing.status_code == 200:
        resp = httpx.put(
            f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{REALM}/identity-provider/instances/google",
            headers=headers,
            json=payload,
        )
        print("updated existing Google IdP:", resp.status_code)
    else:
        resp = httpx.post(
            f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{REALM}/identity-provider/instances",
            headers=headers,
            json=payload,
        )
        print("created Google IdP:", resp.status_code)


if __name__ == "__main__":
    main()
