from functools import lru_cache

from cryptography.fernet import Fernet

from app.core.config import get_settings


@lru_cache
def _fernet() -> Fernet:
    """Application-level symmetric encryption for secrets we must store and later read
    back in full (unlike API keys we only ever compare, which live in Settings as
    SecretStr) — right now just Google Classroom OAuth refresh/access tokens. Deliberately
    a key held by the app process, not Postgres' own pgcrypto: a DB dump alone then isn't
    enough to recover a token, since the key never lives in the database.
    """
    settings = get_settings()
    if settings.secret_encryption_key is None:
        raise RuntimeError(
            "SECRET_ENCRYPTION_KEY is not set. Generate one with "
            "`python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"` "
            "and set it in .env before storing any encrypted secret."
        )
    return Fernet(settings.secret_encryption_key.get_secret_value().encode())


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()
