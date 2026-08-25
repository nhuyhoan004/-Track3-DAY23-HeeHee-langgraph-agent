# AGENT IMPLEMENTATION PLAN
# Day 08 — LangGraph Agentic Orchestration
# Author: Reviewer Agent | Target: Implementation Agent

---

## ROLE ASSIGNMENT

- **Implementation Agent** (YOU): Read this plan and all files in `AGENT_PLAN/` thoroughly, then implement every TODO in exact order.
- **Reviewer Agent**: Will verify code correctness, run tests, validate metrics, and sign off.

> WARNING: DO NOT skip or reorder phases. Each phase depends on the previous one.
> WARNING: DO NOT hard-code answers to specific Scenario IDs. All routing MUST use LLM classification and state logic.
> WARNING: DO NOT mutate state dict in-place. Always return a NEW partial dict from each node.

---

## ENVIRONMENT SETUP (Do this FIRST before any coding)

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e .[dev]
pip install langchain-openai
pip install langgraph-checkpoint-sqlite
copy .env.example .env
# Edit .env — fill in OPENAI_API_KEY=sk-...
```

Contents of `.env`:
```
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
CHECKPOINTER=sqlite
LANGGRAPH_INTERRUPT=false
LOG_LEVEL=INFO
```

---

## EXECUTION ORDER

| Phase | File | Task | Points |
|---|---|---|---:|
| 1 | `state.py` | Add 4 fields to AgentState | 15 |
| 2 | `nodes.py` | Implement 10 node functions | 35 |
| 3 | `routing.py` | Implement 4 routing functions | 15 |
| 4 | `graph.py` | Build complete StateGraph | 20 |
| 5 | `persistence.py` | SQLite checkpointer | 10 |
| 6 | `report.py` | render_report() function | 5 |
| 7 | `reports/lab_report.md` | Written lab report | 10 |

Read detailed spec for each phase in `AGENT_PLAN/phase{N}_*.md` before implementing.

---

## VERIFICATION COMMANDS

```bash
pytest tests/test_state.py tests/test_routing.py tests/test_metrics.py -v
pytest tests/test_graph_smoke.py -v
python -m langgraph_agent_lab.cli run-scenarios --config configs/lab.yaml --output outputs/metrics.json
python -m langgraph_agent_lab.cli validate-metrics --metrics outputs/metrics.json
ruff check src tests
mypy src
```

---

## REVIEW CHECKLIST (Reviewer Agent signs off each item)

### Code Correctness
- [ ] `state.py`: 4 fields added: evaluation_result, pending_question, proposed_action, approval
- [ ] `classify_node`: Uses get_llm() + .with_structured_output() — NO keyword heuristics
- [ ] `answer_node`: Uses get_llm() — grounded on tool_results and context
- [ ] `evaluate_node`: Sets evaluation_result to "success" or "needs_retry" only
- [ ] `route_after_retry`: Bounded check (attempt >= max_attempts -> dead_letter)
- [ ] `finalize_node`: Reached by ALL routes before END
- [ ] `graph.py`: All 11 nodes registered, no dangling edges

### Scenario Behavior
- [ ] S01 simple -> route=simple, has final_answer
- [ ] S02 tool -> route=tool, has tool_results + final_answer
- [ ] S03 missing_info -> route=missing_info, has pending_question
- [ ] S04 risky -> route=risky, approval dict not None
- [ ] S05 error -> route=error, retry_count >= 1, has final_answer
- [ ] S06 risky -> route=risky, approval dict not None
- [ ] S07 dead_letter -> max_attempts=1, final_answer set by dead_letter_node

### Tests
- [ ] test_state.py PASS
- [ ] test_routing.py PASS (all 10 assertions)
- [ ] test_metrics.py PASS
- [ ] test_graph_smoke.py PASS
- [ ] make grade-local PASS

### Outputs
- [ ] outputs/metrics.json valid, total_scenarios >= 6
- [ ] reports/lab_report.md has all 7 sections
- [ ] outputs/graph_diagram.md exists (Mermaid bonus)

### Bonus Extensions
- [ ] SQLite checkpointer working
- [ ] Mermaid diagram at outputs/graph_diagram.md
- [ ] Time travel: get_state_history() call logged somewhere
- [ ] HITL interrupt() code in approval_node (gated by LANGGRAPH_INTERRUPT env)
