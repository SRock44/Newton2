from arq import cron
from arq.connections import RedisSettings

from app.core.config import get_settings
from app.jobs.consolidate import consolidate_session
from app.jobs.retention import report_inactive_accounts


class WorkerSettings:
    functions = [consolidate_session, report_inactive_accounts]
    # Weekly, off-peak UTC -- report_inactive_accounts is read-only/logging-only (see
    # app/jobs/retention.py's module docstring for the scope decision), so there's no
    # correctness reason to run it more often than that; a real cadence can be revisited
    # once an actual retention *action* (not just a report) exists to schedule.
    cron_jobs = [cron(report_inactive_accounts, weekday=0, hour=4, minute=0)]
    redis_settings = RedisSettings.from_dsn(get_settings().arq_redis_url)
