from app.agents.router import route


def test_route_always_selects_tutor_agent():
    plan = route("please help me understand photosynthesis")
    assert plan.agent == "tutor"


def test_route_selects_tutor_agent_for_empty_message():
    plan = route("")
    assert plan.agent == "tutor"
