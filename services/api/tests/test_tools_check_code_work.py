"""Tests for app.tools.check_code_work.

Two layers, deliberately:

  1. Hermetic (default, runs in CI): an httpx.MockTransport stands in for
     sandbox-runner, same convention as test_research_fetch.py/test_latex_compile.py.
     These pin down the TOOL's own contract -- validation, the payload it sends, and
     that its rendered response actually carries the real per-test results and real
     tracebacks through rather than summarizing them away.

  2. `live_smoke`: the same scenarios against the REAL deployed sandbox-runner
     container, because the properties that matter most here (a real assertion failure,
     a real multi-file import, the rlimit/watchdog kill, network isolation) are
     properties of the actual sandbox and mean nothing against a mock. Excluded from the
     hermetic CI run, same as the rest of this suite's live tests.
"""

import json

import httpx
import pytest

from app.tools.check_code_work import CheckCodeWorkTool
from app.tools.registry import run_tool

# --------------------------------------------------------------------------------
# Hermetic
# --------------------------------------------------------------------------------


def _tool(response_json: dict, seen: dict | None = None) -> CheckCodeWorkTool:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/run-code"
        if seen is not None:
            seen.update(json.loads(request.read()))
        return httpx.Response(200, json=response_json)

    return CheckCodeWorkTool(transport=httpx.MockTransport(handler))


def _run_code_payload(**overrides) -> dict:
    base = {
        "ok": True,
        "error": None,
        "mode": "tests",
        "stdout": "",
        "stderr": "",
        "exit_code": 0,
        "timed_out": False,
        "tests": [],
        "passed": 0,
        "failed": 0,
        "errors": 0,
        "skipped": 0,
    }
    base.update(overrides)
    return base


async def test_all_tests_passing_reports_the_real_count_and_hedges_honestly():
    tool = _tool(
        _run_code_payload(
            tests=[
                {"name": "test_newton_check.py::test_adds", "outcome": "passed", "phase": "call", "duration": 0.0, "message": ""},
                {"name": "test_newton_check.py::test_negatives", "outcome": "passed", "phase": "call", "duration": 0.0, "message": ""},
            ],
            passed=2,
        )
    )
    result = await tool.run(
        files={"solution.py": "def add(a, b):\n    return a + b\n"},
        entrypoint="solution.py",
        test_file="from solution import add\n\ndef test_adds():\n    assert add(1, 2) == 3\n",
    )
    assert "ALL 2 TEST(S) PASSED" in result
    assert "test_newton_check.py::test_adds" in result
    # Never claims more than the tests actually prove.
    assert "not that it is correct for every possible input" in result


async def test_failing_test_surfaces_the_real_assertion_text_verbatim():
    real_traceback = (
        "def test_negatives():\n"
        ">       assert add(-1, -1) == -2\n"
        "E       assert 0 == -2\n"
        "E        +  where 0 = add(-1, -1)"
    )
    tool = _tool(
        _run_code_payload(
            exit_code=1,
            tests=[
                {"name": "t.py::test_adds", "outcome": "passed", "phase": "call", "duration": 0.0, "message": ""},
                {"name": "t.py::test_negatives", "outcome": "failed", "phase": "call", "duration": 0.0, "message": real_traceback},
            ],
            passed=1,
            failed=1,
        )
    )
    result = await tool.run(files={"solution.py": "x"}, entrypoint="solution.py", test_file="y")
    assert "TESTS FAILED: 1 passed, 1 failed" in result
    assert "assert 0 == -2" in result  # the REAL assertion output, not a paraphrase
    assert "where 0 = add(-1, -1)" in result
    # The anti-homework-completion instruction is present and unambiguous.
    assert "Do NOT write, rewrite, or paste a corrected version of their code" in result


async def test_timeout_is_reported_as_a_real_kill_not_a_failure_verdict():
    tool = _tool(_run_code_payload(exit_code=-9, timed_out=True))
    result = await tool.run(files={"a.py": "while True: pass"}, entrypoint="a.py", test_file="def test_x(): pass")
    assert "TIMED OUT" in result
    assert "wall-clock watchdog" in result


async def test_script_mode_when_no_test_file_is_given():
    seen: dict = {}
    tool = _tool(_run_code_payload(mode="script", stdout="7\n", exit_code=0), seen=seen)
    result = await tool.run(files={"main.py": "print(7)"}, entrypoint="main.py")
    assert "test_file" not in seen
    assert "Exit code: 0" in result
    assert "7" in result
    # Honest about what merely running proves.
    assert "is not the same as 'it is correct'" in result


async def test_multi_file_submission_is_sent_whole_and_unmodified():
    seen: dict = {}
    tool = _tool(_run_code_payload(mode="script", stdout="5\n"), seen=seen)
    files = {
        "main.py": "from utils import double\nprint(double(2) + 1)\n",
        "utils.py": "def double(n):\n    return n * 2\n",
    }
    await tool.run(files=files, entrypoint="main.py")
    assert seen["files"] == files  # byte-for-byte, nothing injected or rewritten
    assert seen["entrypoint"] == "main.py"


async def test_sandbox_refusal_is_surfaced_as_an_error_not_a_verdict():
    tool = _tool(_run_code_payload(ok=False, error="sandbox-runner: invalid filename '../x.py'"))
    result = await tool.run(files={"a.py": "print(1)"}, entrypoint="a.py")
    assert result.startswith("Error:")
    assert "invalid filename" in result


async def test_entrypoint_must_be_one_of_the_submitted_files():
    tool = _tool(_run_code_payload())
    result = await tool.run(files={"a.py": "print(1)"}, entrypoint="b.py")
    assert result.startswith("Error:")
    assert "b.py" in result


async def test_empty_files_is_a_clear_error():
    tool = _tool(_run_code_payload())
    assert (await tool.run(files={}, entrypoint="a.py")).startswith("Error:")
    assert (await tool.run(files={"a.py": "   "}, entrypoint="a.py")).startswith("Error:")


async def test_list_shaped_files_argument_is_tolerated():
    seen: dict = {}
    tool = _tool(_run_code_payload(mode="script"), seen=seen)
    await tool.run(
        files=[{"filename": "main.py", "content": "print(1)"}],
        entrypoint="main.py",
    )
    assert seen["files"] == {"main.py": "print(1)"}


async def test_unreachable_sandbox_is_an_error_string_not_an_exception():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host", request=request)

    tool = CheckCodeWorkTool(transport=httpx.MockTransport(handler))
    result = await tool.run(files={"a.py": "print(1)"}, entrypoint="a.py")
    assert result.startswith("Error: could not reach sandbox-runner")


async def test_registered_with_name_and_required_params():
    tool = CheckCodeWorkTool()
    assert tool.name == "check_code_work"
    assert set(tool.parameters["required"]) == {"files", "entrypoint"}
    # The tool description itself, not just the system prompt, must state the rule.
    assert "never fix, rewrite" in tool.description.lower()
    assert "python only" in tool.description.lower()


# --------------------------------------------------------------------------------
# live_smoke -- the REAL deployed sandbox-runner container
# --------------------------------------------------------------------------------


@pytest.mark.live_smoke
async def test_live_correct_submission_passes_every_test():
    result = await run_tool(
        "check_code_work",
        {
            "files": {"solution.py": "def add(a, b):\n    return a + b\n"},
            "entrypoint": "solution.py",
            "test_file": (
                "from solution import add\n\n"
                "def test_positives():\n    assert add(2, 3) == 5\n\n"
                "def test_negatives():\n    assert add(-1, -1) == -2\n\n"
                "def test_zero():\n    assert add(0, 0) == 0\n"
            ),
        },
    )
    assert "ALL 3 TEST(S) PASSED" in result, result
    assert "test_positives" in result


@pytest.mark.live_smoke
async def test_live_buggy_submission_fails_specific_tests_with_the_real_assertion():
    result = await run_tool(
        "check_code_work",
        {
            # A real, plausible student bug: abs() slapped on to "fix" negative results.
            "files": {"solution.py": "def add(a, b):\n    return abs(a + b)\n"},
            "entrypoint": "solution.py",
            "test_file": (
                "from solution import add\n\n"
                "def test_positives():\n    assert add(2, 3) == 5\n\n"
                "def test_negatives():\n    assert add(-1, -1) == -2\n"
            ),
        },
    )
    assert "TESTS FAILED: 1 passed, 1 failed" in result, result
    assert "test_negatives" in result
    # The REAL pytest assertion introspection, computed by the real interpreter.
    assert "assert 2 == -2" in result, result


@pytest.mark.live_smoke
async def test_live_multi_file_submission_imports_across_files():
    result = await run_tool(
        "check_code_work",
        {
            "files": {
                "main.py": "from utils import area\n\ndef report(r):\n    return f'area={area(r):.2f}'\n",
                "utils.py": "import math\n\ndef area(r):\n    return math.pi * r * r\n",
            },
            "entrypoint": "main.py",
            "test_file": (
                "from main import report\nfrom utils import area\n\n"
                "def test_area():\n    assert round(area(2), 2) == 12.57\n\n"
                "def test_report_uses_utils():\n    assert report(1) == 'area=3.14'\n"
            ),
        },
    )
    assert "ALL 2 TEST(S) PASSED" in result, result


@pytest.mark.live_smoke
async def test_live_infinite_loop_is_killed_by_the_existing_limits():
    result = await run_tool(
        "check_code_work",
        {
            "files": {"solution.py": "def spin():\n    while True:\n        pass\n"},
            "entrypoint": "solution.py",
            "test_file": "from solution import spin\n\ndef test_spin():\n    spin()\n",
        },
    )
    # Either kill path is fine (RLIMIT_CPU or the wall-clock watchdog) -- what matters is
    # it did not run to completion and did not hang the request.
    assert "TIMED OUT" in result or "Exit code: -9" in result or "NO TEST RESULTS" in result, result
    assert "ALL " not in result


@pytest.mark.live_smoke
async def test_live_network_access_from_a_multi_file_submission_is_blocked():
    """Deliberately inverted: the submitted test ASSERTS the network is reachable, so a
    working sandbox makes it FAIL -- and pytest's real assertion introspection then
    prints the actual reason the connection didn't happen. A passing test here would
    mean egress blocking had been lost on the multi-file path."""
    result = await run_tool(
        "check_code_work",
        {
            "files": {
                "main.py": "from net import reach\n\nprint(reach())\n",
                "net.py": (
                    "import socket\n\n"
                    "def reach():\n"
                    "    try:\n"
                    "        socket.setdefaulttimeout(4)\n"
                    "        s = socket.create_connection(('8.8.8.8', 53), timeout=4)\n"
                    "        s.close()\n"
                    "        return 'REACHED'\n"
                    "    except Exception as exc:\n"
                    "        return 'BLOCKED:' + type(exc).__name__\n"
                ),
            },
            "entrypoint": "main.py",
            "test_file": (
                "from net import reach\n\n"
                "def test_network_is_reachable():\n"
                "    assert reach() == 'REACHED'\n"
            ),
        },
    )
    assert "TESTS FAILED: 0 passed, 1 failed" in result, result
    assert "BLOCKED:" in result, result
