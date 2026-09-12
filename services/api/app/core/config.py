from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"

    database_url: str = "postgresql+asyncpg://newton:newton@postgres:5432/newton"
    redis_url: str = "redis://redis:6379/0"

    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "newton"
    minio_secret_key: SecretStr = SecretStr("newton-dev-secret")
    minio_bucket: str = "newton"
    minio_secure: bool = False

    # How this container reaches Keycloak over the Docker network (JWKS/discovery fetch,
    # and pytest's own Direct Grant login) -- always reachable regardless of Keycloak's
    # hostname config, unlike keycloak_issuer below.
    keycloak_internal_url: str = "http://keycloak:8080/realms/newton"
    # The `iss` claim to validate tokens against -- must match Keycloak's KC_HOSTNAME
    # (infra/docker-compose.yml), i.e. the address a real browser reaches it at, since
    # that's what Keycloak stamps into every token it issues. NOT the same as
    # keycloak_internal_url above; keep both in sync with docker-compose.yml by hand.
    keycloak_issuer: str = "http://127.0.0.1:58180/realms/newton"
    keycloak_audience: str = "newton-api"

    # Self-hosted SearXNG metasearch instance the web_search tool queries. Internal-only
    # (never published to the host or the public internet) — reachable at this address
    # only from other containers on the compose network. See infra/searxng/README.md.
    searxng_url: str = "http://searxng:8080"

    # Origins the Tauri webview runs under: Vite dev server, and the custom-protocol
    # origins WebView2/WKWebView use for a packaged app in production.
    cors_allow_origins: list[str] = [
        "http://localhost:1420",
        "tauri://localhost",
        "https://tauri.localhost",
    ]

    # Provider adapter: our own cost-conscious defaults (Groq/OpenRouter), tried in this
    # order. If neither key is set, agents fall back to the keyless EchoProvider so the
    # rest of the pipeline still runs. A per-request BYOK Anthropic key always wins.
    groq_api_key: SecretStr | None = None
    groq_model: str = "llama-3.3-70b-versatile"
    openrouter_api_key: SecretStr | None = None
    openrouter_model: str = "deepseek/deepseek-v4-flash-0731"
    anthropic_model: str = "claude-sonnet-4-5"

    # Background jobs (memory consolidation, embeddings, etc.)
    arq_redis_url: str = "redis://redis:6379/1"

    # Base URL of the sandbox-runner service (see services/sandbox-runner/) used by the
    # code_interpreter tool to execute untrusted Python. That service is not deployed yet
    # — see its README for the required internal-only-network compose shape — so this
    # default only resolves once it's wired in.
    sandbox_runner_url: str = "http://sandbox-runner:8000"

    # Self-hosted embedding model (fastembed/ONNX, CPU, no API key) used for both
    # document RAG and profile-fact retrieval.
    embed_cache_dir: str = "/data/fastembed_cache"

    # Google Classroom data connector: deliberately a SEPARATE OAuth grant from the
    # Keycloak-brokered Google *login* (see infra/keycloak/setup_google_idp.py) even
    # though both reuse the same Google Cloud OAuth client -- login only ever requests
    # `openid email profile`, kept minimal on purpose, while this requests Classroom-
    # specific read scopes and is opt-in per user, independent of how they signed in.
    google_classroom_client_id: str | None = None
    google_classroom_client_secret: SecretStr | None = None
    # This container's own address, reachable by the browser Google redirects back to
    # after consent -- NOT a Keycloak URL. Must be registered as an Authorized redirect
    # URI on the Google Cloud OAuth client (Console > Credentials), same client as the
    # login IdP's, added as an *additional* redirect URI alongside Keycloak's.
    google_classroom_redirect_uri: str = "http://127.0.0.1:58001/integrations/classroom/callback"

    # Symmetric key (Fernet) this app uses to encrypt Classroom OAuth tokens before they
    # touch Postgres — see app/core/crypto.py. Generate one with `python -c "from
    # cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
    secret_encryption_key: SecretStr | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
