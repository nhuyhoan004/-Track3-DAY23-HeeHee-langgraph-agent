# Phase 5 — persistence.py: SQLite Checkpointer

## File to modify
`src/langgraph_agent_lab/persistence.py`

## What to do
Implement the `kind == "sqlite"` branch in `build_checkpointer()`.

## Implementation

```python
"""Checkpointer adapter."""

from __future__ import annotations
from pathlib import Path
from typing import Any


def build_checkpointer(kind: str = "memory", database_url: str | None = None) -> Any | None:
    """Return a LangGraph checkpointer."""
    if kind == "none":
        return None

    if kind == "memory":
        from langgraph.checkpoint.memory import MemorySaver
        return MemorySaver()

    if kind == "sqlite":
        import sqlite3
        from langgraph.checkpoint.sqlite import SqliteSaver
        db_path = database_url or "outputs/checkpoints.db"
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(db_path, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL;")
        return SqliteSaver(conn=conn)

    if kind == "postgres":
        raise NotImplementedError("Postgres checkpointer not implemented")

    raise ValueError(f"Unknown checkpointer kind: {kind}")
```

## Activating SQLite

Update `configs/lab.yaml`:
```yaml
scenarios_path: data/sample/scenarios.jsonl
checkpointer: sqlite
report_path: reports/lab_report.md
```

This causes each scenario run to save checkpoints to `outputs/checkpoints.db`.

---

## Bonus: Time travel demo with get_state_history()

Create `scripts/time_travel_demo.py`:

```python
"""Demonstrates time travel / state history replay using SQLite checkpointer."""

from __future__ import annotations
import sys
sys.path.insert(0, "src")

from dotenv import load_dotenv
load_dotenv()

from langgraph_agent_lab.graph import build_graph
from langgraph_agent_lab.persistence import build_checkpointer
from langgraph_agent_lab.state import Scenario, Route, initial_state

checkpointer = build_checkpointer("sqlite")
graph = build_graph(checkpointer=checkpointer)

# Run a scenario
scenario = Scenario(id="time-travel-demo", query="How do I reset my password?", expected_route=Route.SIMPLE)
state = initial_state(scenario)
config = {"configurable": {"thread_id": state["thread_id"]}}

print("=== Running scenario ===")
final = graph.invoke(state, config=config)
print(f"Final answer: {final.get('final_answer', '')[:100]}")

# Time travel: inspect all checkpoints
print("\n=== State history (time travel) ===")
for i, checkpoint in enumerate(graph.get_state_history(config)):
    step_num = checkpoint.metadata.get("step", "?")
    node = checkpoint.metadata.get("source", "?")
    events_count = len(checkpoint.values.get("events", []))
    print(f"  Checkpoint {i}: step={step_num} source={node} events_so_far={events_count}")

print("\nTime travel demo complete. Checkpoints saved to outputs/checkpoints.db")
```

Run: `python scripts/time_travel_demo.py`
Include output in `reports/lab_report.md` Section 6 as evidence.

---

## After implementing
Run: `make run-scenarios` (with checkpointer: sqlite in configs/lab.yaml)
Verify: `outputs/checkpoints.db` file exists and has data.
