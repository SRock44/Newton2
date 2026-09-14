from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Switch between local dev convenience and a real deployment. Never set by
    # docker-compose.yml or .env.example today (nothing there defines ENV at all), so
    # this defaults to "dev" for the shared dev box and any local run; a real
    # deployment is expected to set ENV to something else (e.g. "production") in its
    # own environment. See check_no_default_secrets() below, which keys off this.
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

    # Self-hosted LanguageTool grammar/style server the grammar_check tool queries.
    # Same internal-only shape as SearXNG above.
    languagetool_url: str = "http://languagetool:8010"

    # Self-hosted speech-to-text (onerahmet/openai-whisper-asr-webservice) and
    # text-to-speech (custom Piper wrapper, services/piper-tts) servers. Same
    # internal-only shape as SearXNG/LanguageTool above.
    whisper_asr_url: str = "http://whisper-asr:9000"
    piper_tts_url: str = "http://piper-tts:8000"

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
    # The main text model above isn't multimodal -- the Vision tool (read_image) makes
    # its own separate OpenRouter call against a model that actually accepts images.
    # The "-latest" alias tracks whatever Gemini Flash OpenRouter currently serves,
    # deliberately not a pinned version -- vision model slugs get deprecated/replaced
    # on OpenRouter's end faster than this file gets updated (found the hard way: the
    # previously pinned google/gemini-2.0-flash-001 had already been removed).
    openrouter_vision_model: str = "~google/gemini-flash-latest"

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

    # Pro subscription tier ($15/mo, see app/routers/billing.py + app/services/billing.py)
    # -- same dormant-until-configured pattern as groq_api_key/openrouter_api_key above:
    # empty by default, and every billing endpoint degrades gracefully (a clear 503, not
    # a crash) until an account owner supplies real values from their own Stripe
    # Dashboard. See the STRIPE_* comments in infra/docker-compose.yml for the exact
    # setup steps.
    stripe_secret_key: SecretStr = SecretStr("")
    stripe_webhook_secret: SecretStr = SecretStr("")
    # The Price object id (price_...) for the $15/mo recurring Pro subscription, created
    # in the Stripe Dashboard -- not something this code can create for itself.
    stripe_price_id_pro: str = ""
    # Tracked frontier-model spend (OpenRouter cost, in cents) a Pro subscriber can use
    # per billing period before their tutor calls quietly fall back to the free-tier
    # model for the rest of that period (see app/services/billing.py's is_pro/
    # pro_credits_remaining and app/agents/tutor.py's routing). Deliberately less than
    # the $15 price to preserve margin after Stripe's own fees and this app's infra
    # cost -- a real, tunable setting rather than a hardcoded literal so it can move
    # without a code change.
    pro_monthly_credit_cents: int = 600


def check_no_default_secrets(settings: Settings) -> None:
    """Refuse to run outside local dev with a publicly-known default secret still in
    place. `minio_secret_key` defaults to the literal string "newton-dev-secret" --
    fine for local dev convenience, but that string is hardcoded in this public repo,
    so nothing previously stopped a real deployment from silently running with the
    exact same secret if whoever deployed it forgot to override `.env`.
    `database_url`'s own Python-level default here uses a different placeholder
    password ("newton"), but infra/docker-compose.yml's `DATABASE_URL` (and the
    `postgres` service's own `POSTGRES_PASSWORD`) fall back to that same
    "newton-dev-secret" string when `.env` doesn't set `POSTGRES_PASSWORD` -- so a
    real deployment run via that compose file without a real `.env` ends up with this
    same default baked into `database_url` too, even though it's spelled differently
    in this file's own defaults.

    This only ever fires when `env` is explicitly set to something other than "dev" --
    never the case for the shared dev box or a local run, since nothing in
    docker-compose.yml or .env.example sets ENV at all. Local dev keeps working
    exactly as before; a real deployment must set ENV *and* override every secret
    below, or it refuses to start.

    NOTE: KEYCLOAK_ADMIN_PASSWORD and the `postgres` container's own
    POSTGRES_PASSWORD are also `newton-dev-secret`-shaped defaults in
    docker-compose.yml, but neither is ever read into this app's Settings (they're
    Keycloak's/Postgres's own container env, invisible to this process except
    indirectly through database_url) -- this check can only guard what the API
    process itself can see.
    """
    if settings.env == "dev":
        return

    offenders: list[str] = []
    if settings.minio_secret_key.get_secret_value() == "newton-dev-secret":
        offenders.append("minio_secret_key (MINIO_SECRET_KEY / MINIO_ROOT_PASSWORD)")
    if "newton-dev-secret" in settings.database_url:
        offenders.append("database_url (DATABASE_URL's embedded POSTGRES_PASSWORD)")

    if offenders:
        raise RuntimeError(
            "Refusing to start: env is set to "
            f"{settings.env!r} (not \"dev\") but the following setting(s) still use "
            "their publicly-known default value from this open-source repo, which is "
            "not safe outside local dev: " + ", ".join(offenders) + ". Set a real "
            "value for each in this deployment's environment/.env before starting."
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
