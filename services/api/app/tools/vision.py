import base64
from typing import Any

import httpx

from app.core.config import get_settings
from app.services.images import get_image_for_session
from app.tools.base import Tool

OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"

VISION_PROMPT = (
    "You are looking at a photo or screenshot a student attached to a tutoring "
    "conversation -- a photo of handwritten work, a textbook page, or a screenshotted "
    "problem. Transcribe what's shown, then solve or explain it clearly and concisely, "
    "the way a tutor would. If it's already-worked handwritten work, check it for "
    "mistakes rather than just re-solving it from scratch."
)


class VisionTool(Tool):
    """Reads an image the student attached to *this* chat session (see
    app/routers/chat.py's image-upload endpoint and app/services/images.py) via a
    vision-capable model, and returns its transcription/solution as a string the Tutor
    incorporates like any other tool result. Deliberately a standalone tool making its
    own one-off multimodal API call rather than a change to the core ChatProvider/
    ChatTurn plumbing (text-only) -- the image never needs to become part of the main
    conversation's message history, just this one read."""

    name = "read_image"
    description = (
        "Reads an image the student has attached to this conversation — a photo of "
        "handwritten work, a textbook page, or a screenshot of a problem — and returns "
        "a transcription plus a solution/explanation. Call this whenever the student's "
        "message references an attached image."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "image_id": {
                "type": "string",
                "description": "The attached image's id, given in the student's message as '[Attached image: <id>]'.",
            },
        },
        "required": ["image_id"],
    }

    def __init__(self, transport: httpx.BaseTransport | None = None, timeout: float = 30.0):
        # `transport` is only ever passed in tests (httpx.MockTransport) so the real
        # request/response path gets exercised without a live OpenRouter call.
        self._transport = transport
        self.timeout = timeout

    async def run(self, image_id: str, session_id: str | None = None) -> str:
        if not session_id:
            return "Error: no active session to read an attached image from."

        settings = get_settings()
        if settings.openrouter_api_key is None:
            return "Error: image reading isn't configured (no OpenRouter key set)."

        found = await get_image_for_session(session_id, image_id)
        if found is None:
            return f"Error: no attached image found with id '{image_id}' in this conversation."
        raw, mime_type = found

        data_url = f"data:{mime_type};base64,{base64.b64encode(raw).decode()}"
        payload = {
            "model": settings.openrouter_vision_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": VISION_PROMPT},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self._transport) as client:
                response = await client.post(
                    OPENROUTER_CHAT_URL,
                    json=payload,
                    headers={"Authorization": f"Bearer {settings.openrouter_api_key.get_secret_value()}"},
                )
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            return f"Error: couldn't read the image ({exc})."

        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            return "Error: the vision model returned an unexpected response."
