import pytest

from app.core.config import Settings, check_no_default_secrets

# Deliberately pinned explicitly in every test below, rather than relying on ambient
# env / .env to leave these fields at Settings' own class defaults: pydantic-settings
# reads real environment values ahead of the class default, and this exact deployment
# already has a real (non-default) MINIO_SECRET_KEY/POSTGRES_PASSWORD in its own .env
# -- so "just construct Settings() and assume the default is still in effect" would
# silently test nothing on a properly-configured box. Pinning makes these tests
# deterministic regardless of whatever the surrounding environment happens to have.
DEFAULT_MINIO_SECRET = "newton-dev-secret"
DEFAULT_DATABASE_URL = f"postgresql+asyncpg://newton:{DEFAULT_MINIO_SECRET}@postgres:5432/newton"
OVERRIDDEN_MINIO_SECRET = "a-real-randomly-generated-secret"
OVERRIDDEN_DATABASE_URL = "postgresql+asyncpg://newton:a-real-randomly-generated-password@postgres:5432/newton"


def test_check_no_default_secrets_is_a_noop_in_dev():
    """Local dev (env="dev", the default) must keep working exactly as before, even
    with every secret still at its known default value."""
    settings = Settings(env="dev", minio_secret_key=DEFAULT_MINIO_SECRET, database_url=DEFAULT_DATABASE_URL)

    check_no_default_secrets(settings)  # must not raise


@pytest.mark.parametrize(
    "overrides",
    [
        {"minio_secret_key": DEFAULT_MINIO_SECRET, "database_url": OVERRIDDEN_DATABASE_URL},
        {"minio_secret_key": OVERRIDDEN_MINIO_SECRET, "database_url": DEFAULT_DATABASE_URL},
    ],
    ids=["default-minio-secret", "default-database-password"],
)
def test_check_no_default_secrets_raises_outside_dev_with_a_default_secret(overrides):
    settings = Settings(env="production", **overrides)

    with pytest.raises(RuntimeError, match="Refusing to start"):
        check_no_default_secrets(settings)


def test_check_no_default_secrets_passes_outside_dev_once_secrets_are_overridden():
    """The app must start cleanly outside dev once every default-shaped secret has
    actually been overridden."""
    settings = Settings(
        env="production",
        minio_secret_key=OVERRIDDEN_MINIO_SECRET,
        database_url=OVERRIDDEN_DATABASE_URL,
    )

    check_no_default_secrets(settings)  # must not raise


def test_app_module_imports_cleanly_with_default_dev_settings():
    """End-to-end sanity check that the guard doesn't accidentally block the normal
    (dev) app startup path this whole test suite already depends on."""
    import app.main  # noqa: F401 -- import success is the assertion
