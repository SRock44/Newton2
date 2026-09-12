from arq.connections import RedisSettings

from app.core.config import get_settings
from app.jobs.consolidate import consolidate_session


class WorkerSettings:
    functions = [consolidate_session]
    redis_settings = RedisSettings.from_dsn(get_settings().arq_redis_url)
