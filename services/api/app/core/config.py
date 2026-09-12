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


@lru_cache
def get_settings() -> Settings:
    return Settings()
