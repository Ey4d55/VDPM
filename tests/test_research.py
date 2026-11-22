"""Research experiments: correctness of the statistics and reproducibility."""

from __future__ import annotations

import json

import pytest

pytest.importorskip("numpy")
pytest.importorskip("matplotlib")

from vdpm.golden import build_golden_cases
from vdpm.research.montecarlo import demand_sweep, run_monte_carlo, wilson_interval
from vdpm.research.run import run_all
from vdpm.research.scenario import Scenario
from vdpm.research.sensitivity import margin_tornado
from vdpm.research.verification import compare_engines, verify_table_2


def test_verification_passes():
    rows = verify_table_2()
    assert len(rows) == 10
    assert all(r.within_printed_resolution for r in rows)
    assert max(r.relative_error_vs_hand for r in rows) < 1e-14


def test_wilson_interval_reference_values():
    # Reference: Wilson (1927); 5 successes of 10 -> [0.2366, 0.7634]
    lo, hi = wilson_interval(5, 10)
    assert lo == pytest.approx(0.2366, abs=1e-4) and hi == pytest.approx(0.7634, abs=1e-4)
    assert wilson_interval(0, 100)[0] == 0.0
    assert wilson_interval(100, 100)[1] == 1.0


def test_monte_carlo_is_seeded_and_reproducible():
    a = run_monte_carlo("B", samples=60, seed=7)
    b = run_monte_carlo("B", samples=60, seed=7)
    c = run_monte_carlo("B", samples=60, seed=8)
    assert a == b
    assert a.winners != c.winners or a.feasible != c.feasible
    assert sum(p.successes for p in a.winners) == 60


def test_scenario_scaling_is_multiplicative():
    sc = Scenario("C").scaled(friction=1.1).scaled(friction=1.1)
    vehicle, _, _, _ = sc.build()
    assert vehicle.friction == pytest.approx(1.5 * 1.21)
    with pytest.raises(ValueError):
        Scenario("C").scaled(colour=2.0)


def test_demand_sweep_matches_direct_feasibility():
    rows = demand_sweep([15.0, 25.0])
    c25 = next(r for r in rows if r.circuit == "Circuit C" and r.lateral_acceleration == 25.0)
    assert not c25.feasible["Setup A"] and not c25.feasible["Setup B"]
    assert c25.vdpm_best == "none eligible"
    c15 = next(r for r in rows if r.circuit == "Circuit C" and r.lateral_acceleration == 15.0)
    assert c15.min_margin["Setup A"] == pytest.approx(0.2394, abs=1e-4)


def test_tornado_base_matches_table_2():
    rows = margin_tornado()
    base = {r.setup: r.margin_base for r in rows}
    assert base["Setup A"] == pytest.approx(0.23940, abs=1e-5)
    drag = [r for r in rows if r.parameter == "drag_coefficient"]
    assert all(r.swing == 0 for r in drag)


def test_engine_comparison(tmp_path):
    golden = build_golden_cases()
    ref = tmp_path / "ref.json"
    ref.write_text(json.dumps(golden))
    same = compare_engines(ref, ref)
    assert same.passed and same.max_relative_error == 0
    golden["corner_cases"][0]["output"]["drag"] *= 1 + 1e-9
    other = tmp_path / "other.json"
    other.write_text(json.dumps(golden))
    diff = compare_engines(ref, other)
    assert diff.mismatches == 1 and "drag" in diff.worst_path


def test_run_all_writes_outputs(tmp_path):
    summary = run_all(tmp_path, samples=30, log=False)
    assert summary["verification"]["table2_all_within_printed_resolution"]
    for name in (
        "REPORT.md",
        "summary.json",
        "tables/monte_carlo.csv",
        "figures/fig_model_curves.png",
    ):
        assert (tmp_path / name).exists(), name
