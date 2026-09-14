"""Unit tests for app.services.latex_compile.compile_latex -- follows
tests/test_research_fetch.py / tests/test_tools_web_search.py's convention of standing
in an httpx.MockTransport for the real HTTP layer rather than hitting a live
sandbox-runner (that's covered separately by the real end-to-end live verification)."""

import base64

import httpx

from app.services.latex_compile import compile_latex

_FAKE_PDF = b"%PDF-1.4 fake pdf bytes"


def _transport(handler):
    return httpx.MockTransport(handler)


async def test_compile_latex_success_returns_decoded_pdf_bytes():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/compile-latex"
        body = request.read()
        assert b'"tex"' in body
        return httpx.Response(
            200,
            json={
                "pdf_base64": base64.b64encode(_FAKE_PDF).decode(),
                "log": "compiled fine",
                "success": True,
                "timed_out": False,
            },
        )

    result = await compile_latex("\\documentclass{article}...", transport=_transport(handler))
    assert result.success is True
    assert result.timed_out is False
    assert result.pdf_bytes == _FAKE_PDF
    assert result.log == "compiled fine"


async def test_compile_latex_includes_bib_in_payload_when_given():
    seen_payload = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        seen_payload.update(json.loads(request.read()))
        return httpx.Response(200, json={"pdf_base64": None, "log": "", "success": False, "timed_out": False})

    await compile_latex("tex-source", bib="@misc{a, title={T}}", transport=_transport(handler))
    assert seen_payload.get("bib") == "@misc{a, title={T}}"


async def test_compile_latex_omits_bib_key_when_not_given():
    seen_payload = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        seen_payload.update(json.loads(request.read()))
        return httpx.Response(200, json={"pdf_base64": None, "log": "", "success": True, "timed_out": False})

    await compile_latex("tex-source", transport=_transport(handler))
    assert "bib" not in seen_payload


async def test_compile_latex_failure_returns_no_pdf_and_the_real_log():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"pdf_base64": None, "log": "! Undefined control sequence.", "success": False, "timed_out": False},
        )

    result = await compile_latex("bad tex", transport=_transport(handler))
    assert result.success is False
    assert result.pdf_bytes is None
    assert "Undefined control sequence" in result.log


async def test_compile_latex_network_error_is_reported_not_raised():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    result = await compile_latex("tex-source", transport=_transport(handler))
    assert result.success is False
    assert result.pdf_bytes is None
    assert "could not reach sandbox-runner" in result.log


async def test_compile_latex_timeout_is_reported_as_timed_out():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out", request=request)

    result = await compile_latex("tex-source", transport=_transport(handler))
    assert result.success is False
    assert result.timed_out is True
