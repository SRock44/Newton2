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

    print("\n--- Summary ---")
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    print(f"\n{passed}/{total} checks passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
