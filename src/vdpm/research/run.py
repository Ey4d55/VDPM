"""Run the full research suite and write every table, figure and a report."""

from __future__ import annotations

import csv
import json
import math
import tempfile
import time
from collections.abc import Iterable, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .. import __version__
from ..circuits import REFERENCE_SUMMARIES, circuit_to_csv, reference_circuit
from ..golden import build_golden_cases
from . import figures
from .montecarlo import DEFAULT_UNCERTAINTY, demand_sweep, run_monte_carlo
from .sensitivity import margin_tornado, ranking_robustness
from .timing import environment_description, run_timings
from .verification import compare_engines, verify_table_2

__all__ = ["H1_DEMAND_RANGE", "run_all"]

#: Range of corner demand a_ref (m/s^2) explored in the H1 Monte Carlo.
H1_DEMAND_RANGE = (10.0, 30.0)


def _write_csv(path: Path, header: Sequence[str], rows: Iterable[Sequence[Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(header)
        for row in rows:
            writer.writerow(["" if v is None else v for v in row])


def _pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def run_all(
    out_dir: str | Path = "results",
    samples: int = 5000,
    seed: int = 20261122,
    browser_engine_output: str | Path | None = None,
    log: bool = True,
) -> dict[str, Any]:
    """Run every experiment; write ``tables/``, ``figures/``, ``summary.json``, ``REPORT.md``."""
    out = Path(out_dir)
    tables, figs = out / "tables", out / "figures"
    figures.apply_style()
    summary: dict[str, Any] = {"vdpm_version": __version__, "seed": seed}
    t_start = time.perf_counter()

    def say(msg: str) -> None:
        if log:
            print(msg, flush=True)

    # 1. Verification ---------------------------------------------------------
    say("[1/6] Verification against Table 2 and an independent hand calculation")
    ver = verify_table_2()
    _write_csv(
        tables / "verification_table2.csv",
        [
            "setup",
            "quantity",
            "unit",
            "printed",
            "computed",
            "hand_calculation",
            "abs_diff_vs_printed",
            "within_printed_resolution",
            "rel_error_vs_hand",
        ],
        [
            (
                r.setup,
                r.quantity,
                r.unit,
                r.printed,
                repr(r.computed),
                repr(r.hand),
                abs(r.computed - r.printed),
                r.within_printed_resolution,
                r.relative_error_vs_hand,
            )
            for r in ver
        ],
    )
    golden = build_golden_cases()
    summary["verification"] = {
        "table2_values": len(ver),
        "table2_all_within_printed_resolution": all(r.within_printed_resolution for r in ver),
        "max_rel_error_vs_hand_calculation": max(r.relative_error_vs_hand for r in ver),
        "golden_corner_cases": len(golden["corner_cases"]),
        "golden_circuit_cases": len(golden["circuit_cases"]),
    }
    if browser_engine_output:
        # Compare against freshly generated reference cases, kept out of the results folder.
        with tempfile.TemporaryDirectory() as tmp:
            golden_path = Path(tmp) / "golden_reference.json"
            golden_path.write_text(json.dumps(golden, allow_nan=False), encoding="utf-8")
            cmp = compare_engines(golden_path, browser_engine_output)
        summary["verification"]["browser_engine"] = asdict(cmp) | {"passed": cmp.passed}

    # 2. Timing -----------------------------------------------------------------
    say("[2/6] Processing time")
    timings = run_timings()
    _write_csv(
        tables / "timing.csv",
        ["task", "median_us", "q1_us", "q3_us", "repeats", "calls_per_repeat"],
        [
            (
                t.task,
                f"{t.median_us:.3f}",
                f"{t.q1_us:.3f}",
                f"{t.q3_us:.3f}",
                t.repeats,
                t.calls_per_repeat,
            )
            for t in timings
        ],
    )
    summary["timing"] = {
        "environment": environment_description(),
        "results": [asdict(t) for t in timings],
    }

    # 3. One-at-a-time sensitivity ----------------------------------------------
    say("[3/6] One-at-a-time sensitivity")
    tornado = margin_tornado(0.10)
    _write_csv(
        tables / "sensitivity_margin_oat.csv",
        ["setup", "parameter", "delta", "margin_base", "margin_minus", "margin_plus", "swing"],
        [
            (r.setup, r.parameter, r.delta, r.margin_base, r.margin_low, r.margin_high, r.swing)
            for r in tornado
        ],
    )
    fig, cap = figures.fig_tornado(tornado)
    figures.save(fig, figs, "fig_sensitivity_tornado")
    summary.setdefault("figures", {})["fig_sensitivity_tornado"] = cap

    robust = ranking_robustness()
    _write_csv(
        tables / "ranking_robustness.csv",
        [
            "circuit",
            "parameter",
            "baseline_best",
            "decrease_that_changes_best",
            "outcome_after_decrease",
            "increase_that_changes_best",
            "outcome_after_increase",
        ],
        [
            (
                r.circuit,
                r.parameter,
                r.baseline_best,
                r.lower_change,
                r.lower_outcome,
                r.upper_change,
                r.upper_outcome,
            )
            for r in robust
        ],
    )
    summary["robustness"] = [asdict(r) for r in robust]

    # 4. Monte Carlo --------------------------------------------------------------
    say(f"[4/6] Monte Carlo ranking stability ({samples} samples per circuit)")
    mc = [run_monte_carlo(k, samples, seed) for k in REFERENCE_SUMMARIES]
    h1 = [
        run_monte_carlo(k, samples, seed, demand_range=H1_DEMAND_RANGE) for k in REFERENCE_SUMMARIES
    ]
    rows = []
    for scenario, results in (("reference demand", mc), (f"a_ref U{H1_DEMAND_RANGE}", h1)):
        for r in results:
            for group, props in (
                ("recommended", r.winners),
                ("feasible", r.feasible),
                ("top_choice_infeasible", r.baseline_infeasible),
                ("top_choice_infeasible_avoidable", r.baseline_avoidable),
            ):
                for p in props:
                    lo, hi = p.interval
                    rows.append(
                        (scenario, r.circuit, group, p.label, p.successes, p.n, p.value, lo, hi)
                    )
    _write_csv(
        tables / "monte_carlo.csv",
        [
            "scenario",
            "circuit",
            "measure",
            "label",
            "count",
            "samples",
            "proportion",
            "ci95_low",
            "ci95_high",
        ],
        rows,
    )
    fig, cap = figures.fig_monte_carlo(mc, h1)
    figures.save(fig, figs, "fig_monte_carlo")
    summary["figures"]["fig_monte_carlo"] = cap
    summary["monte_carlo"] = {
        "samples_per_circuit": samples,
        "uncertainty": DEFAULT_UNCERTAINTY,
        "circuits": {
            r.circuit: {
                "baseline_best": r.baseline_best,
                "baseline_best_kept": r.best_counts.value,
                "baseline_best_kept_ci95": r.best_counts.interval,
                "top_choice_infeasible": {p.label: p.value for p in r.baseline_infeasible},
            }
            for r in mc
        },
        "h1_demand_range": H1_DEMAND_RANGE,
        "h1": {
            r.circuit: {
                "top_choice_infeasible": {
                    p.label: [p.value, *p.interval] for p in r.baseline_infeasible
                },
                "avoidable": {p.label: [p.value, *p.interval] for p in r.baseline_avoidable},
                "no_setup_feasible": next(p.value for p in r.winners if p.label == "none eligible"),
            }
            for r in h1
        },
    }

    # 5. Demand sweep (H1) -------------------------------------------------------
    say("[5/6] Corner-demand sweep and baseline comparison")
    sweep = demand_sweep()
    setups = list(sweep[0].min_margin)
    methods = list(sweep[0].baseline_top_infeasible)
    _write_csv(
        tables / "demand_sweep.csv",
        [
            "circuit",
            "a_ref_mps2",
            *[f"min_margin_{s}" for s in setups],
            *[f"feasible_{s}" for s in setups],
            "vdpm_best",
            *[f"top_infeasible_{m}" for m in methods],
        ],
        [
            (
                r.circuit,
                r.lateral_acceleration,
                *[r.min_margin[s] for s in setups],
                *[r.feasible[s] for s in setups],
                r.vdpm_best,
                *[r.baseline_top_infeasible[m] for m in methods],
            )
            for r in sweep
        ],
    )
    fig, cap = figures.fig_demand_sweep(sweep)
    figures.save(fig, figs, "fig_demand_sweep")
    summary["figures"]["fig_demand_sweep"] = cap
    summary["demand_sweep"] = {
        "points": len(sweep),
        "share_top_choice_infeasible": {
            m: sum(r.baseline_top_infeasible[m] for r in sweep) / len(sweep) for m in methods
        },
        "share_top_choice_infeasible_avoidable": {
            m: sum(r.baseline_top_infeasible[m] and r.vdpm_best != "none eligible" for r in sweep)
            / len(sweep)
            for m in methods
        },
        "share_no_setup_eligible": sum(r.vdpm_best == "none eligible" for r in sweep) / len(sweep),
    }

    # 6. Model-consistent figures and circuit data --------------------------------
    say("[6/6] Model-consistent figures and circuit data")
    fig, cap = figures.fig_model_curves()
    figures.save(fig, figs, "fig_model_curves")
    summary["figures"]["fig_model_curves"] = cap
    for key in REFERENCE_SUMMARIES:
        circuit = reference_circuit(key)
        path = out / "circuits" / f"circuit_{key}_synthetic.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(circuit_to_csv(circuit), encoding="utf-8")

    summary["runtime_s"] = time.perf_counter() - t_start
    (out / "summary.json").write_text(
        json.dumps(_clean(summary), indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    (out / "REPORT.md").write_text(_report(summary), encoding="utf-8")
    say(f"Done in {summary['runtime_s']:.1f} s. Results in {out.resolve()}")
    return summary


def _clean(value: Any) -> Any:
    if isinstance(value, float) and math.isinf(value):
        return "Infinity"
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    return value


def _report(s: dict[str, Any]) -> str:
    v = s["verification"]
    lines = [
        "# VDPM research results",
        "",
        f"Generated by vdpm {s['vdpm_version']} with seed {s['seed']}. Every number below is recomputed by "
        "`vdpm research`; the CSV files in `tables/` hold the full data and `figures/` the figures.",
        "",
        "## 1. Numerical verification",
        "",
        f"- Table 2: {v['table2_values']} values recomputed from Table 1; all within the printed resolution: "
        f"**{'yes' if v['table2_all_within_printed_resolution'] else 'NO'}**.",
        f"- Maximum relative difference from an independent hand calculation: {v['max_rel_error_vs_hand_calculation']:.2e}.",
        f"- Golden cases for cross-implementation checks: {v['golden_corner_cases']} corner cases and "
        f"{v['golden_circuit_cases']} circuit rankings.",
    ]
    if "browser_engine" in v:
        b = v["browser_engine"]
        lines.append(
            f"- Browser engine: {b['values_compared']:,} values compared, maximum relative error "
            f"{b['max_relative_error']:.2e}, mismatches above {b['tolerance']:.0e}: {b['mismatches']}."
        )
    env = s["timing"]["environment"]
    lines += [
        "",
        "## 2. Processing time",
        "",
        f"Python {env['python']} ({env['implementation']}), {env['system']}, {env['machine']}.",
        "",
        "| Task | Median (µs) | IQR (µs) |",
        "| --- | ---: | ---: |",
    ]
    for t in s["timing"]["results"]:
        lines.append(
            f"| {t['task']} | {t['median_us']:.1f} | {t['q1_us']:.1f} to {t['q3_us']:.1f} |"
        )
    lines += [
        "",
        "## 3. Ranking robustness (one at a time)",
        "",
        "Smallest relative change of one input (others at reference values) that changes the "
        "recommended setup; blank means no change within ±50 %.",
        "",
        "| Circuit | Parameter | Recommended | Decrease | Increase |",
        "| --- | --- | --- | ---: | ---: |",
    ]
    for r in s["robustness"]:
        lo = (
            ""
            if r["lower_change"] is None
            else f"{r['lower_change'] * 100:+.1f}% → {r['lower_outcome']}"
        )
        hi = (
            ""
            if r["upper_change"] is None
            else f"{r['upper_change'] * 100:+.1f}% → {r['upper_outcome']}"
        )
        lines.append(f"| {r['circuit']} | {r['parameter']} | {r['baseline_best']} | {lo} | {hi} |")
    mc = s["monte_carlo"]
    lines += [
        "",
        "## 4. Monte Carlo ranking stability",
        "",
        f"{mc['samples_per_circuit']} samples per circuit; uniform multiplicative uncertainty "
        + ", ".join(f"{k} ±{u * 100:g}%" for k, u in mc["uncertainty"].items())
        + " (illustrative assumptions).",
        "",
        "| Circuit | Recommended at reference inputs | Same recommendation in samples (95% CI) |",
        "| --- | --- | ---: |",
    ]
    for name, c in mc["circuits"].items():
        lo, hi = c["baseline_best_kept_ci95"]
        lines.append(
            f"| {name} | {c['baseline_best']} | {_pct(c['baseline_best_kept'])} ({_pct(lo)} to {_pct(hi)}) |"
        )
    d = s["demand_sweep"]
    lo_d, hi_d = mc["h1_demand_range"]
    lines += [
        "",
        "## 5. Baseline comparison (hypothesis H1)",
        "",
        f"Monte Carlo with corner demand a_ref drawn uniformly from {lo_d:g} to {hi_d:g} m/s² and the "
        "uncertainty above on the other inputs. Share of samples in which each unconstrained ranking "
        "recommends a setup that fails at least one corner although a feasible setup existed "
        "(95% Wilson interval). The gated VDPM ranking never does, by construction.",
        "",
        "| Circuit | "
        + " | ".join(next(iter(mc["h1"].values()))["avoidable"])
        + " | No setup feasible |",
        "| --- |" + " ---: |" * (len(next(iter(mc["h1"].values()))["avoidable"]) + 1),
    ]
    for name, c in mc["h1"].items():
        cells = [f"{_pct(v)} ({_pct(lo)} to {_pct(hi)})" for v, lo, hi in c["avoidable"].values()]
        lines.append(f"| {name} | " + " | ".join(cells) + f" | {_pct(c['no_setup_feasible'])} |")
    lines += [
        "",
        "## 6. Corner-demand sweep",
        "",
        f"{d['points']} deterministic scenarios (3 circuits × a_ref from 10 to 30 m/s² in steps of "
        "0.25, other inputs at reference values). Share in which each unconstrained method "
        "recommends a setup that fails at least one corner although a feasible setup existed:",
        "",
    ]
    for m, share in d["share_top_choice_infeasible_avoidable"].items():
        lines.append(f"- {m}: {_pct(share)}")
    lines.append(
        f"- Scenarios with no eligible setup (VDPM makes no recommendation): {_pct(d['share_no_setup_eligible'])}"
    )
    lines += ["", "## Figures", ""]
    for stem, cap in s["figures"].items():
        lines.append(f"- `figures/{stem}.png`: {cap}")
    lines += [
        "",
        "## Scope",
        "",
        "All results use the manuscript's simplified model (planar constant-radius corners, constant "
        "friction, no load transfer) and synthetic circuit layouts that match the published summary "
        "statistics. They demonstrate the method; they are not predictions of real lap-time performance.",
        "",
    ]
    return "\n".join(lines)
