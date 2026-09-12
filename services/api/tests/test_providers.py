from app.core.config import get_settings
from app.providers.base import ChatTurn
from app.providers.echo import EchoProvider
from app.providers.registry import get_provider


def test_get_provider_falls_back_to_echo_with_no_keys_configured():
    settings = get_settings()
    # Sanity check the premise: this dev box has no real provider key set, which is
    # exactly the condition the fallback is supposed to handle.
    assert not settings.groq_api_key
    assert not settings.openrouter_api_key

    provider, model = get_provider()
    assert isinstance(provider, EchoProvider)
    assert model == "echo-dev"


async def test_echo_provider_streams_expected_content():
    provider = EchoProvider()
    message = "what is a derivative?"

    chunks = []
    async for chunk in provider.stream_chat([ChatTurn(role="user", content=message)], "echo-dev"):
        chunks.append(chunk)

    full = "".join(chunks)
    assert full == f"[echo/no-provider-configured] you said: {message} "


async def test_echo_provider_handles_no_user_message():
    provider = EchoProvider()

    chunks = []
    async for chunk in provider.stream_chat([ChatTurn(role="system", content="setup only")], "echo-dev"):
        chunks.append(chunk)

    full = "".join(chunks)
    assert full == "[echo/no-provider-configured] (empty message) "
