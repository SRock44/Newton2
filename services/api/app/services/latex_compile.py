"""Thin client for sandbox-runner's `POST /compile-latex` (services/sandbox-runner/app/
main.py) -- follows app/tools/code_interpreter.py's exact conventions for calling that
service (same `sandbox_runner_url` setting, same httpx timeout/error-handling shape).

Deliberately NOT an LLM-callable Tool: this is a plain async function the (separate,
not-yet-built) research-paper-writer orchestration layer calls directly once it has
assembled a complete .tex document, not something the model invokes with an arbitrary
argument. See services/sandbox-runner/README.md for what the endpoint itself isolates.
"""

import base64
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

# Generous relative to sandbox-runner's own LATEX_WALL_CLOCK_TIMEOUT_S default (~45s,
# see services/sandbox-runner/app/main.py) for the same reason code_interpreter.py's
# _HTTP_TIMEOUT_S is generous relative to its own service's watchdog: this needs enough
# slack for the request/response round trip on top of that, not a tighter limit of its
# own that could fire first.
_HTTP_TIMEOUT_S = 60.0


@dataclass
class LatexCompileResult:
    pdf_bytes: bytes | None
    log: str
    success: bool
    timed_out: bool


async def compile_latex(tex: str, bib: str | None = None, engine: str = "pdflatex") -> LatexCompileResult:
    """Sends a LaTeX document (and optional .bib) to sandbox-runner for compilation.
    Never raises -- a request/network failure comes back as a LatexCompileResult with
    success=False and the error described in `.log`, the same never-raise convention
    every Tool in this codebase follows, even though this isn't itself a Tool."""
    base_url = get_settings().sandbox_runner_url
    payload: dict[str, str] = {"tex": tex, "engine": engine}
    if bib is not None:
        payload["bib"] = bib

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
            response = await client.post(f"{base_url}/compile-latex", json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.TimeoutException:
        return LatexCompileResult(
            pdf_bytes=None,
            log="sandbox-runner did not respond in time (the compile may still be running there).",
            success=False,
            timed_out=True,
        )
    except httpx.HTTPError as exc:
        return LatexCompileResult(
            pdf_bytes=None,
            log=f"could not reach sandbox-runner at {base_url}: {exc}",
            success=False,
            timed_out=False,
        )

    pdf_base64 = data.get("pdf_base64")
    pdf_bytes = base64.b64decode(pdf_base64) if pdf_base64 else None
    return LatexCompileResult(
        pdf_bytes=pdf_bytes,
        log=data.get("log") or "",
        success=bool(data.get("success")),
        timed_out=bool(data.get("timed_out")),
    )
