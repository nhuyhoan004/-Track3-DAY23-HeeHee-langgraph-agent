"""Generate a Mermaid diagram of the compiled LangGraph workflow.

Run: python scripts/generate_diagram.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from dotenv import load_dotenv

load_dotenv()

from langgraph_agent_lab.graph import build_graph  # noqa: E402
from langgraph_agent_lab.persistence import build_checkpointer  # noqa: E402


def main() -> None:
    graph = build_graph(checkpointer=build_checkpointer("memory"))
    mermaid_str = graph.get_graph().draw_mermaid()
    os.makedirs("outputs", exist_ok=True)
    with open("outputs/graph_diagram.md", "w", encoding="utf-8") as f:
        f.write("# LangGraph Workflow Diagram\n\n")
        f.write("```mermaid\n")
        f.write(mermaid_str)
        f.write("\n```\n")
    print("Diagram written to outputs/graph_diagram.md")


if __name__ == "__main__":
    main()
