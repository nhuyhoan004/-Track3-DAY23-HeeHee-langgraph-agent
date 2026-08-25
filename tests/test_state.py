from langgraph_agent_lab.scenarios import load_scenarios
from langgraph_agent_lab.state import Route, Scenario, initial_state


def test_scenario_validation():
    scenario = Scenario(id="x", query="hello", expected_route=Route.SIMPLE)
    state = initial_state(scenario)
    assert state["thread_id"].startswith("thread-x-")
    assert state["attempt"] == 0
    assert state["events"] == []


def test_thread_id_is_unique_per_run():
    """A stable thread_id would replay the previous run's append-only channels."""
    scenario = Scenario(id="x", query="hello", expected_route=Route.SIMPLE)
    first = initial_state(scenario)["thread_id"]
    second = initial_state(scenario)["thread_id"]
    assert first != second


def test_initial_state_carries_should_retry():
    scenario = Scenario(
        id="x", query="hello", expected_route=Route.ERROR, should_retry=True, max_attempts=2
    )
    state = initial_state(scenario)
    assert state["should_retry"] is True
    assert state["max_attempts"] == 2
    assert state["tool_status"] is None


def test_initial_state_has_required_fields():
    """Verify initial_state includes all fields needed by the graph."""
    scenario = Scenario(id="test", query="test query", expected_route=Route.SIMPLE)
    state = initial_state(scenario)
    assert "query" in state
    assert "route" in state
    assert "attempt" in state
    assert "max_attempts" in state
    assert "messages" in state
    assert "tool_results" in state
    assert "errors" in state
    assert "events" in state


def test_load_scenarios():
    scenarios = load_scenarios("data/sample/scenarios.jsonl")
    assert len(scenarios) >= 6
    assert {item.expected_route for item in scenarios} >= {Route.SIMPLE, Route.TOOL, Route.RISKY}
