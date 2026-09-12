from app.core.config import Settings
from app.providers import registry as registry_module
from app.providers.anthropic_provider import AnthropicProvider
from app.providers.base import ChatTurn, TextDelta
from app.providers.echo import EchoProvider
from app.providers.openai_compatible import OpenAICompatibleProvider
from app.providers.registry import get_provider

# These monkeypatch app.providers.registry.get_settings with an explicitly-constructed
# Settings instance rather than reading the real deployment's env vars — deliberately,
# so the fallback-priority *logic* is tested deterministically regardless of whether
# this particular environment happens to have a real provider key configured (e.g. a
# dev box with OPENROUTER_API_KEY set for real use must not make this test flaky).


def test_get_provider_falls_back_to_echo_with_no_keys_configured(monkeypatch):
    fake_settings = Settings(groq_api_key=None, openrouter_api_key=None)
    monkeypatch.setattr(registry_module, "get_settings", lambda: fake_settings)

    provider, model = get_provider()
    assert isinstance(provider, EchoProvider)
    assert model == "echo-dev"


def test_get_provider_uses_openrouter_when_only_that_is_configured(monkeypatch):
    fake_settings = Settings(
        groq_api_key=None, openrouter_api_key="fake-or-key", openrouter_model="some/model"
    )
    monkeypatch.setattr(registry_module, "get_settings", lambda: fake_settings)

    provider, model = get_provider()
    assert isinstance(provider, OpenAICompatibleProvider)
    assert provider.base_url == "https://openrouter.ai/api/v1"
    assert provider.api_key == "fake-or-key"  # unwrapped from SecretStr, not leaked in repr
    assert model == "some/model"


def test_get_provider_prefers_groq_over_openrouter_when_both_configured(monkeypatch):
    fake_settings = Settings(
        groq_api_key="fake-groq-key", groq_model="llama-x", openrouter_api_key="fake-or-key"
    )
    monkeypatch.setattr(registry_module, "get_settings", lambda: fake_settings)

    provider, model = get_provider()
    assert isinstance(provider, OpenAICompatibleProvider)
    assert provider.base_url == "https://api.groq.com/openai/v1"
    assert model == "llama-x"


def test_get_provider_prefers_byok_anthropic_over_everything(monkeypatch):
    fake_settings = Settings(groq_api_key="fake-groq-key", openrouter_api_key="fake-or-key")
    monkeypatch.setattr(registry_module, "get_settings", lambda: fake_settings)

    provider, model = get_provider(byok_anthropic_key="fake-anthropic-key")
    assert isinstance(provider, AnthropicProvider)


def test_settings_repr_never_exposes_the_actual_secret_value():
    # Regression test: pydantic's default repr used to print API keys and the MinIO
    # secret in plain text, which is exactly what leaked one into a test failure
    # message during development. SecretStr keeps them out of repr/str entirely.
    settings = Settings(groq_api_key="super-secret-value")
    assert "super-secret-value" not in repr(settings)
    assert "super-secret-value" not in str(settings)


async def test_echo_provider_streams_expected_content():
    provider = EchoProvider()
    message = "what is a derivative?"

    events = [e async for e in provider.stream_chat([ChatTurn(role="user", content=message)], "echo-dev")]

    assert all(isinstance(e, TextDelta) for e in events)
    full = "".join(e.text for e in events)
    assert full == f"[echo/no-provider-configured] you said: {message} "


async def test_echo_provider_handles_no_user_message():
    provider = EchoProvider()

    events = [
        e async for e in provider.stream_chat([ChatTurn(role="system", content="setup only")], "echo-dev")
    ]

    full = "".join(e.text for e in events)
    assert full == "[echo/no-provider-configured] (empty message) "


async def test_echo_provider_never_calls_tools_even_when_offered():
    from app.providers.base import ToolSpec

    provider = EchoProvider()
    tools = [ToolSpec(name="calculator", description="test", parameters={"type": "object"})]

    events = [
        e async for e in provider.stream_chat([ChatTurn(role="user", content="2+2")], "echo-dev", tools=tools)
    ]

    assert all(isinstance(e, TextDelta) for e in events)
