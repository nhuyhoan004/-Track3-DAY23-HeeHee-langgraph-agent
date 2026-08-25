"""CLI for the lab."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Annotated, Any

import typer
import yaml
from dotenv import load_dotenv
from langchain_core.runnables import RunnableConfig

from .graph import build_graph
from .metrics import (
    MetricsReport,
    ScenarioMetric,
    failed_metric,
    metric_from_state,
    summarize_metrics,
    write_metrics,
)
from .persistence import build_checkpointer
from .report import write_report
from .scenarios import load_scenarios
from .state import Scenario, initial_state

load_dotenv()

app = typer.Typer(no_args_is_help=True)

# Bounded retry loops cost 3 super-steps per attempt; the default limit of 25 is too tight
# for scenarios with a large max_attempts.
RECURSION_LIMIT = 100

# Max number of HITL interrupts to auto-resume in one run, so a misbehaving approval node
# cannot spin forever.
MAX_RESUMES = 5


def _run_one(graph: Any, scenario: Scenario) -> dict[str, Any]:
    """Invoke the graph for one scenario, auto-resuming any human-in-the-loop interrupt."""
    state = initial_state(scenario)
    run_config = RunnableConfig(
        configurable={"thread_id": state["thread_id"]},
        recursion_limit=RECURSION_LIMIT,
    )
    final_state = graph.invoke(state, config=run_config)

    # When LANGGRAPH_INTERRUPT=true, approval_node calls interrupt() and invoke() returns
    # early with an __interrupt__ payload. Resume with the reviewer decision.
    resumes = 0
    while isinstance(final_state, dict) and "__interrupt__" in final_state:
        if resumes >= MAX_RESUMES:
            raise RuntimeError(f"Graph still interrupted after {MAX_RESUMES} resume attempts")
        from langgraph.types import Command

        final_state = graph.invoke(
            Command(
                resume={
                    "approved": True,
                    "reviewer": "cli-auto-approver",
                    "comment": "Approved by run-scenarios (non-interactive mode)",
                }
            ),
            config=run_config,
        )
        resumes += 1

    return {"state": final_state, "config": run_config}


def _check_resume(graph: Any, run_config: RunnableConfig | None) -> bool:
    """Replay the last run's checkpoints to prove the checkpointer can restore state."""
    if run_config is None:
        return False
    try:
        history = list(graph.get_state_history(run_config))
        replayed = graph.get_state(run_config)
    except Exception:
        return False
    values = replayed.values if replayed is not None else {}
    has_answer = bool(values.get("final_answer") or values.get("pending_question"))
    return len(history) > 1 and has_answer


@app.command("run-scenarios")
def run_scenarios(
    config: Annotated[Path, typer.Option("--config")],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Run all grading scenarios and write metrics JSON."""
    cfg = yaml.safe_load(config.read_text(encoding="utf-8"))
    scenarios = load_scenarios(cfg["scenarios_path"])
    checkpointer = build_checkpointer(cfg.get("checkpointer", "memory"), cfg.get("database_url"))
    graph = build_graph(checkpointer=checkpointer)
    metrics: list[ScenarioMetric] = []
    last_config: RunnableConfig | None = None

    for scenario in scenarios:
        expected = scenario.expected_route.value
        started = time.perf_counter()
        try:
            outcome = _run_one(graph, scenario)
        except Exception as exc:  # one bad scenario must not kill the whole batch
            latency_ms = int((time.perf_counter() - started) * 1000)
            typer.echo(f"  {scenario.id}: FAILED — {type(exc).__name__}: {exc}", err=True)
            metrics.append(
                failed_metric(
                    scenario.id,
                    expected,
                    scenario.requires_approval,
                    f"{type(exc).__name__}: {exc}",
                    latency_ms,
                )
            )
            continue

        latency_ms = int((time.perf_counter() - started) * 1000)
        last_config = outcome["config"]
        metric = metric_from_state(
            outcome["state"], expected, scenario.requires_approval, latency_ms
        )
        metrics.append(metric)
        typer.echo(
            f"  {scenario.id}: route={metric.actual_route} "
            f"success={metric.success} nodes={metric.nodes_visited} {latency_ms}ms"
        )

    resume_success = _check_resume(graph, last_config)
    report = summarize_metrics(metrics, resume_success=resume_success)
    write_metrics(report, output)
    if cfg.get("report_path"):
        write_report(report, cfg["report_path"])
    typer.echo(f"Wrote metrics to {output}")


@app.command("validate-metrics")
def validate_metrics(metrics: Annotated[Path, typer.Option("--metrics")]) -> None:
    """Validate metrics JSON schema for grading."""
    payload = json.loads(metrics.read_text(encoding="utf-8"))
    report = MetricsReport.model_validate(payload)
    if report.total_scenarios < 6:
        raise typer.BadParameter("Expected at least 6 scenarios")
    typer.echo(f"Metrics valid. success_rate={report.success_rate:.2%}")


if __name__ == "__main__":
    app()
