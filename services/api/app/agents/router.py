from dataclasses import dataclass


@dataclass
class RoutePlan:
    agent: str  # "tutor" for now


def route(user_message: str) -> RoutePlan:
    """Classifies the request and decides which specialist agent(s) handle it.

    Phase 1 has exactly one agent (Tutor), so this is trivially always right — but it's
    the real seam later agents (Math Solver, Visualizer, Study Planner, ...) plug into,
    not a placeholder that will need to be rewritten.
    """
    return RoutePlan(agent="tutor")
