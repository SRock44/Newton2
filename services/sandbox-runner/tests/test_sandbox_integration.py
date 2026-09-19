"""Integration tests for the sandbox-runner service.

Not run in CI / against a mocked app — these hit a REAL running instance over HTTP,
because the properties under test (rlimits, process-group kill, network isolation) only
mean anything against the real subprocess/container machinery. Point BASE_URL at a
running sandbox-runner (see services/sandbox-runner/README.md for how to stand one up
in an isolated test network).

Deliberately stdlib-only (urllib/json) so this script runs inside a bare `python:3.12-slim`
container with zero `pip install` step — handy since the test client itself is meant to sit
on the same network-isolated bridge as the service under test.

Usage:
    BASE_URL=http://sandbox-test:8000 python3 test_sandbox_integration.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE_URL = os.environ.get("BASE_URL", "http://localhost:18000")

results: list[tuple[str, bool, str]] = []


def execute(code: str, stdin: str | None = None, client_timeout: float = 25.0) -> dict:
    payload = {"code": code}
    if stdin is not None:
        payload["stdin"] = stdin
    req = urllib.request.Request(
        f"{BASE_URL}/execute",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=client_timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def run_code(
    files: dict,
    entrypoint: str,
    test_file: str | None = None,
    stdin: str | None = None,
    client_timeout: float = 30.0,
) -> dict:
    payload = {"files": files, "entrypoint": entrypoint}
    if test_file is not None:
        payload["test_file"] = test_file
    if stdin is not None:
        payload["stdin"] = stdin
    req = urllib.request.Request(
        f"{BASE_URL}/run-code",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=client_timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def health() -> bool:
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=5) as resp:
            return resp.status == 200
    except Exception:
        return False


def check(name: str, condition: bool, detail: str) -> None:
    results.append((name, condition, detail))
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {name}: {detail}")


def test_normal_execution() -> None:
    r = execute("print('hello sandbox')")
    check(
        "normal_execution",
        r["exit_code"] == 0 and "hello sandbox" in r["stdout"] and not r["timed_out"],
        f"exit_code={r['exit_code']} timed_out={r['timed_out']} stdout={r['stdout']!r} stderr={r['stderr']!r}",
    )


def test_syntax_error() -> None:
    r = execute("def broken(:\n    pass")
    check(
        "syntax_error_captured",
        r["exit_code"] != 0 and "SyntaxError" in r["stderr"] and not r["timed_out"],
        f"exit_code={r['exit_code']} timed_out={r['timed_out']} stderr={r['stderr']!r}",
    )


def test_runtime_error() -> None:
    r = execute("raise ValueError('boom')")
    check(
        "runtime_error_captured",
        r["exit_code"] != 0 and "ValueError" in r["stderr"] and "boom" in r["stderr"],
        f"exit_code={r['exit_code']} stderr={r['stderr']!r}",
    )
    check("service_alive_after_runtime_error", health(), "GET /health after a runtime error")


def test_cpu_bound_infinite_loop_killed_and_service_survives() -> None:
    """`while True: pass` burns CPU continuously, so this should typically be caught by
    the RLIMIT_CPU limit (~5s) rather than needing the wall-clock watchdog at all — the
    process gets SIGKILLed by the kernel once it exceeds its CPU budget. Either kill path
    (rlimit or watchdog) is an acceptable outcome here; what matters is it doesn't hang."""
    start = time.monotonic()
    r = execute("while True:\n    pass", client_timeout=30.0)
    elapsed = time.monotonic() - start
    check(
        "cpu_bound_loop_killed",
        r["exit_code"] != 0,
        f"elapsed={elapsed:.1f}s exit_code={r['exit_code']} timed_out={r['timed_out']}",
    )
    check(
        "cpu_bound_loop_killed_promptly",
        elapsed < 20.0,
        f"elapsed={elapsed:.1f}s (should be bounded by RLIMIT_CPU / the wall-clock watchdog, not hang)",
    )
    r2 = execute("print('still alive')")
    check(
        "service_handles_next_request_after_cpu_bound_loop",
        r2["exit_code"] == 0 and "still alive" in r2["stdout"],
        f"follow-up request: exit_code={r2['exit_code']} stdout={r2['stdout']!r}",
    )


def test_blocking_sleep_killed_by_wall_clock_watchdog_and_service_survives() -> None:
    """`time.sleep()` burns ~zero CPU time, so RLIMIT_CPU would never catch it — this is
    exactly the case that requires an independent wall-clock watchdog (see main.py). This
    is the single most important test in this suite: it proves the watchdog, not just the
    rlimit, is doing real work, and that the service itself doesn't hang or die either."""
    start = time.monotonic()
    r = execute("import time\ntime.sleep(9999)", client_timeout=30.0)
    elapsed = time.monotonic() - start
    check(
        "sleep_loop_timed_out_by_watchdog",
        r["timed_out"] is True and r["exit_code"] != 0,
        f"elapsed={elapsed:.1f}s exit_code={r['exit_code']} timed_out={r['timed_out']}",
    )
    check(
        "sleep_loop_killed_within_watchdog_window",
        elapsed < 20.0,
        f"elapsed={elapsed:.1f}s (should be bounded by the ~10s wall-clock watchdog, not the 9999s sleep)",
    )
    r2 = execute("print('still alive')")
    check(
        "service_handles_next_request_after_sleep_loop",
        r2["exit_code"] == 0 and "still alive" in r2["stdout"],
        f"follow-up request: exit_code={r2['exit_code']} stdout={r2['stdout']!r}",
    )


def test_network_isolation() -> None:
    code = """
import socket
attempts = []

try:
    socket.setdefaulttimeout(4)
    s = socket.create_connection(("8.8.8.8", 53), timeout=4)
    s.close()
    attempts.append("RAW_SOCKET_SUCCEEDED")
except Exception as exc:
    attempts.append(f"RAW_SOCKET_FAILED:{type(exc).__name__}")

try:
    import urllib.request
    urllib.request.urlopen("http://example.com", timeout=4)
    attempts.append("HTTP_SUCCEEDED")
except Exception as exc:
    attempts.append(f"HTTP_FAILED:{type(exc).__name__}")

print("|".join(attempts))
"""
    r = execute(code, client_timeout=20.0)
    stdout = r["stdout"]
    check(
        "network_egress_blocked",
        "RAW_SOCKET_SUCCEEDED" not in stdout and "HTTP_SUCCEEDED" not in stdout,
        f"exit_code={r['exit_code']} stdout={stdout!r} stderr={r['stderr']!r}",
    )


def test_memory_limit_enforced() -> None:
    code = "x = bytearray(2 * 1024 * 1024 * 1024)\nprint('ALLOCATED', len(x))"
    r = execute(code, client_timeout=20.0)
    check(
        "large_allocation_rejected",
        r["exit_code"] != 0 and "ALLOCATED" not in r["stdout"],
        f"exit_code={r['exit_code']} timed_out={r['timed_out']} stdout={r['stdout']!r} stderr={r['stderr']!r}",
    )
    check("service_alive_after_oom_attempt", health(), "GET /health after a large-allocation attempt")


def test_no_state_leak_between_requests() -> None:
    r1 = execute("with open('secret.txt', 'w') as f:\n    f.write('leftover-state')\nprint('wrote it')")
    check(
        "request1_wrote_file",
        r1["exit_code"] == 0 and "wrote it" in r1["stdout"],
        f"exit_code={r1['exit_code']} stdout={r1['stdout']!r}",
    )
    r2 = execute("import os\nprint(os.path.exists('secret.txt'))\nprint(os.listdir('.'))")
    check(
        "request2_does_not_see_request1_file",
        r2["exit_code"] == 0 and "False" in r2["stdout"],
        f"exit_code={r2['exit_code']} stdout={r2['stdout']!r}",
    )


# ---------------------------------------------------------------------------------
# POST /run-code -- multi-file submissions, optionally under pytest. The whole point of
# these is that /run-code must be sandboxed EXACTLY as tightly as /execute: the
# timeout/memory/network checks below deliberately mirror the /execute ones above, so a
# future change that loosens limits on the multi-file path fails here loudly.
# ---------------------------------------------------------------------------------

_ADD_TESTS = (
    "from solution import add\n\n"
    "def test_positives():\n    assert add(2, 3) == 5\n\n"
    "def test_negatives():\n    assert add(-1, -1) == -2\n"
)


def test_run_code_correct_submission_passes_all_tests() -> None:
    r = run_code(
        {"solution.py": "def add(a, b):\n    return a + b\n"},
        "solution.py",
        test_file=_ADD_TESTS,
    )
    names = {t["name"].split("::")[-1]: t["outcome"] for t in r["tests"]}
    check(
        "run_code_all_tests_pass",
        r["ok"] and r["passed"] == 2 and r["failed"] == 0 and names.get("test_positives") == "passed",
        f"exit_code={r['exit_code']} passed={r['passed']} failed={r['failed']} tests={names}",
    )


def test_run_code_buggy_submission_fails_the_right_test_with_a_real_assertion() -> None:
    r = run_code(
        {"solution.py": "def add(a, b):\n    return abs(a + b)\n"},
        "solution.py",
        test_file=_ADD_TESTS,
    )
    by_name = {t["name"].split("::")[-1]: t for t in r["tests"]}
    failing = by_name.get("test_negatives", {})
    check(
        "run_code_buggy_fails_specific_test",
        r["passed"] == 1 and r["failed"] == 1 and failing.get("outcome") == "failed",
        f"passed={r['passed']} failed={r['failed']} outcomes={ {k: v['outcome'] for k, v in by_name.items()} }",
    )
    check(
        "run_code_failure_carries_the_real_assertion_text",
        "assert 2 == -2" in failing.get("message", ""),
        f"message={failing.get('message', '')!r}",
    )


def test_run_code_multi_file_import_works() -> None:
    r = run_code(
        {
            "main.py": "from utils import double\n\ndef triple(n):\n    return double(n) + n\n",
            "utils.py": "def double(n):\n    return n * 2\n",
        },
        "main.py",
        test_file=(
            "from main import triple\nfrom utils import double\n\n"
            "def test_double():\n    assert double(4) == 8\n\n"
            "def test_triple_uses_double():\n    assert triple(4) == 12\n"
        ),
    )
    check(
        "run_code_multi_file_import",
        r["ok"] and r["passed"] == 2 and r["failed"] == 0,
        f"exit_code={r['exit_code']} passed={r['passed']} failed={r['failed']} stdout={r['stdout']!r}",
    )


def test_run_code_script_mode_multi_file() -> None:
    r = run_code(
        {"main.py": "from utils import greet\n\nprint(greet('world'))\n", "utils.py": "def greet(n):\n    return 'hi ' + n\n"},
        "main.py",
    )
    check(
        "run_code_script_mode_multi_file",
        r["ok"] and r["exit_code"] == 0 and "hi world" in r["stdout"] and r["mode"] == "script",
        f"exit_code={r['exit_code']} stdout={r['stdout']!r} stderr={r['stderr']!r}",
    )


def test_run_code_syntax_error_is_reported_as_a_collection_error() -> None:
    r = run_code({"solution.py": "def add(a, b)\n    return a + b\n"}, "solution.py", test_file=_ADD_TESTS)
    joined = " ".join(t.get("message", "") for t in r["tests"])
    check(
        "run_code_syntax_error_surfaces",
        r["errors"] >= 1 and "SyntaxError" in joined,
        f"errors={r['errors']} passed={r['passed']} tests={[(t['name'], t['outcome']) for t in r['tests']]}",
    )


def test_run_code_infinite_loop_killed_by_the_same_limits_as_execute() -> None:
    start = time.monotonic()
    r = run_code(
        {"solution.py": "def spin():\n    while True:\n        pass\n"},
        "solution.py",
        test_file="from solution import spin\n\ndef test_spin():\n    spin()\n",
        client_timeout=40.0,
    )
    elapsed = time.monotonic() - start
    check(
        "run_code_infinite_loop_killed",
        r["exit_code"] != 0 and r["passed"] == 0,
        f"elapsed={elapsed:.1f}s exit_code={r['exit_code']} timed_out={r['timed_out']} passed={r['passed']}",
    )
    check(
        "run_code_infinite_loop_killed_promptly",
        elapsed < 20.0,
        f"elapsed={elapsed:.1f}s (must be bounded by the SAME ~10s watchdog / 5s RLIMIT_CPU as /execute)",
    )
    check("service_alive_after_run_code_infinite_loop", health(), "GET /health after a run-code infinite loop")


def test_run_code_memory_bomb_killed() -> None:
    r = run_code(
        {"solution.py": "def hog():\n    x = bytearray(2 * 1024 * 1024 * 1024)\n    return len(x)\n"},
        "solution.py",
        test_file="from solution import hog\n\ndef test_hog():\n    assert hog() > 0\n",
        client_timeout=30.0,
    )
    check(
        "run_code_memory_bomb_rejected",
        r["passed"] == 0 and r["exit_code"] != 0,
        f"exit_code={r['exit_code']} passed={r['passed']} failed={r['failed']} errors={r['errors']}",
    )


def test_run_code_network_isolation_holds_on_the_multi_file_path() -> None:
    r = run_code(
        {
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
        "main.py",
        client_timeout=30.0,
    )
    check(
        "run_code_network_egress_blocked",
        "BLOCKED:" in r["stdout"] and r["stdout"].strip() != "REACHED",
        f"exit_code={r['exit_code']} stdout={r['stdout']!r} stderr={r['stderr']!r}",
    )


def test_run_code_rejects_path_traversal_and_reserved_names() -> None:
    r = run_code({"../escape.py": "print(1)"}, "../escape.py")
    check(
        "run_code_rejects_path_traversal",
        r["ok"] is False and "invalid filename" in (r["error"] or ""),
        f"ok={r['ok']} error={r['error']!r}",
    )
    r2 = run_code({"test_newton_check.py": "print(1)"}, "test_newton_check.py")
    check(
        "run_code_rejects_reserved_filename",
        r2["ok"] is False and "reserved" in (r2["error"] or ""),
        f"ok={r2['ok']} error={r2['error']!r}",
    )


def test_run_code_leaves_no_state_between_requests() -> None:
    run_code({"main.py": "open('leftover.txt', 'w').write('x')\nprint('wrote')"}, "main.py")
    r = run_code({"main.py": "import os\nprint(sorted(os.listdir('.')))"}, "main.py")
    check(
        "run_code_no_state_leak",
        "leftover.txt" not in r["stdout"] and "main.py" in r["stdout"],
        f"stdout={r['stdout']!r}",
    )


def main() -> int:
    print(f"Testing sandbox-runner at {BASE_URL}\n")
    if not health():
        print("FATAL: service is not reachable / healthy at startup")
        return 2

    test_normal_execution()
    test_syntax_error()
    test_runtime_error()
    test_cpu_bound_infinite_loop_killed_and_service_survives()
    test_blocking_sleep_killed_by_wall_clock_watchdog_and_service_survives()
    test_network_isolation()
    test_memory_limit_enforced()
    test_no_state_leak_between_requests()

    test_run_code_correct_submission_passes_all_tests()
    test_run_code_buggy_submission_fails_the_right_test_with_a_real_assertion()
    test_run_code_multi_file_import_works()
    test_run_code_script_mode_multi_file()
    test_run_code_syntax_error_is_reported_as_a_collection_error()
    test_run_code_infinite_loop_killed_by_the_same_limits_as_execute()
    test_run_code_memory_bomb_killed()
    test_run_code_network_isolation_holds_on_the_multi_file_path()
    test_run_code_rejects_path_traversal_and_reserved_names()
    test_run_code_leaves_no_state_between_requests()

    print("\n--- Summary ---")
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    print(f"\n{passed}/{total} checks passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
