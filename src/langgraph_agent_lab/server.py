"""FastAPI server wiring the LangGraph agent to the static UI in ``ui/``.

Exposes the REST contract documented in ``ui/README.md`` so the frontend, built against
mock data, can drive the real graph unmodified in shape:

    POST /api/chat            -- start a new turn, run until finalize or a HITL interrupt
    POST /api/chat/approval   -- resume an interrupted thread with a human decision

Run with: ``uvicorn langgraph_agent_lab.server:app --reload`` (or ``make serve``).
"""

from __future__ import annotations

import os
import time
import uuid
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel

load_dotenv()

# The UI's HITL approval gate is the point of this server, so unless the operator's .env
# explicitly opts out, real interrupts are on (the CLI/tests default to mock auto-approval).
os.environ.setdefault("LANGGRAPH_INTERRUPT", "true")

from .graph import build_graph  # noqa: E402  (must follow the env default above)
from .persistence import build_checkpointer  # noqa: E402
from .state import AgentState  # noqa: E402

RECURSION_LIMIT = 100
MAX_RESUMES = 5

_checkpointer = build_checkpointer(os.getenv("CHECKPOINTER", "memory"), os.getenv("DATABASE_URL"))
graph = build_graph(checkpointer=_checkpointer)

app = FastAPI(title="LangGraph Support-Ticket Agent")


class ChatRequest(BaseModel):
    query: str
    thread_id: str | None = None


class ApprovalRequest(BaseModel):
    thread_id: str
    decision: Literal["approve", "reject"]
    comment: str | None = None


class ChatResponse(BaseModel):
    scenario_id: str
    thread_id: str
    route: str | None
    success: bool
    nodes_visited: int
    latency_ms: int
    retry_count: int
    interrupt_count: int
    approval_required: bool
    approval_observed: bool
    final_answer: str | None
    pending_question: str | None
    proposed_action: str | None
    events: list[dict[str, Any]]


def _new_state(query: str, thread_id: str) -> AgentState:
    return {
        "thread_id": thread_id,
        "scenario_id": "live-chat",
        "query": query,
        "route": "",
        "risk_level": "unknown",
        "attempt": 0,
        "max_attempts": 3,
        "should_retry": False,
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


def _to_response(state: dict[str, Any], latency_ms: int, interrupted: bool) -> ChatResponse:
    events = state.get("events", []) or []
    nodes = [event.get("node", "unknown") for event in events]
    route = state.get("route") or None
    return ChatResponse(
        scenario_id=str(state.get("scenario_id", "live-chat")),
        thread_id=str(state.get("thread_id", "")),
        route=route,
        success=bool(state.get("final_answer") or state.get("pending_question")),
        nodes_visited=len(nodes),
        latency_ms=latency_ms,
        retry_count=sum(1 for node in nodes if node == "retry"),
        interrupt_count=sum(1 for node in nodes if node == "approval"),
        approval_required=interrupted or route == "risky",
        approval_observed=state.get("approval") is not None,
        final_answer=state.get("final_answer"),
        pending_question=state.get("pending_question"),
        proposed_action=state.get("proposed_action"),
        events=events,
    )


@app.post("/api/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    thread_id = payload.thread_id or f"thread-{uuid.uuid4().hex[:8]}"
    run_config = RunnableConfig(configurable={"thread_id": thread_id}, recursion_limit=RECURSION_LIMIT)

    started = time.perf_counter()
    result = graph.invoke(_new_state(payload.query, thread_id), config=run_config)
    latency_ms = int((time.perf_counter() - started) * 1000)

    interrupted = isinstance(result, dict) and "__interrupt__" in result
    state = {k: v for k, v in result.items() if k != "__interrupt__"}
    return _to_response(state, latency_ms, interrupted)


@app.post("/api/chat/approval", response_model=ChatResponse)
def approve(payload: ApprovalRequest) -> ChatResponse:
    from langgraph.types import Command

    run_config = RunnableConfig(configurable={"thread_id": payload.thread_id}, recursion_limit=RECURSION_LIMIT)
    resume_payload = {
        "approved": payload.decision == "approve",
        "reviewer": "ui-operator",
        "comment": payload.comment or f"{payload.decision} via UI",
    }

    started = time.perf_counter()
    result = graph.invoke(Command(resume=resume_payload), config=run_config)

    resumes = 0
    while isinstance(result, dict) and "__interrupt__" in result:
        if resumes >= MAX_RESUMES:
            raise RuntimeError(f"Graph still interrupted after {MAX_RESUMES} resume attempts")
        result = graph.invoke(Command(resume=resume_payload), config=run_config)
        resumes += 1

    latency_ms = int((time.perf_counter() - started) * 1000)
    interrupted = isinstance(result, dict) and "__interrupt__" in result
    state = {k: v for k, v in result.items() if k != "__interrupt__"}
    return _to_response(state, latency_ms, interrupted)


_ui_dir = Path(__file__).resolve().parent.parent.parent / "ui"
if _ui_dir.is_dir():
    app.mount("/", StaticFiles(directory=_ui_dir, html=True), name="ui")
