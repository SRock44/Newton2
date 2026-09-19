"""check_code_work -- the code counterpart of check_work.py's `check_student_work`.

Same philosophy, same honesty conventions: it VERIFIES a student's own work by running
it for real and reports exactly what happened, rather than producing a solution for
them. Where check_student_work's ground truth is SymPy's symbolic computation, this
tool's ground truth is a real Python process in the sandbox -- pytest's own per-test
outcomes and the student's own real tracebacks. Nothing in the response is a model's
opinion about whether the code "looks right"; every line of it is something that
actually happened when their code ran.

The hard rule this tool exists to keep (and which its description and Tutor's system
prompt both state in plain language): the `files` it is handed are the STUDENT'S code,
run byte-for-byte as submitted. This tool never writes, repairs, reformats or
"helpfully adjusts" a submission -- not here, and not in sandbox-runner, which refuses a
submission rather than clobbering a file (see its `_validate_submission`). Writing TESTS
from an assignment description is fair game for the tutor; writing the solution is not.

SCOPE (deliberate, same convention as sandbox-runner's own module docstring): Python
only. Checking a Java/C/C++ submission would need real compiler toolchains added to the
sandbox-runner image plus a per-language compile-then-run step -- a real, separate piece
of work with its own security review, not a small extension of this one. It is not
attempted here, and neither this tool's description nor Tutor's prompt claims otherwise.
"""

from typing import Any

import httpx

from app.core.config import get_settings
from app.tools.base import Tool

# Same reasoning as code_interpreter.py's own constant: generous relative to
# sandbox-runner's internal wall-clock watchdog (~10s, shared by /execute and /run-code)
# so the round trip has slack and the sandbox's own accounting stays the source of truth
# on timeouts. A little longer than code_interpreter's 20s because a pytest run's process
# startup sits inside that same budget.
_HTTP_TIMEOUT_S = 25.0

# How many per-test rows get rendered in full before the rest are summarized. A student
# submission with hundreds of failing tests is a broken submission, not a hundred
# distinct lessons -- showing every traceback would just bury the first real cause.
_MAX_RENDERED_TESTS = 25

_NEVER_WRITE_THEIR_CODE = (
    "Do NOT write, rewrite, or paste a corrected version of their code. Point at the "
    "specific failing test and the specific real output above, ask what they expected "
    "that line to do, and let them make the fix."
)


def _normalize_files(files: Any) -> dict[str, str] | str:
    """Accepts the documented `{"main.py": "..."}` mapping, and also tolerates the
    `[{"filename": ..., "content": ...}]` list shape models sometimes emit for a
    map-valued parameter. Returns the normalized dict, or an "Error: ..." string."""
    if isinstance(files, dict):
        normalized = files
    elif isinstance(files, list):
        normalized = {}
        for entry in files:
            if not isinstance(entry, dict):
                return "Error: files must map a filename to that file's content."
            name = entry.get("filename") or entry.get("name") or entry.get("path")
            content = entry.get("content") or entry.get("source") or entry.get("code")
            if not isinstance(name, str) or not isinstance(content, str):
                return "Error: each file entry needs a filename and its content, both strings."
            normalized[name] = content
    else:
        return "Error: files must map a filename to that file's content."

    if not normalized:
        return "Error: files must contain at least one file -- the student's own code."
    for name, content in normalized.items():
        if not isinstance(name, str) or not isinstance(content, str):
            return "Error: files must map a filename to that file's content."
        if not content.strip():
            return f"Error: file '{name}' is empty -- submit the student's actual code."
    return normalized


def _render_test_rows(tests: list[dict]) -> list[str]:
    lines: list[str] = []
    for test in tests[:_MAX_RENDERED_TESTS]:
        outcome = str(test.get("outcome", "?"))
        label = {"passed": "PASS", "failed": "FAIL", "error": "ERROR", "skipped": "SKIP"}.get(
            outcome, outcome.upper()
        )
        lines.append(f"{label}  {test.get('name', '<unnamed>')}")
        message = (test.get("message") or "").strip()
        if message and outcome != "passed":
            indented = "\n".join(f"    {ln}" for ln in message.splitlines())
            lines.append(indented)
    remaining = len(tests) - _MAX_RENDERED_TESTS
    if remaining > 0:
        lines.append(f"...and {remaining} more test result(s), not shown.")
    return lines


def _format_test_run(result: dict, filenames: list[str]) -> str:
    tests = result.get("tests") or []
    passed = int(result.get("passed") or 0)
    failed = int(result.get("failed") or 0)
    errors = int(result.get("errors") or 0)
    skipped = int(result.get("skipped") or 0)
    total = passed + failed + errors + skipped
    timed_out = bool(result.get("timed_out"))
    exit_code = result.get("exit_code")

    header = [
        "REAL EXECUTION RESULT -- the student's own code was run, unmodified, against "
        "the tests. Everything below is actual pytest output and actual tracebacks from "
        "that run, not a judgement about how the code looks.",
        "",
        f"Files run exactly as submitted: {', '.join(filenames)}",
    ]

    if timed_out:
        header += [
            "",
            "TIMED OUT. The run was killed by the sandbox's wall-clock watchdog before "
            "the tests finished -- that usually means an infinite loop or unbounded "
            "recursion in the student's code (or in a test), not a slow machine. "
            f"pytest exit code: {exit_code}.",
        ]
        if tests:
            header += ["", "Tests that did report before the kill:"] + _render_test_rows(tests)
        header += [
            "",
            "Tell them plainly that it never terminated, and help them find WHICH loop "
            f"or recursive call doesn't make progress. {_NEVER_WRITE_THEIR_CODE}",
        ]
        return "\n".join(header + _raw_output_block(result))

    if not tests:
        header += [
            "",
            "NO TEST RESULTS. pytest reported no individual tests -- most often the "
            "test file collected nothing, or the run failed before any test could start. "
            f"pytest exit code: {exit_code}. The raw output below is the real reason; "
            "read it and say what actually happened rather than guessing.",
        ]
        return "\n".join(header + _raw_output_block(result))

    if failed == 0 and errors == 0:
        verdict = f"ALL {passed} TEST(S) PASSED."
        if skipped:
            verdict += f" ({skipped} skipped.)"
        guidance = (
            "Confirm this briefly and specifically -- their code really did pass these "
            "tests. Be honest about the limit of that: it means it passed THESE tests, "
            "not that it is correct for every possible input. If an obvious case isn't "
            "covered, say which one and invite them to test it."
        )
    else:
        verdict = (
            f"TESTS FAILED: {passed} passed, {failed} failed, {errors} error(s)"
            + (f", {skipped} skipped" if skipped else "")
            + f" out of {total}."
        )
        guidance = (
            "Use the real failures above -- quote the specific assertion or traceback "
            f"line that shows what went wrong. {_NEVER_WRITE_THEIR_CODE}"
        )

    body = header + ["", verdict, "", "--- Per-test results (from pytest itself) ---"]
    body += _render_test_rows(tests)
    body += ["", guidance]
    return "\n".join(body + _raw_output_block(result))


def _raw_output_block(result: dict) -> list[str]:
    stdout = (result.get("stdout") or "").strip()
    stderr = (result.get("stderr") or "").strip()
    return [
        "",
        "--- raw stdout ---",
        stdout or "(empty)",
        "--- raw stderr ---",
        stderr or "(empty)",
    ]


def _format_script_run(result: dict, filenames: list[str], entrypoint: str) -> str:
    timed_out = bool(result.get("timed_out"))
    exit_code = result.get("exit_code")
    lines = [
        "REAL EXECUTION RESULT -- the student's own code was run, unmodified. "
        "No test file was supplied, so this is what their program actually did when "
        "executed, nothing more.",
        "",
        f"Files run exactly as submitted: {', '.join(filenames)} (ran {entrypoint})",
        f"Exit code: {exit_code}",
        f"Timed out: {timed_out}",
    ]
    if timed_out:
        lines += [
            "",
            "The sandbox's wall-clock watchdog killed it -- it never terminated on its "
            "own. That is usually an infinite loop or unbounded recursion in their code.",
        ]
    elif exit_code != 0:
        lines += [
            "",
            "It exited with an error. The traceback below is their real one -- quote the "
            f"actual line and exception it names. {_NEVER_WRITE_THEIR_CODE}",
        ]
    else:
        lines += [
            "",
            "It ran to completion. Be honest that 'it ran without crashing' is not the "
            "same as 'it is correct' -- if the assignment has checkable behavior, offer "
            "to write test cases from the assignment description and check it properly.",
        ]
    return "\n".join(lines + _raw_output_block(result))


class CheckCodeWorkTool(Tool):
    """For a student's own Python code -- runs it for real in the sandbox and reports
    exactly what happened, per test, with their real tracebacks. The code equivalent of
    check_student_work: it verifies THEIR work, it never produces work for them.
    Distinct from code_interpreter, which runs a scratch snippet the model itself wrote
    and only reports final stdout/stderr."""

    name = "check_code_work"
    description = (
        "Runs the STUDENT'S OWN Python code in an isolated sandbox and reports what "
        "really happened: per-test pass/fail with the real assertion output and real "
        "tracebacks, or real stdout/stderr/exit code if no tests are given. Supports "
        "multi-file submissions (e.g. main.py importing utils.py). Call this when a "
        "student shares code they wrote and wants to know whether it works or why it "
        "fails. Pass their code EXACTLY as they wrote it -- never fix, rewrite, "
        "reformat or substitute your own version, and never report results from code "
        "you changed as if they were theirs. You MAY write test_file yourself from the "
        "assignment description (writing the tests is teaching; writing their solution "
        "is not). Python only. For running your own scratch code, use code_interpreter."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "files": {
                "type": "object",
                "additionalProperties": {"type": "string"},
                "description": (
                    "The student's own code: a map of filename to that file's exact "
                    'content, e.g. {"main.py": "...", "utils.py": "..."}. Submit it '
                    "verbatim, including the bugs."
                ),
            },
            "entrypoint": {
                "type": "string",
                "description": (
                    "Which of the files is the main module (e.g. 'main.py'). Must be one "
                    "of the keys in files. It is executed directly when no test_file is "
                    "given; with tests, it just identifies their main module."
                ),
            },
            "test_file": {
                "type": "string",
                "description": (
                    "Optional pytest-style test module CONTENT (functions named test_*) "
                    "run against the submitted files -- either the student's own tests, "
                    "or tests you wrote from the assignment description. Import their "
                    "code by module name, e.g. 'from solution import add'."
                ),
            },
            "stdin": {
                "type": "string",
                "description": "Optional text piped to the program's stdin.",
            },
        },
        "required": ["files", "entrypoint"],
    }

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        # `transport` is only ever passed in tests (httpx.MockTransport) -- same
        # convention as research_fetch.py. Production construction (registry.py) passes
        # nothing and gets httpx's real transport.
        self._transport = transport

    async def run(
        self,
        files: Any,
        entrypoint: str,
        test_file: str | None = None,
        stdin: str | None = None,
    ) -> str:
        normalized = _normalize_files(files)
        if isinstance(normalized, str):
            return normalized
        if not isinstance(entrypoint, str) or not entrypoint.strip():
            return "Error: entrypoint must name one of the submitted files."
        if entrypoint not in normalized:
            return (
                f"Error: entrypoint '{entrypoint}' is not one of the submitted files "
                f"({', '.join(sorted(normalized))})."
            )
        if test_file is not None and not test_file.strip():
            return "Error: test_file was provided but is empty -- omit it, or supply real tests."

        base_url = get_settings().sandbox_runner_url
        payload: dict[str, Any] = {"files": normalized, "entrypoint": entrypoint}
        if test_file is not None:
            payload["test_file"] = test_file
        if stdin is not None:
            payload["stdin"] = stdin

        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=_HTTP_TIMEOUT_S) as client:
                response = await client.post(f"{base_url}/run-code", json=payload)
                response.raise_for_status()
                result = response.json()
        except httpx.TimeoutException:
            return "Error: sandbox-runner did not respond in time (the run may still be going there)."
        except httpx.HTTPError as exc:
            return f"Error: could not reach sandbox-runner at {base_url}: {exc}"

        if not result.get("ok"):
            return f"Error: {result.get('error') or 'sandbox-runner refused the submission.'}"

        filenames = sorted(normalized)
        if result.get("mode") == "tests":
            return _format_test_run(result, filenames)
        return _format_script_run(result, filenames, entrypoint)
