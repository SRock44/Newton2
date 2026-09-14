import base64
import hashlib
import hmac
import json

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jose import jwk as jose_jwk
from jose import jwt
from jose.constants import ALGORITHMS

from app.core import auth
from app.core.config import get_settings


def _b64u(data: bytes) -> bytes:
    return base64.urlsafe_b64encode(data).rstrip(b"=")


def _rsa_keypair(kid: str):
    """A throwaway RSA keypair + its public JWK, standing in for a real Keycloak
    signing key without needing the live stack."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_jwk = jose_jwk.construct(private_pem, ALGORITHMS.RS256).public_key().to_dict()
    public_jwk["kid"] = kid
    public_jwk["use"] = "sig"
    return private_pem, public_jwk


@pytest.fixture
def rsa_signing_key():
    return _rsa_keypair(kid="test-signing-key")


async def test_decode_token_accepts_valid_rs256_token(monkeypatch, rsa_signing_key):
    """A real RS256-signed token (the only kind Keycloak actually issues, confirmed
    live against the running realm's own JWKS -- its signing key reports
    `"alg": "RS256"`) must still verify after pinning algorithms=["RS256"]."""
    private_pem, public_jwk = rsa_signing_key
    settings = get_settings()

    monkeypatch.setattr(auth, "_get_jwks", _fake_get_jwks({"keys": [public_jwk]}))

    token = jwt.encode(
        {"sub": "student1", "aud": settings.keycloak_audience, "iss": settings.keycloak_issuer},
        private_pem,
        algorithm="RS256",
        headers={"kid": public_jwk["kid"]},
    )

    claims = await auth.decode_token(token)
    assert claims["sub"] == "student1"


async def test_decode_token_rejects_non_rs256_algorithm(monkeypatch, rsa_signing_key):
    """Proves the algorithms=["RS256"] pin is doing real rejection work, not just
    matching incidental behavior of python-jose's key-type checks.

    Simulates a JWKS that (however it happened -- a misconfiguration, a compromised
    key, a different IdP setup) contains a symmetric key alongside the real RSA
    signing key, and a token that is a *genuinely, cryptographically validly signed*
    HS256 token against that symmetric key -- i.e. exactly the "attacker/rogue key
    controls a different alg than the app expects" shape RFC 8725 warns about.

    Before this fix (no `algorithms=` argument to jwt.decode), such a token would
    have been accepted outright, since python-jose trusts the token's own `alg`
    header to pick which key/algorithm to verify with. This test asserts that
    directly, then asserts decode_token (with the fix) now rejects the same token.
    """
    private_pem, rsa_public_jwk = rsa_signing_key
    settings = get_settings()

    hmac_secret = b"some-symmetric-key-that-should-never-be-trusted-for-this-token"
    oct_jwk = {"kty": "oct", "k": _b64u(hmac_secret).decode(), "kid": "rogue-hmac-key", "use": "sig"}
    # Order matters for the "pre-fix" demonstration below: python-jose's own
    # _sig_matches_keys stops at the first key whose type can't even be constructed
    # for the token's claimed alg (raises immediately, uncaught, rather than trying
    # the next key) -- so the oct key must come first for the HS256 forgery to reach
    # a real signature check at all. The fix (pinning algorithms=["RS256"]) rejects
    # the token before any key is even looked at, so this ordering is irrelevant to
    # the post-fix assertion below.
    jwks = {"keys": [oct_jwk, rsa_public_jwk]}

    header = {"alg": "HS256", "typ": "JWT", "kid": oct_jwk["kid"]}
    claims = {"sub": "attacker", "aud": settings.keycloak_audience, "iss": settings.keycloak_issuer}
    signing_input = (
        _b64u(json.dumps(header, separators=(",", ":")).encode())
        + b"."
        + _b64u(json.dumps(claims, separators=(",", ":")).encode())
    )
    signature = hmac.new(hmac_secret, signing_input, hashlib.sha256).digest()
    forged_token = (signing_input + b"." + _b64u(signature)).decode()

    # Demonstrate the pre-fix gap directly: without pinning `algorithms=`, this
    # genuinely-HMAC-signed-against-a-key-in-the-jwks token verifies cleanly.
    pre_fix_result = jwt.decode(
        forged_token, jwks, audience=settings.keycloak_audience, issuer=settings.keycloak_issuer
    )
    assert pre_fix_result["sub"] == "attacker"

    # Post-fix: decode_token (algorithms=["RS256"]) must reject it.
    monkeypatch.setattr(auth, "_get_jwks", _fake_get_jwks(jwks))
    with pytest.raises(HTTPException) as exc_info:
        await auth.decode_token(forged_token)
    assert exc_info.value.status_code == 401


def _fake_get_jwks(jwks: dict):
    async def _get_jwks():
        return jwks

    return _get_jwks
