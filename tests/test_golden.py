"""The committed golden file must equal a fresh regeneration."""

from __future__ import annotations

import json
from pathlib import Path

from vdpm.golden import build_golden_cases

GOLDEN = Path(__file__).resolve().parents[1] / "golden" / "cases.json"


def test_golden_file_is_up_to_date():
    assert GOLDEN.exists(), "run `vdpm golden` to create golden/cases.json"
    committed = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(build_golden_cases(), allow_nan=False))


def test_golden_covers_edge_cases():
    data = build_golden_cases()
    outputs = [c["output"] for c in data["corner_cases"]]
    assert any(o["feasible"] for o in outputs) and any(not o["feasible"] for o in outputs)
    assert any(o["max_cornering_speed"] == "Infinity" for o in outputs)
    assert any(o["critical_radius"] == "Infinity" for o in outputs)
    gates = {c["input"]["gate"] for c in data["circuit_cases"]}
    assert gates == {"strict", "none"}
