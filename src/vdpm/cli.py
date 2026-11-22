"""Command-line interface: ``vdpm <command>`` or ``python -m vdpm <command>``.

Commands:
    table2   Recompute the manuscript's Table 2 and compare with the printed values.
    rank     Rank the manuscript's setups (or setups from a CSV) on a circuit.
    research Run every experiment; write tables, figures and a report.
    golden   Write the cross-implementation golden test cases.
"""

from __future__ import annotations

import argparse
import math
import sys
from collections.abc import Sequence

from . import __version__, reference
from .cfd_io import read_setups_csv
from .circuits import CASE_STUDY_LATERAL_ACCELERATION, circuit_from_csv, reference_circuit
from .explain import explain_ranking
from .golden import write_golden_cases
from .scoring import rank_setups


def _cmd_table2(_: argparse.Namespace) -> int:
    results = reference.reproduce_table_2()
    header = (
        f"{'':10}{'Drag (N)':>12}{'Downforce (N)':>15}{'Demand (N)':>12}"
        f"{'Grip (N)':>12}{'Reserve (%)':>13}{'Feasible':>10}"
    )
    print("Manuscript Table 2, recomputed from Table 1 (printed value in brackets)\n")
    print(header)
    ok = True
    for res, pub in zip(results, reference.TABLE_2, strict=True):
        print(
            f"{res.setup:10}{res.drag:12.2f}{res.downforce:15.2f}{res.required_force:12.2f}"
            f"{res.available_grip:12.2f}{res.margin * 100:13.2f}"
            f"{'Yes' if res.feasible else 'No':>10}"
        )
        print(
            f"{'':10}{f'[{pub.drag_n}]':>12}{f'[{pub.downforce_n}]':>15}{f'[{pub.demand_n}]':>12}"
            f"{f'[{pub.grip_n}]':>12}{f'[{pub.reserve_pct}]':>13}{f'[{pub.feasible}]':>10}"
        )
        half_f, half_r = pub.force_resolution / 2, pub.reserve_resolution / 2
        checks = (
            abs(res.drag - pub.drag_n) <= half_f + 1e-9,
            abs(res.downforce - pub.downforce_n) <= half_f + 1e-9,
            abs(res.required_force - pub.demand_n) <= half_f + 1e-9,
            abs(res.available_grip - pub.grip_n) <= half_f + 1e-9,
            abs(res.margin * 100 - pub.reserve_pct) <= half_r + 1e-9,
            res.feasible == pub.feasible,
        )
        ok &= all(checks)
    print("\nResult:", "all values agree with the printed table" if ok else "MISMATCH")
    return 0 if ok else 1


def _fmt(value: float, digits: int = 1) -> str:
    return "inf" if math.isinf(value) else f"{value:.{digits}f}"


def _cmd_rank(args: argparse.Namespace) -> int:
    if args.circuit_csv:
        circuit = circuit_from_csv(args.circuit_csv)
    else:
        circuit = reference_circuit(args.circuit, args.lateral_acceleration)
    setups = read_setups_csv(args.setups) if args.setups else [reference.SETUP_A, reference.SETUP_B]
    vehicle = reference.VEHICLE
    ranking = rank_setups(
        vehicle, setups, circuit, gate=args.gate, normalisation=args.normalisation
    )
    w = ranking.weights
    print(
        f"{circuit.name}: {len(circuit.corners)} corners, straight fraction "
        f"{circuit.straight_fraction:.3f}, "
        f"weights w_D={w.drag:.3f} w_G={w.grip:.3f} w_M={w.margin:.3f}"
    )
    if circuit.provenance:
        print(f"Provenance: {circuit.provenance}")
    print()
    print(f"{'Setup':20}{'Eligible':>9}{'Score':>10}{'Rank':>6}{'Min margin %':>14}")
    for e in ranking.ordered:
        score = "-" if e.score is None else f"{e.score:.4f}"
        rank = "-" if e.rank is None else str(e.rank)
        print(
            f"{e.name:20}{'yes' if e.eligible else 'no':>9}{score:>10}{rank:>6}"
            f"{_fmt(e.evaluation.min_margin * 100):>14}"
        )
    print()
    for finding in explain_ranking(ranking):
        print("-", finding.text)
    return 0


def _cmd_research(args: argparse.Namespace) -> int:
    try:
        from .research.run import run_all
    except ImportError as exc:  # pragma: no cover - depends on optional extras
        print(
            f"The research suite needs NumPy and Matplotlib: pip install 'vdpm[research]' ({exc})"
        )
        return 2
    run_all(
        args.out, samples=args.samples, seed=args.seed, browser_engine_output=args.browser_output
    )
    return 0


def _cmd_golden(args: argparse.Namespace) -> int:
    count = write_golden_cases(args.out)
    print(f"Wrote {count} golden cases to {args.out}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="vdpm", description=__doc__.splitlines()[0])
    parser.add_argument("--version", action="version", version=f"vdpm {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("table2", help="recompute manuscript Table 2").set_defaults(func=_cmd_table2)

    p_rank = sub.add_parser("rank", help="rank setups on a circuit")
    p_rank.add_argument("--circuit", default="C", choices=["A", "B", "C"])
    p_rank.add_argument("--circuit-csv", help="segment CSV instead of a reference circuit")
    p_rank.add_argument("--setups", help="setups CSV (name,C_D,C_DF)")
    p_rank.add_argument(
        "--lateral-acceleration", type=float, default=CASE_STUDY_LATERAL_ACCELERATION
    )
    p_rank.add_argument("--gate", choices=["strict", "none"], default="strict")
    p_rank.add_argument("--normalisation", choices=["ratio", "minmax"], default="ratio")
    p_rank.set_defaults(func=_cmd_rank)

    p_res = sub.add_parser("research", help="run every experiment and write tables and figures")
    p_res.add_argument("--out", default="results")
    p_res.add_argument("--samples", type=int, default=5000)
    p_res.add_argument("--seed", type=int, default=20261122)
    p_res.add_argument("--browser-output", help="browser-engine golden output to compare against")
    p_res.set_defaults(func=_cmd_research)

    p_golden = sub.add_parser("golden", help="write golden test cases")
    p_golden.add_argument("--out", default="golden/cases.json")
    p_golden.set_defaults(func=_cmd_golden)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
