"""Report generation helper."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from .metrics import MetricsReport


def render_report(metrics: MetricsReport) -> str:
    """Render a complete lab report from metrics data."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    # --- Summary table ---
    summary = f"""# Day 08 Lab Report

## 1. Team / Student

- **Name**: Nguyen Tuan Duc
- **Student ID**: 2A202601380
- **Date**: {now}

## 2. Architecture

The system implements a LangGraph StateGraph for support-ticket routing with 11 nodes:

**Flow**: START → intake → classify → [conditional route] → ... → finalize → END

**Key design decisions**:
- `classify_node` uses an LLM with `.with_structured_output()` to classify intent into 5 routes
- `evaluate_node` acts as a retry-loop gate checking tool result quality
- All paths must pass through `finalize_node` before END for auditability
- Bounded retry: `max_attempts` prevents infinite loops

## 3. State Schema

| Field | Reducer | Why |
|---|---|---|
| messages | append | Audit conversation history |
| tool_results | append | Preserve all tool call results |
| errors | append | Track all error messages |
| events | append | Full audit trail of node executions |
| route | overwrite | Only current route matters |
| attempt | overwrite | Current retry count |
| should_retry | overwrite | Scenario flag driving tool failure simulation |
| tool_status | overwrite | Structured `ok`/`error` flag — evaluate gate reads this, not text |
| evaluation_result | overwrite | Latest evaluate gate decision |
| pending_question | overwrite | Latest clarification question |
| proposed_action | overwrite | Latest risky action description |
| approval | overwrite | Latest approval decision |

## 4. Scenario Results

"""

    # Per-scenario table
    summary += (
        "| Scenario | Expected | Actual | Success | Nodes | Retries | Interrupts | Latency |\n"
    )
    summary += "|---|---|---|:---:|---:|---:|---:|---:|\n"
    for m in metrics.scenario_metrics:
        success_icon = "✅" if m.success else "❌"
        summary += (
            f"| {m.scenario_id} | {m.expected_route} | {m.actual_route or 'N/A'} "
            f"| {success_icon} | {m.nodes_visited} | {m.retry_count} | {m.interrupt_count} "
            f"| {m.latency_ms} ms |\n"
        )

    summary += f"""
**Summary**:
- Total scenarios: {metrics.total_scenarios}
- Success rate: {metrics.success_rate:.1%}
- Average nodes visited: {metrics.avg_nodes_visited:.1f}
- Total retries: {metrics.total_retries}
- Total HITL interrupts: {metrics.total_interrupts}
- Checkpoint replay verified: {"yes" if metrics.resume_success else "no"}

## 5. Failure Analysis

### Failure Mode 1: Retry exhaustion → Dead Letter
When the `error` route is triggered and the tool fails repeatedly, the system increments `attempt`
until `attempt >= max_attempts`. At that point, `route_after_retry` returns "dead_letter" instead
of "tool", breaking the loop. S07 demonstrates this with `max_attempts=1`.

**Root cause**: Transient tool failures (timeouts, service unavailability).
**Mitigation**: Dead letter node escalates to human support team with full context.

### Failure Mode 2: Risky action without approval
Without the HITL approval step, risky actions (refunds, deletions) would execute immediately.
The `risky_action_node` prepares the action description, then `approval_node` blocks execution.
If `LANGGRAPH_INTERRUPT=true`, a real human must approve; otherwise, mock approval is used.

**Root cause**: Actions with irreversible side effects need human oversight.
**Mitigation**: Approval gate with configurable mock/real modes via env var.

## 6. Persistence / Recovery Evidence

- Checkpointer type: SQLite (`outputs/checkpoints.db`), WAL mode
- Each scenario run uses a **unique** `thread_id` (`thread-<scenario_id>-<run_uuid>`)
- State is saved after each node execution
- `resume_success = {metrics.resume_success}` — set by `cli._check_resume()`, which after the
  batch replays the last thread via `get_state_history()` and re-reads the persisted state
  with `get_state()`. It is `true` only when the history holds more than one checkpoint **and**
  the restored state still carries the final answer.
- See `scripts/time_travel_demo.py` for the standalone time-travel demonstration

> **Why `thread_id` must be unique per run**: `events`, `errors`, `messages` and `tool_results`
> use the append-only `add` reducer. Re-invoking a stable `thread_id` against the persistent
> SQLite checkpointer replays the previous run's channel values, so every count in this report
> would compound with each run (an earlier version of this lab reported ~3x inflated
> `nodes_visited` and duplicate "Attempt 1 / Attempt 2" error entries for exactly this reason).

## 7. Extension Work

1. **SQLite persistence**: Implemented `SqliteSaver` with WAL mode in `persistence.py`
2. **Mermaid diagram**: Generated via `graph.get_graph().draw_mermaid()` in
   `scripts/generate_diagram.py`
3. **Time travel**: `scripts/time_travel_demo.py` demonstrates `get_state_history()` replay
4. **HITL interrupt**: `approval_node` supports `interrupt()` when `LANGGRAPH_INTERRUPT=true`

## 8. Improvement Plan

If given one more day:
1. **Real tool integration**: Replace mock tool with actual order management API calls
2. **Streaming responses**: Use `graph.stream()` for real-time token streaming in answer_node
3. **LLM-as-judge evaluate_node**: Use the LLM to score tool result *quality*. The gate today
   reads the structured `tool_status` flag, which is reliable for hard failures but says nothing
   about whether the payload actually answers the user's question
4. **Retry with exponential backoff**: Add sleep between retries to avoid rate limits
5. **Postgres checkpointer**: Production-grade persistence with concurrent access support
"""
    return summary


def write_report(metrics: MetricsReport, output_path: str | Path) -> None:
    """Write the rendered report to a file."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_report(metrics), encoding="utf-8")
