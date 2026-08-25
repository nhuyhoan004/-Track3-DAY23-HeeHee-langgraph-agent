"""Demonstrates time travel / state history replay using SQLite checkpointer.

Run: python scripts/time_travel_demo.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from dotenv import load_dotenv

load_dotenv()

from langgraph_agent_lab.graph import build_graph  # noqa: E402
from langgraph_agent_lab.persistence import build_checkpointer  # noqa: E402
from langgraph_agent_lab.state import Route, Scenario, initial_state  # noqa: E402


def main() -> None:
    checkpointer = build_checkpointer("sqlite")
    graph = build_graph(checkpointer=checkpointer)

    # Run a scenario
    scenario = Scenario(
        id="time-travel-demo",
        query="How do I reset my password?",
        expected_route=Route.SIMPLE,
    )
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


if __name__ == "__main__":
    main()
