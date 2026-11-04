import smtplib
from email.message import EmailMessage

from app.core.config import get_settings


def send_email(to: str, subject: str, body: str) -> None:
    """Minimal transactional email -- smtplib only, no new dependency. Reuses the same
    SMTP relay Keycloak's own verifyEmail flow sends through (infra/keycloak/
    setup_smtp.py / the SMTP_* settings in app/core/config.py), so there's exactly one
    set of email credentials for this whole product, not two. Used today only by
    app/services/edu_verification.py, but written generically (to/subject/body in,
    nothing edu-specific) so a future transactional email doesn't need its own sender.

    Raises RuntimeError (never crashes/hangs) if SMTP isn't configured -- same
    dormant-until-configured posture as the Stripe/Groq integrations in config.py;
    callers turn this into a clear 503, not an unhandled exception.
    """
    settings = get_settings()
    if not settings.smtp_host or not settings.smtp_from_email:
        raise RuntimeError("Email is not configured (SMTP_HOST/SMTP_FROM_EMAIL) -- cannot send email right now")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
    message["To"] = to
    message.set_content(body)

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
        server.starttls()
        if settings.smtp_login and settings.smtp_password:
            server.login(settings.smtp_login, settings.smtp_password.get_secret_value())
        server.send_message(message)
