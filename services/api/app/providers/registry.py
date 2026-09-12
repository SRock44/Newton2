from app.core.config import get_settings
from app.providers.anthropic_provider import AnthropicProvider
from app.providers.base import ChatProvider
from app.providers.echo import EchoProvider
from app.providers.openai_compatible import OpenAICompatibleProvider


def get_provider(byok_anthropic_key: str | None = None) -> tuple[ChatProvider, str]:
    """Pick a provider + model for an agent call.

    Order: caller-supplied BYOK Anthropic key > our Groq key > our OpenRouter key >
    keyless EchoProvider. This is the one place that decides "which model answers" —
    agents never talk to a provider SDK directly.
    """
    settings = get_settings()

    if byok_anthropic_key:
        return AnthropicProvider(byok_anthropic_key), settings.anthropic_model

    if settings.groq_api_key:
        return (
            OpenAICompatibleProvider(base_url="https://api.groq.com/openai/v1", api_key=settings.groq_api_key),
            settings.groq_model,
        )

    if settings.openrouter_api_key:
        return (
            OpenAICompatibleProvider(
                base_url="https://openrouter.ai/api/v1", api_key=settings.openrouter_api_key
            ),
            settings.openrouter_model,
        )

    return EchoProvider(), "echo-dev"
