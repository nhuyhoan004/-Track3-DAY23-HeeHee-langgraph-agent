"""Node functions for the LangGraph workflow.

Each function receives AgentState and returns a partial state update dict.
Do NOT mutate input state — return new values only.

LLM REQUIREMENT:
- classify_node MUST use a real LLM call (structured output for intent classification)
- answer_node MUST use a real LLM call (grounded response generation)
- evaluate_node SHOULD use LLM-as-judge (bonus points; heuristic acceptable for base score)
"""

from __future__ import annotations

import os
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from .llm import get_llm
from .state import AgentState, ApprovalDecision, make_event


def _as_text(content: object) -> str:
    """Coerce a LangChain message content into plain text.

    Anthropic and Gemini return a list of content blocks rather than a string, which would
    otherwise leak a non-serializable list into `final_answer`.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and "text" in block:
                parts.append(str(block["text"]))
        if parts:
            return "".join(parts)
    return str(content)


# ─── EXAMPLE: working node (provided for reference) ──────────────────
def intake_node(state: AgentState) -> dict:
    """Normalize raw query. This node is provided as a working example."""
    query = state.get("query", "").strip()
    return {
        "query": query,
        "messages": [f"intake:{query[:40]}"],
        "events": [make_event("intake", "completed", "query normalized")],
    }


class IntentClassification(BaseModel):
    """Structured output schema for LLM-based intent classification."""

    route: Literal["simple", "tool", "missing_info", "risky", "error"]
    risk_level: Literal["high", "low"]
    reasoning: str


def classify_node(state: AgentState) -> dict:
    """Classify the query into a route using an LLM with structured output."""
    llm = get_llm(temperature=0.0)
    structured_llm = llm.with_structured_output(IntentClassification)

    system_prompt = (
        "You are a support ticket classifier. "
        "Classify the user query into exactly one of these routes.\n"
        "Priority order (higher priority wins): risky > tool > missing_info > error > simple\n\n"
        "Routes:\n"
        "- risky: Actions with side effects — refunds, deletions, sending emails, cancellations, "
        "account modifications\n"
        "- tool: Information lookups that require data retrieval — order status, tracking, "
        "search queries\n"
        "- missing_info: Vague or incomplete queries that lack enough context to act on "
        '(e.g., "fix it", "help me")\n'
        "- error: System-level failures — timeouts, crashes, service unavailable messages\n"
        '- simple: General questions answerable without tools or risky actions '
        '(e.g., "how do I reset password?")\n\n'
        'Set risk_level to "high" for risky routes, "low" for all others.'
    )

    result = structured_llm.invoke(
        [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"Classify this support ticket: {state['query']}"),
        ]
    )
    event_message = f"route={result.route} reasoning={result.reasoning[:80]}"

    return {
        "route": result.route,
        "risk_level": result.risk_level,
        "events": [make_event("classify", "completed", event_message)],
    }


def tool_node(state: AgentState) -> dict:
    """Execute a mock tool call, simulating transient failures for retry scenarios.

    Failure is driven by the scenario's `should_retry` flag (or the `error` route), and the
    failure budget is derived from `max_attempts` so the final allowed attempt always
    succeeds. This keeps the retry loop bounded for any `max_attempts` value instead of
    relying on a hard-coded threshold.
    """
    attempt = state.get("attempt", 0)
    route = state.get("route", "")
    query = state.get("query", "")
    max_attempts = state.get("max_attempts", 3)

    simulate_failure = bool(state.get("should_retry")) or route == "error"
    failure_budget = max(1, max_attempts - 1)

    if simulate_failure and attempt < failure_budget:
        status = "error"
        result = f"Tool timeout on attempt {attempt} for query: {query[:40]}"
    else:
        status = "ok"
        result = (
            f"Tool executed on attempt {attempt}. "
            f"Mock data retrieved for: {query[:50]}. "
            f"[order_id=12345, status=shipped, eta=2024-12-25]"
        )

    return {
        "tool_status": status,
        "tool_results": [f"[{status}] {result}"],
        "events": [make_event("tool", "executed", result[:80], tool_status=status)],
    }


def evaluate_node(state: AgentState) -> dict:
    """Evaluate the tool result — the retry-loop gate.

    Reads the structured `tool_status` flag rather than substring-matching the result text.
    The result text embeds the user's query, so a query containing the word "ERROR" would
    otherwise be misread as a tool failure and burn the whole retry budget.
    """
    status = state.get("tool_status")
    if status is None:
        # Fallback for states reconstructed without tool_status (e.g. replayed checkpoints).
        tool_results = state.get("tool_results") or []
        latest = tool_results[-1] if tool_results else ""
        status = "error" if latest.startswith("[error]") else "ok"

    evaluation_result = "needs_retry" if status == "error" else "success"

    return {
        "evaluation_result": evaluation_result,
        "events": [make_event("evaluate", "completed", f"evaluation_result={evaluation_result}")],
    }


def answer_node(state: AgentState) -> dict:
    """Generate a final response using an LLM, grounded on available context."""
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

    system_prompt = (
        "You are a helpful customer support agent. Generate a clear, concise response "
        "based on the available context. Be specific and actionable."
    )

    response = llm.invoke([SystemMessage(content=system_prompt), HumanMessage(content=context)])
    answer = _as_text(response.content)

    return {
        "final_answer": answer,
        "events": [make_event("answer", "completed", f"answer_length={len(answer)}")],
    }


def ask_clarification_node(state: AgentState) -> dict:
    """Ask for missing information instead of hallucinating."""
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


def risky_action_node(state: AgentState) -> dict:
    """Prepare a risky action for human approval."""
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


def approval_node(state: AgentState) -> dict:
    """Human-in-the-loop approval step (mock default; real interrupt via env flag)."""
    use_interrupt = os.getenv("LANGGRAPH_INTERRUPT", "false").lower() == "true"

    if use_interrupt:
        from langgraph.types import interrupt

        decision_data = interrupt(
            {
                "proposed_action": state.get("proposed_action"),
                "message": "Please approve or reject this action",
            }
        )
        decision = ApprovalDecision(
            approved=decision_data.get("approved", False),
            reviewer=decision_data.get("reviewer", "human"),
            comment=decision_data.get("comment", ""),
        )
    else:
        decision = ApprovalDecision(
            approved=True,
            reviewer="mock-reviewer",
            comment="Auto-approved in offline mode",
        )

    return {
        "approval": decision.model_dump(),
        "events": [make_event("approval", "completed", f"approved={decision.approved}")],
    }


def retry_or_fallback_node(state: AgentState) -> dict:
    """Record a retry attempt by incrementing the attempt counter."""
    attempt = state.get("attempt", 0) + 1
    error_msg = f"Attempt {attempt}: tool call failed, scheduling retry"

    return {
        "attempt": attempt,
        "errors": [error_msg],
        "events": [make_event("retry", "incremented", f"attempt={attempt}")],
    }


def dead_letter_node(state: AgentState) -> dict:
    """Handle unresolvable failures after max retries exceeded."""
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


def finalize_node(state: AgentState) -> dict:
    """Emit a final audit event. All routes must pass through here before END."""
    return {
        "events": [make_event("finalize", "completed", "workflow finished")],
    }

