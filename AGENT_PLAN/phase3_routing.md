# Phase 3 — routing.py: Implement 4 Routing Functions

## File to modify
`src/langgraph_agent_lab/routing.py`

## Critical rules
1. Each function receives AgentState and returns a STRING matching a registered node name in graph.py.
2. route_after_retry MUST have a bounded check — without it, error scenarios loop forever.
3. Use .get() with defaults — state fields may be None.

---

## Function 1: route_after_classify

Maps the classified route to the next node name.

```python
def route_after_classify(state: AgentState) -> str:
    mapping = {
        "simple": "answer",
        "tool": "tool",
        "missing_info": "clarify",
        "risky": "risky_action",
        "error": "retry",
    }
    return mapping.get(state.get("route", ""), "answer")
```

Expected behavior (verified by test_routing.py):
- route="simple"       -> "answer"
- route="tool"         -> "tool"
- route="missing_info" -> "clarify"
- route="risky"        -> "risky_action"
- route="error"        -> "retry"
- route=anything_else  -> "answer" (safe default)

---

## Function 2: route_after_evaluate

Retry-loop gate. Creates the retry loop that is LangGraph's key advantage over linear LCEL chains.

```python
def route_after_evaluate(state: AgentState) -> str:
    if state.get("evaluation_result") == "needs_retry":
        return "retry"
    return "answer"
```

Expected behavior:
- evaluation_result="needs_retry" -> "retry"
- evaluation_result="success"     -> "answer"
- evaluation_result=None          -> "answer" (safe default)

---

## Function 3: route_after_retry (MUST be bounded)

```python
def route_after_retry(state: AgentState) -> str:
    attempt = state.get("attempt", 0)
    max_attempts = state.get("max_attempts", 3)
    if attempt < max_attempts:
        return "tool"
    return "dead_letter"
```

Expected behavior (verified by test_routing.py):
- attempt=0, max_attempts=3 -> "tool"
- attempt=1, max_attempts=3 -> "tool"
- attempt=2, max_attempts=3 -> "tool"
- attempt=3, max_attempts=3 -> "dead_letter"
- attempt=5, max_attempts=3 -> "dead_letter"
- attempt=1, max_attempts=1 -> "dead_letter"  (S07 scenario: max_attempts=1)

---

## Function 4: route_after_approval

```python
def route_after_approval(state: AgentState) -> str:
    approval = state.get("approval") or {}
    if approval.get("approved", False):
        return "tool"
    return "clarify"
```

Expected behavior:
- approval={"approved": True, ...}  -> "tool"
- approval={"approved": False, ...} -> "clarify"
- approval=None                     -> "clarify"

---

## After implementing
Run: `pytest tests/test_routing.py -v`
Expected: ALL 10 tests PASS
