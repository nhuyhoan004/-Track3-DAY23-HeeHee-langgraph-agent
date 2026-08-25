"""Shared pytest configuration: load .env so LLM-backed smoke tests run."""

from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()
