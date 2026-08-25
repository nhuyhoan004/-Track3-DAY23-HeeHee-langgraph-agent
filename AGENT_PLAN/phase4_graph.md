# Phase 4 — graph.py: Build Complete StateGraph

## File to modify
`src/langgraph_agent_lab/graph.py`

## Critical rules
1. ALL 11 nodes must be registered with builder.add_node().
2. ALL routes must terminate at: finalize -> END. No path can skip finalize.
3. Conditional edge mappings must use node names EXACTLY as registered.
4. Compile with the passed-in checkpointer.

---

## Complete implementation

Replace the entire content of graph.py with:

```python
"""Graph construction."""

from __future__ import annotations

from typing import Any

from .state import AgentState


def build_graph(checkpointer: Any | None = None):
    """Build and compile the LangGraph workflow."""
    from langgraph.graph import StateGraph, START, END

    from .nodes import (
        intake_node,
        classify_node,
        tool_node,
        evaluate_node,
        answer_node,
        ask_clarification_node,
        risky_action_node,
        approval_node,
        retry_or_fallback_node,
        dead_letter_node,
        finalize_node,
    )
    from .routing import (
        route_after_classify,
        route_after_evaluate,
        route_after_retry,
        route_after_approval,
    )

    builder = StateGraph(AgentState)

    # ── Register all 11 nodes ──────────────────────────────────────────
    builder.add_node("intake", intake_node)
    builder.add_node("classify", classify_node)
    builder.add_node("tool", tool_node)
    builder.add_node("evaluate", evaluate_node)
    builder.add_node("answer", answer_node)
    builder.add_node("clarify", ask_clarification_node)
    builder.add_node("risky_action", risky_action_node)
    builder.add_node("approval", approval_node)
    builder.add_node("retry", retry_or_fallback_node)
    builder.add_node("dead_letter", dead_letter_node)
    builder.add_node("finalize", finalize_node)

    # ── Fixed edges ────────────────────────────────────────────────────
    builder.add_edge(START, "intake")
    builder.add_edge("intake", "classify")
    builder.add_edge("tool", "evaluate")
    builder.add_edge("risky_action", "approval")
    builder.add_edge("answer", "finalize")
    builder.add_edge("clarify", "finalize")
    builder.add_edge("dead_letter", "finalize")
    builder.add_edge("finalize", END)

    # ── Conditional edges ──────────────────────────────────────────────
    builder.add_conditional_edges(
        "classify",
        route_after_classify,
        {
            "answer": "answer",
            "tool": "tool",
            "clarify": "clarify",
            "risky_action": "risky_action",
            "retry": "retry",
        },
    )
    builder.add_conditional_edges(
        "evaluate",
        route_after_evaluate,
        {
            "answer": "answer",
            "retry": "retry",
        },
    )
    builder.add_conditional_edges(
        "retry",
        route_after_retry,
        {
            "tool": "tool",
            "dead_letter": "dead_letter",
        },
    )
    builder.add_conditional_edges(
        "approval",
        route_after_approval,
        {
            "tool": "tool",
            "clarify": "clarify",
        },
    )

    return builder.compile(checkpointer=checkpointer)
```

---

## Graph flow summary

```
START -> intake -> classify -> [route_after_classify]
  simple       -> answer -> finalize -> END
  tool         -> tool -> evaluate -> [route_after_evaluate]
                           success     -> answer -> finalize -> END
                           needs_retry -> retry -> [route_after_retry]
                                          attempt < max  -> tool (loop back)
                                          attempt >= max -> dead_letter -> finalize -> END
  missing_info -> clarify -> finalize -> END
  risky        -> risky_action -> approval -> [route_after_approval]
                                   approved -> tool -> evaluate -> ...
                                   rejected -> clarify -> finalize -> END
  error        -> retry -> [route_after_retry] -> ...
```

---

## Bonus: Generate Mermaid diagram after building graph

After `build_graph()` compiles successfully, run this to generate the diagram:

```python
# In a separate script or after make run-scenarios
from langgraph_agent_lab.graph import build_graph
from langgraph_agent_lab.persistence import build_checkpointer
import os

graph = build_graph(checkpointer=build_checkpointer("memory"))
mermaid_str = graph.get_graph().draw_mermaid()
os.makedirs("outputs", exist_ok=True)
with open("outputs/graph_diagram.md", "w") as f:
    f.write("# LangGraph Workflow Diagram\n\n")
    f.write("```mermaid\n")
    f.write(mermaid_str)
    f.write("\n```\n")
print("Diagram written to outputs/graph_diagram.md")
```

Save this as `scripts/generate_diagram.py` and run: `python scripts/generate_diagram.py`

---

## After implementing
Run: `pytest tests/ -v` (all 4 test files, requires OPENAI_API_KEY for smoke tests)
