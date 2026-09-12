from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"

    database_url: str = "postgresql+asyncpg://newton:newton@postgres:5432/newton"
    redis_url: str = "redis://redis:6379/0"

    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "newton"
    minio_secret_key: str = "newton-dev-secret"
    minio_bucket: str = "newton"
    minio_secure: bool = False

    keycloak_issuer: str = "http://keycloak:8080/realms/newton"
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
    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"
    openrouter_api_key: str | None = None
    openrouter_model: str = "meta-llama/llama-3.3-70b-instruct"
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
