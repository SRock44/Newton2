"""Thin client for artifact-runner's `POST /build-artifact` (services/artifact-runner/
app/main.py) -- follows app/services/latex_compile.py's exact conventions for calling a
runner service (same settings-driven base URL, same httpx timeout/error-handling shape,
same "never raises, returns a result object" contract), which in turn follows
app/tools/code_interpreter.py's.

Deliberately NOT an LLM-callable Tool: this is a plain async function the artifact
orchestration layer (app/tools/create_artifact.py) calls directly once an artifact-agent
persona has produced a finished coding brief -- never something the model invokes with an
arbitrary argument. See services/artifact-runner/README.md for what the service itself
isolates, and why it is a second container rather than a new endpoint on sandbox-runner.
"""

from dataclasses import dataclass, field

import httpx

from app.core.config import get_settings

# Generous relative to artifact-runner's own ARTIFACT_WALL_CLOCK_TIMEOUT_S default
# (~300s, see services/artifact-runner/app/main.py), for the same reason
# latex_compile.py's _HTTP_TIMEOUT_S is generous relative to that service's watchdog:
# this needs slack for the request/response round trip on top of the service's own
# budget, not a tighter limit of its own that could fire first and leave the runner's
# accounting as the only real source of truth about what happened.
_HTTP_TIMEOUT_S = 360.0


@dataclass
class ArtifactBuildResult:
    html: str | None
    success: bool
    timed_out: bool
    log: str
    # Real token counts the runner summed from opencode's own `step_finish` events --
    # what app/tools/create_artifact.py charges against the student's credit ledger via
    # billing.record_frontier_usage. 0/0 means opencode reported no usage at all (e.g.
    # the build never got far enough to make a model call).
    input_tokens: int = 0
    output_tokens: int = 0
    attempts: int = 0
    problems: list[str] = field(default_factory=list)


async def build_artifact(
    brief: str,
    model: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ArtifactBuildResult:
    """Hands a finished coding brief to artifact-runner and waits for the real agentic
    build. Never raises -- a request/network failure comes back as a result with
    success=False and the error described in `.log`, the same never-raise convention
    latex_compile.compile_latex and every Tool in this codebase follow.

    `model` is passed explicitly (rather than defaulted inside the runner) so the model
    identifier lives in exactly ONE place for the whole app -- Settings.openrouter_model,
    which is the same string app/services/billing.py prices and app/providers/registry.py
    calls with. The artifact path can never silently drift onto a different model from
    the chat path.

    `transport` is only ever passed in tests (httpx.MockTransport), the same DI hook
    app/services/latex_compile.py and app/tools/web_search.py use."""
    base_url = get_settings().artifact_runner_url
    payload = {"brief": brief, "model": model}

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S, transport=transport) as client:
            response = await client.post(f"{base_url}/build-artifact", json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.TimeoutException:
        return ArtifactBuildResult(
            html=None,
            success=False,
            timed_out=True,
            log="artifact-runner did not respond in time (the build may still be running there).",
        )
    except httpx.HTTPError as exc:
        return ArtifactBuildResult(
            html=None,
            success=False,
            timed_out=False,
            log=f"could not reach artifact-runner at {base_url}: {exc}",
        )

    problems = data.get("problems")
    return ArtifactBuildResult(
        html=data.get("html"),
        success=bool(data.get("success")),
        timed_out=bool(data.get("timed_out")),
        log=data.get("log") or "",
        input_tokens=int(data.get("input_tokens") or 0),
        output_tokens=int(data.get("output_tokens") or 0),
        attempts=int(data.get("attempts") or 0),
        problems=list(problems) if isinstance(problems, list) else [],
    )
