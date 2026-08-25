# Phase 1 — state.py: Extend AgentState

## File to modify
`src/langgraph_agent_lab/state.py`

## What to do
Add exactly 4 new optional fields to the `AgentState` TypedDict, immediately after the `final_answer` field.
Do NOT change any existing fields or their types.

## Fields to add

```python
# After `final_answer: str | None`, insert these 4 fields:
evaluation_result: str | None     # Set by evaluate_node: "success" | "needs_retry"
pending_question: str | None      # Set by ask_clarification_node: the clarification question text
proposed_action: str | None       # Set by risky_action_node: description of the risky action
approval: dict[str, Any] | None   # Set by approval_node: serialized ApprovalDecision
```

## Reducer decisions
- All 4 new fields: OVERWRITE (no Annotated[list, add]) — only the latest value matters
- Keep existing append-only fields unchanged: messages, tool_results, errors, events

## Also update initial_state()
Add these 4 fields with None defaults in the `initial_state(scenario)` function return dict:

```python
"evaluation_result": None,
"pending_question": None,
"proposed_action": None,
"approval": None,
```

## After implementing
Run: `pytest tests/test_state.py -v`
Expected: ALL PASS
