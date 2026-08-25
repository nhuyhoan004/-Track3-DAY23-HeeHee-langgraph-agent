# Phase 2 — nodes.py: Implement 10 Node Functions

## File to modify
`src/langgraph_agent_lab/nodes.py`

## Critical rules
1. Each node receives AgentState and returns a PARTIAL state dict — never return the full state, only changed keys.
2. NEVER mutate state in-place. Always create new values.
3. classify_node and answer_node MUST call get_llm() — no keyword heuristics allowed.
4. Every node MUST emit at least one event via make_event() in the returned "events" list.

## Imports needed at top of nodes.py

```python
from __future__ import annotations
import os
from pydantic import BaseModel
from typing import Literal
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate
from .state import AgentState, ApprovalDecision, make_event
from .llm import get_llm
```

---

## Node 1: classify_node (MUST USE LLM + STRUCTURED OUTPUT)

Define a Pydantic model for the structured output:

```python
class IntentClassification(BaseModel):
    route: Literal["simple", "tool", "missing_info", "risky", "error"]
    risk_level: Literal["high", "low"]
    reasoning: str
```

Implementation:
```python
def classify_node(state: AgentState) -> dict:
    llm = get_llm(temperature=0.0)
    structured_llm = llm.with_structured_output(IntentClassification)
    
    system_prompt = """You are a support ticket classifier. Classify the user query into exactly one of these routes.
Priority order (higher priority wins): risky > tool > missing_info > error > simple

Routes:
- risky: Actions with side effects — refunds, deletions, sending emails, cancellations, account modifications
- tool: Information lookups that require data retrieval — order status, tracking, search queries  
- missing_info: Vague or incomplete queries that lack enough context to act on (e.g., "fix it", "help me")
- error: System-level failures — timeouts, crashes, service unavailable messages
- simple: General questions answerable without tools or risky actions (e.g., "how do I reset password?")

Set risk_level to "high" for risky routes, "low" for all others."""

    result = structured_llm.invoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=f"Classify this support ticket: {state['query']}")
    ])
    
    return {
        "route": result.route,
        "risk_level": result.risk_level,
        "events": [make_event("classify", "completed", f"route={result.route} reasoning={result.reasoning[:80]}")],
    }
```

---

## Node 2: tool_node (mock tool with error simulation)

```python
def tool_node(state: AgentState) -> dict:
    attempt = state.get("attempt", 0)
    route = state.get("route", "")
    query = state.get("query", "")
    
    # Simulate transient failure for error-route scenarios
    if route == "error" and attempt < 2:
        result = f"ERROR: Tool timeout on attempt {attempt} for query: {query[:40]}"
    else:
        result = (
            f"SUCCESS: Tool executed on attempt {attempt}. "
            f"Mock data retrieved for: {query[:50]}. "
            f"[order_id=12345, status=shipped, eta=2024-12-25]"
        )
    
    return {
        "tool_results": [result],
        "events": [make_event("tool", "executed", result[:80])],
    }
```

---

## Node 3: evaluate_node (retry-loop gate)

Heuristic approach (sufficient for base score):
```python
def evaluate_node(state: AgentState) -> dict:
    tool_results = state.get("tool_results") or []
    latest = tool_results[-1] if tool_results else ""
    
    evaluation_result = "needs_retry" if "ERROR" in latest else "success"
    
    return {
        "evaluation_result": evaluation_result,
        "events": [make_event("evaluate", "completed", f"evaluation_result={evaluation_result}")],
    }
```

---

## Node 4: answer_node (MUST USE LLM — grounded generation)

```python
def answer_node(state: AgentState) -> dict:
    llm = get_llm()
    query = state.get("query", "")
    tool_results = state.get("tool_results") or []
    approval = state.get("approval")
    route = state.get("route", "")
    
    context_parts = [f"User query: {query}"]
    if tool_results:
        context_parts.append(f"Tool results: {tool_results[-1]}")
    if approval:
        context_parts.append(f"Approval status: {approval}")
    if route == "risky":
        context_parts.append("Note: This was a risky action that required and received approval.")
    
    context = "\n".join(context_parts)
    
    system_prompt = "You are a helpful customer support agent. Generate a clear, concise response based on the available context. Be specific and actionable."
    
    response = llm.invoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=context)
    ])
    
    return {
        "final_answer": response.content,
        "events": [make_event("answer", "completed", f"answer_length={len(response.content)}")],
    }
```

---

## Node 5: ask_clarification_node

```python
def ask_clarification_node(state: AgentState) -> dict:
    query = state.get("query", "")
    question = (
        f"I'd like to help you, but your request '{query}' needs more details. "
        "Could you please clarify: What specific issue are you experiencing? "
        "What have you already tried? What system or account is affected?"
    )
    return {
        "pending_question": question,
        "final_answer": question,
        "events": [make_event("clarify", "completed", "clarification_requested")],
    }
```

---

## Node 6: risky_action_node

```python
def risky_action_node(state: AgentState) -> dict:
    query = state.get("query", "")
    proposed = (
        f"PROPOSED RISKY ACTION: '{query}'\n"
        "This action has irreversible side effects (e.g., data deletion, financial transactions, "
        "or external communications). Human approval is required before proceeding."
    )
    return {
        "proposed_action": proposed,
        "events": [make_event("risky_action", "prepared", "awaiting_approval")],
    }
```

---

## Node 7: approval_node (mock default + optional real HITL)

```python
def approval_node(state: AgentState) -> dict:
    use_interrupt = os.getenv("LANGGRAPH_INTERRUPT", "false").lower() == "true"
    
    if use_interrupt:
        from langgraph.types import interrupt
        decision_data = interrupt({
            "proposed_action": state.get("proposed_action"),
            "message": "Please approve or reject this action",
        })
        decision = ApprovalDecision(
            approved=decision_data.get("approved", False),
            reviewer=decision_data.get("reviewer", "human"),
            comment=decision_data.get("comment", ""),
        )
    else:
        # Default: auto-approve for CI/testing
        decision = ApprovalDecision(
            approved=True,
            reviewer="mock-reviewer",
            comment="Auto-approved in offline mode",
        )
    
    return {
        "approval": decision.model_dump(),
        "events": [make_event("approval", "completed", f"approved={decision.approved}")],
    }
```

---

## Node 8: retry_or_fallback_node

```python
def retry_or_fallback_node(state: AgentState) -> dict:
    attempt = state.get("attempt", 0) + 1
    error_msg = f"Attempt {attempt}: tool call failed, scheduling retry"
    
    return {
        "attempt": attempt,
        "errors": [error_msg],
        "events": [make_event("retry", "incremented", f"attempt={attempt}")],
    }
```

---

## Node 9: dead_letter_node

```python
def dead_letter_node(state: AgentState) -> dict:
    attempt = state.get("attempt", 0)
    query = state.get("query", "")
    answer = (
        f"We were unable to process your request after {attempt} attempts. "
        f"Your ticket has been escalated to our support team for manual review. "
        f"Query: '{query}'"
    )
    return {
        "final_answer": answer,
        "events": [make_event("dead_letter", "escalated", f"after_{attempt}_attempts")],
    }
```

---

## Node 10: finalize_node (ALL routes must pass through here)

```python
def finalize_node(state: AgentState) -> dict:
    return {
        "events": [make_event("finalize", "completed", "workflow finished")],
    }
```

---

## After implementing
Run: `pytest tests/test_state.py tests/test_metrics.py -v`
Note: test_routing.py and test_graph_smoke.py need Phase 3 and 4 first.
