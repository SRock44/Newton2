"""One-time (or re-run-safe) setup: applies the Newton login theme + branded display
name to the "newton" realm LIVE, via the admin REST API — for an already-imported realm,
where editing realm-newton.json alone has no effect (realm import only ever runs once,
at bootstrap; infra/README.md is explicit that re-adding `--import-realm` to the standing
startup command would wipe every real account that's signed up since). A genuinely fresh
environment picks this up from realm-newton.json directly and doesn't need this script at
all — it only exists for the gap between "the JSON file says X" and "the live, already-
running realm actually has X".

Same admin-API pattern as keycloak_setup_google_idp.py (see that file's own header for
the full run instructions — this one needs only KEYCLOAK_ADMIN_PASSWORD, none of the
Google-specific vars):

    ADMIN_PW=$(grep KEYCLOAK_ADMIN_PASSWORD .env | cut -d= -f2)
    docker compose exec -e KEYCLOAK_ADMIN_PASSWORD="$ADMIN_PW" api python /app/apply_theme.py

(copy this file into the container first, e.g. `docker compose cp
../infra/keycloak/apply_theme.py api:/app/apply_theme.py`.)

Requires infra/docker-compose.yml's keycloak service to already have the theme directory
mounted (`./keycloak/themes/newton:/opt/keycloak/themes/newton:ro`) and the container
restarted to pick it up — Keycloak discovers themes from disk at startup, not via this
API.
"""

import os

import httpx

KEYCLOAK_INTERNAL_URL = "http://keycloak:8080"
REALM = "newton"

# Only plain displayName, deliberately -- a first attempt set displayNameHtml to an
# inline <svg> logo, and Keycloak's own HTML sanitizer on that field silently stripped
# the <svg>/<radialGradient> elements as unsafe, leaving just the text behind with no
# error anywhere (confirmed by inspecting the real rendered page's DOM, not by reading
# sanitizer docs). The actual logo icon is a real static file instead
# (login/resources/img/newton-mark.svg, shipped as a normal theme resource) painted in
# via newton.css's `#kc-header-wrapper::before` -- no sanitizer involved at all.


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

    # A realm update PUT only touches the fields present in the body -- everything else
    # (clients, users, every other realm setting) is left exactly as it is. Confirmed
    # safe the same way setup_google_idp.py's own PUT is: this never touches `clients`/
    # `users` at all.
    resp = httpx.put(
        f"{KEYCLOAK_INTERNAL_URL}/admin/realms/{REALM}",
        headers=headers,
        json={
            "loginTheme": "newton",
            "displayName": "Newton",
        },
    )
    resp.raise_for_status()
    print("applied Newton login theme + branding to the live realm:", resp.status_code)


if __name__ == "__main__":
    main()
