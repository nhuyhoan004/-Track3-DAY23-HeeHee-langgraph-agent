.PHONY: install test lint typecheck run-scenarios grade-local serve clean

install:
	pip install -e '.[dev]'

serve:
	uvicorn langgraph_agent_lab.server:app --reload --port 8000

test:
	pytest

lint:
	ruff check src tests

typecheck:
	mypy src

run-scenarios:
	python -m langgraph_agent_lab.cli run-scenarios --config configs/lab.yaml --output outputs/metrics.json

grade-local:
	python -m langgraph_agent_lab.cli validate-metrics --metrics outputs/metrics.json

clean:
	rm -rf .pytest_cache .ruff_cache .mypy_cache htmlcov dist build *.egg-info outputs/*.json
	rm -f outputs/checkpoints.db outputs/checkpoints.db-wal outputs/checkpoints.db-shm
