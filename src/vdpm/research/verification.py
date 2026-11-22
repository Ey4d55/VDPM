"""Numerical verification (proposal: "agreement with reference calculations").

Two independent checks:

1. **Against the manuscript.** Every value of Table 2 is recomputed from
   Table 1 and compared with the printed value at the printed resolution.
2. **Against an independent hand calculation.** The same quantities are
   computed with bare arithmetic, written out separately from
   :mod:`vdpm.physics`, and compared at full double precision.

A third check, agreement between the Python and browser engines, compares the
golden cases with the browser engine's output file (see :func:`compare_engines`).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .. import reference

__all__ = ["EngineComparison", "VerificationRow", "compare_engines", "verify_table_2"]


@dataclass(frozen=True, slots=True)
class VerificationRow:
    setup: str
    quantity: str
    unit: str
    printed: float
    computed: float
    hand: float
    resolution: float

    @property
    def within_printed_resolution(self) -> bool:
        return abs(self.computed - self.printed) <= self.resolution / 2 + 1e-9

    @property
    def relative_error_vs_hand(self) -> float:
        return abs(self.computed - self.hand) / abs(self.hand)


def _hand_calculation(cd: float, cdf: float) -> dict[str, float]:
    """Table 2 by bare arithmetic, independent of vdpm.physics."""
    m, v, rho, area, mu, r, g = 800.0, 30.0, 1.225, 1.50, 1.50, 60.0, 9.81
    q_area = 0.5 * rho * v**2 * area
    drag_n = q_area * cd
    down_n = q_area * cdf
    demand = m * v**2 / r
    grip = mu * (m * g + down_n)
    return {
        "drag": drag_n,
        "downforce": down_n,
        "demand": demand,
        "grip": grip,
        "reserve": 100.0 * (grip - demand) / demand,
    }


def verify_table_2() -> list[VerificationRow]:
    """Compare recomputed Table 2 with the printed and hand-calculated values."""
    rows = []
    results = reference.reproduce_table_2()
    setups = (reference.SETUP_A, reference.SETUP_B)
    for res, pub, setup in zip(results, reference.TABLE_2, setups, strict=True):
        hand = _hand_calculation(setup.drag_coefficient, setup.downforce_coefficient)
        computed = {
            "drag": res.drag,
            "downforce": res.downforce,
            "demand": res.required_force,
            "grip": res.available_grip,
            "reserve": 100.0 * res.margin,
        }
        printed = {
            "drag": pub.drag_n,
            "downforce": pub.downforce_n,
            "demand": pub.demand_n,
            "grip": pub.grip_n,
            "reserve": pub.reserve_pct,
        }
        for key, unit in (
            ("drag", "N"),
            ("downforce", "N"),
            ("demand", "N"),
            ("grip", "N"),
            ("reserve", "%"),
        ):
            resolution = pub.reserve_resolution if key == "reserve" else pub.force_resolution
            rows.append(
                VerificationRow(
                    pub.setup, key, unit, printed[key], computed[key], hand[key], resolution
                )
            )
    return rows


@dataclass(frozen=True, slots=True)
class EngineComparison:
    """Agreement between the reference engine and another implementation."""

    values_compared: int
    max_relative_error: float
    worst_path: str
    mismatches: int
    tolerance: float

    @property
    def passed(self) -> bool:
        return self.mismatches == 0


def _walk(ref: Any, other: Any, path: str, out: list[tuple[str, float]]) -> None:
    if isinstance(ref, dict):
        for key, value in ref.items():
            _walk(value, other.get(key) if isinstance(other, dict) else None, f"{path}.{key}", out)
    elif isinstance(ref, list):
        others = other if isinstance(other, list) else []
        for i, value in enumerate(ref):
            _walk(value, others[i] if i < len(others) else None, f"{path}[{i}]", out)
    elif isinstance(ref, bool) or ref is None or isinstance(ref, str):
        out.append((path, 0.0 if ref == other else math.inf))
    elif isinstance(ref, (int, float)):
        if not isinstance(other, (int, float)) or isinstance(other, bool):
            out.append((path, math.inf))
            return
        scale = max(abs(ref), abs(other), 1e-300)
        err = abs(ref - other) / scale if scale > 1e-12 else abs(ref - other)
        out.append((path, err))


def compare_engines(reference_file: str | Path, other_file: str | Path) -> EngineComparison:
    """Compare two golden-format JSON files value by value."""
    ref = json.loads(Path(reference_file).read_text(encoding="utf-8"))
    other = json.loads(Path(other_file).read_text(encoding="utf-8"))
    tol = float(ref.get("relative_tolerance", 1e-12))
    errors: list[tuple[str, float]] = []
    for section in ("corner_cases", "circuit_cases"):
        _walk(ref[section], other.get(section), section, errors)
    worst_path, worst = max(errors, key=lambda e: e[1]) if errors else ("", 0.0)
    return EngineComparison(
        values_compared=len(errors),
        max_relative_error=worst,
        worst_path=worst_path,
        mismatches=sum(1 for _, e in errors if e > tol),
        tolerance=tol,
    )
