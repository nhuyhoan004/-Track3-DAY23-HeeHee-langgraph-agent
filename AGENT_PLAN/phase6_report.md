# Phase 6 — report.py: Implement render_report()

## File to modify
`src/langgraph_agent_lab/report.py`

## What to do
Implement `render_report(metrics: MetricsReport) -> str` which generates a complete Markdown report.
The function is called automatically by `cli.py` after `make run-scenarios`.

## Implementation

```python
"""Report generation helper."""

from __future__ import annotations
from pathlib import Path
from datetime import datetime
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
- `classify_node` uses OpenAI GPT with `.with_structured_output()` to classify intent into 5 routes
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
| evaluation_result | overwrite | Latest evaluate gate decision |
| pending_question | overwrite | Latest clarification question |
| proposed_action | overwrite | Latest risky action description |
| approval | overwrite | Latest approval decision |

## 4. Scenario Results

"""

    # Per-scenario table
    summary += "| Scenario | Expected | Actual | Success | Nodes | Retries | Interrupts |\n"
    summary += "|---|---|---|:---:|---:|---:|---:|\n"
    for m in metrics.scenario_metrics:
        success_icon = "✅" if m.success else "❌"
        summary += f"| {m.scenario_id} | {m.expected_route} | {m.actual_route or 'N/A'} | {success_icon} | {m.nodes_visited} | {m.retry_count} | {m.interrupt_count} |\n"

    summary += f"""
**Summary**:
- Total scenarios: {metrics.total_scenarios}
- Success rate: {metrics.success_rate:.1%}
- Average nodes visited: {metrics.avg_nodes_visited:.1f}
- Total retries: {metrics.total_retries}
- Total HITL interrupts: {metrics.total_interrupts}

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

- Checkpointer type: SQLite (`outputs/checkpoints.db`)
- Each scenario run uses a unique `thread_id` (e.g., `thread-S01_simple`)
- State is saved after each node execution
- `get_state_history()` can replay any previous checkpoint
- See `scripts/time_travel_demo.py` for time-travel demonstration

## 7. Extension Work

1. **SQLite persistence**: Implemented `SqliteSaver` with WAL mode in `persistence.py`
2. **Mermaid diagram**: Generated via `graph.get_graph().draw_mermaid()` in `scripts/generate_diagram.py`
3. **Time travel**: `scripts/time_travel_demo.py` demonstrates `get_state_history()` replay
4. **HITL interrupt**: `approval_node` supports `interrupt()` when `LANGGRAPH_INTERRUPT=true`

## 8. Improvement Plan

If given one more day:
1. **Real tool integration**: Replace mock tool with actual order management API calls
2. **Streaming responses**: Use `graph.stream()` for real-time token streaming in answer_node
3. **LLM-as-judge evaluate_node**: Use GPT to evaluate tool result quality, not just "ERROR" heuristic
4. **Retry with exponential backoff**: Add sleep between retries to avoid rate limits
5. **Postgres checkpointer**: Production-grade persistence with concurrent access support
"""
    return summary


def write_report(metrics: MetricsReport, output_path: str | Path) -> None:
    """Write the rendered report to a file."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_report(metrics), encoding="utf-8")
```

---

## After implementing
Run: `make run-scenarios`
Verify: `reports/lab_report.md` is generated with all sections filled.
