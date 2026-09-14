"""Hermetic test-infrastructure support (Phase 7 "decouple the suite from the shared
live dev box"). Nothing in here is imported by application code (app/) -- it exists
purely to let the pytest suite authenticate against app.core.auth.decode_token without
a real running Keycloak, when HERMETIC_TESTS=1.

See tokens.py (mints RS256 JWTs) and jwks_server.py (serves the matching public JWKS
over real HTTP, since the API process under test is a separate OS process that has to
fetch it the same way it fetches Keycloak's real JWKS today).
"""
