"""State schema for the Day 08 LangGraph lab.

Students should extend the schema only when needed. Keep state lean and serializable.
"""

from __future__ import annotations

import uuid
from enum import StrEnum
from operator import add
from typing import Annotated, Any, TypedDict

from pydantic import BaseModel, Field, field_validator


class Route(StrEnum):
    SIMPLE = "simple"
    TOOL = "tool"
    MISSING_INFO = "missing_info"
    RISKY = "risky"
    ERROR = "error"
    DEAD_LETTER = "dead_letter"
    DONE = "done"


class LabEvent(BaseModel):
    """Append-only audit event for grading and debugging."""

    node: str
    event_type: str
    message: str
    latency_ms: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class ApprovalDecision(BaseModel):
    approved: bool = False
    reviewer: str = "mock-reviewer"
    comment: str = ""


class AgentState(TypedDict, total=False):
    """LangGraph state.

    TODO(student): decide which fields should be append-only and which should be overwritten.
    The current annotations give a safe starting point for auditability.
    """

    thread_id: str
    scenario_id: str
    query: str
    route: str
    risk_level: str
    attempt: int
    max_attempts: int
    should_retry: bool  # From the scenario: simulate a transient tool failure
    final_answer: str | None
    # Overwrite semantics (no reducer) — only the latest value matters for these fields.
    tool_status: str | None  # Set by tool_node: "ok" | "error" — structured, never parsed from text
    evaluation_result: str | None  # Set by evaluate_node: "success" | "needs_retry"
    pending_question: str | None  # Set by ask_clarification_node: the clarification question text
    proposed_action: str | None  # Set by risky_action_node: description of the risky action
    approval: dict[str, Any] | None  # Set by approval_node: serialized ApprovalDecision
    messages: Annotated[list[str], add]
    tool_results: Annotated[list[str], add]
    errors: Annotated[list[str], add]
    events: Annotated[list[dict[str, Any]], add]


class Scenario(BaseModel):
    id: str
    query: str
    expected_route: Route
    requires_approval: bool = False
    should_retry: bool = False
    max_attempts: int = 3
    tags: list[str] = Field(default_factory=list)

    @field_validator("query")
    @classmethod
    def query_must_not_be_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("query must not be empty")
        return value


def initial_state(scenario: Scenario, run_id: str | None = None) -> AgentState:
    """Create a serializable initial state for one scenario.

    The ``thread_id`` is unique per run. Reusing a stable id against a persistent
    checkpointer (SQLite) would replay the previous run's channel values, and the
    append-only fields below (`events`, `errors`, ...) would accumulate across runs,
    inflating every count in the metrics report.
    """
    suffix = run_id or uuid.uuid4().hex[:8]
    return {
        "thread_id": f"thread-{scenario.id}-{suffix}",
        "scenario_id": scenario.id,
        "query": scenario.query,
        "route": "",
        "risk_level": "unknown",
        "attempt": 0,
        "max_attempts": scenario.max_attempts,
        "should_retry": scenario.should_retry,
        "final_answer": None,
        "tool_status": None,
        "evaluation_result": None,
        "pending_question": None,
        "proposed_action": None,
        "approval": None,
        "messages": [],
        "tool_results": [],
        "errors": [],
        "events": [],
    }


def make_event(node: str, event_type: str, message: str, **metadata: Any) -> dict[str, Any]:
    """Create a normalized event payload."""
    event = LabEvent(node=node, event_type=event_type, message=message, metadata=metadata)
    return event.model_dump()
