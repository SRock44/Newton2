"""Mints self-signed RS256 JWTs that app.core.auth.decode_token accepts as valid --
standing in for a real Keycloak password-grant token when HERMETIC_TESTS=1 (see
tests/conftest.py's keycloak_token fixture).

The signing key (keys/test_signing_key.pem, gitignored by the repo's blanket `*.pem`
rule -- deliberately never committed, even though it's test-only and never signs
anything outside a single hermetic run) is generated on first use by
ensure_test_keypair() below and reused for the rest of that run/process tree: whichever
of pytest or jwks_server.py touches it first creates it, the other just reads the file.
decode_token separately pins algorithm/aud/iss regardless, so a token minted here could
never be mistaken for (or replayed against) a real Keycloak-issued token anywhere else.
See jwks_server.py for the matching public half, served to the API process under test.
"""

import os
import time
import uuid
from pathlib import Path

from jose import jwk, jwt

_KEYS_DIR = Path(__file__).parent / "keys"
_PRIVATE_KEY_PATH = _KEYS_DIR / "test_signing_key.pem"
_PUBLIC_KEY_PATH = _KEYS_DIR / "test_signing_key.pub.pem"


def ensure_test_keypair() -> None:
    """Generates keys/test_signing_key(.pub).pem if they don't already exist. Safe to
    call from multiple processes (pytest's conftest, jwks_server.py) -- writes to a
    temp file and atomically renames into place, so a concurrent reader never sees a
    partially-written key, and a process that loses the race to create it just reuses
    whatever the winner wrote."""
    if _PRIVATE_KEY_PATH.exists() and _PUBLIC_KEY_PATH.exists():
        return

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    _KEYS_DIR.mkdir(parents=True, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub_pem = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    for path, data in ((_PRIVATE_KEY_PATH, priv_pem), (_PUBLIC_KEY_PATH, pub_pem)):
        tmp_path = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
        tmp_path.write_bytes(data)
        os.replace(tmp_path, path)


# Arbitrary but fixed -- must match the "kid" the JWKS document advertises (jwks_server.py)
# so python-jose's RS256 verification can pick the right key out of the key set.
KID = "hermetic-test-key-1"

# Stable sub for the suite's "primary" test user, standing in for the real dev realm's
# student1 account that the live-box test run authenticates as. Kept stable (not a
# fresh uuid per token) so get_or_create_user's JIT provisioning reuses the same User
# row across the whole hermetic run, matching how the real password-grant flow always
# authenticates as the same real student1 account today.
DEFAULT_SUB = "hermetic-test-student-1"
DEFAULT_EMAIL = "hermetic-student@newton.test"
DEFAULT_NAME = "Hermetic Test Student"
DEFAULT_PREFERRED_USERNAME = "student1"


def _private_key_pem() -> str:
    ensure_test_keypair()
    return _PRIVATE_KEY_PATH.read_text()


def public_jwk() -> dict:
    """The public half as a JWK dict, for the fake JWKS document."""
    ensure_test_keypair()
    key = jwk.construct(_PUBLIC_KEY_PATH.read_bytes(), algorithm="RS256")
    jwk_dict = key.to_dict()
    jwk_dict.update({"kid": KID, "use": "sig"})
    return jwk_dict


def jwks_document() -> dict:
    return {"keys": [public_jwk()]}


def mint_token(
    *,
    sub: str = DEFAULT_SUB,
    email: str | None = DEFAULT_EMAIL,
    name: str | None = DEFAULT_NAME,
    preferred_username: str | None = DEFAULT_PREFERRED_USERNAME,
    audience: str,
    issuer: str,
    ttl_seconds: int = 3600,
    extra_claims: dict | None = None,
) -> str:
    """Build and sign a JWT with the same shape app.core.auth.decode_token expects from
    a real Keycloak-issued access token (sub/email/name/preferred_username claims, aud/
    iss matching Settings, RS256-signed, a "kid" header resolving to public_jwk() above)."""
    now = int(time.time())
    claims = {
        "sub": sub,
        "iss": issuer,
        "aud": audience,
        "iat": now,
        "exp": now + ttl_seconds,
        "jti": str(uuid.uuid4()),
        "typ": "Bearer",
        "azp": audience,
    }
    if email is not None:
        claims["email"] = email
    if name is not None:
        claims["name"] = name
    if preferred_username is not None:
        claims["preferred_username"] = preferred_username
    if extra_claims:
        claims.update(extra_claims)

    return jwt.encode(
        claims,
        _private_key_pem(),
        algorithm="RS256",
        headers={"kid": KID},
    )
