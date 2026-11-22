"""Golden test cases shared by every implementation of the VDPM engine.

The Python package is the reference implementation. :func:`build_golden_cases`
evaluates a fixed, documented set of inputs and records every output at full
double precision. Any other implementation (the browser engine of the
dashboard) must reproduce every value within :data:`RELATIVE_TOLERANCE`.

JSON encoding: finite floats are written with full ``repr`` precision; the
special value "not limited by grip" (``inf``) is written as the string
``"Infinity"`` because JSON has no infinity literal.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict
from pathlib import Path
from typing import Any

from . import __version__
from .circuits import REFERENCE_SUMMARIES, synthetic_circuit
from .explain import margin_sensitivities
from .models import AeroSetup, Environment, Vehicle
from .physics import evaluate_corner
from .reference import ENVIRONMENT, SETUP_A, SETUP_B, VEHICLE
from .scoring import CircuitWeights, rank_setups

__all__ = ["RELATIVE_TOLERANCE", "build_golden_cases", "write_golden_cases"]

#: Agreement required between implementations (relative, or absolute near 0).
RELATIVE_TOLERANCE = 1e-12

#: Setups used in the golden grid: the manuscript's two plus edge cases.
GOLDEN_SETUPS = (
    SETUP_A,
    SETUP_B,
    AeroSetup("No downforce", 0.60, 0.0, description="edge case: C_DF = 0"),
    AeroSetup("Extreme downforce", 1.60, 5.20, description="edge case: very high C_DF"),
)
GOLDEN_SPEEDS = (10.0, 30.0, 55.0, 83.3333333333333, 100.0)
GOLDEN_RADII = (15.0, 60.0, 150.0, 240.0, 600.0)
GOLDEN_ENVIRONMENTS = (ENVIRONMENT, Environment(air_density=1.0, gravity=9.80665))
GOLDEN_VEHICLES = (VEHICLE, Vehicle(mass=798.0, reference_area=1.2, friction=1.8))


def _encode(value: Any) -> Any:
    if isinstance(value, float):
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        if math.isnan(value):
            raise ValueError("NaN must never appear in golden data")
        return value
    if isinstance(value, dict):
        return {k: _encode(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_encode(v) for v in value]
    return value


def _setup_dict(s: AeroSetup) -> dict[str, Any]:
    return {
        "name": s.name,
        "drag_coefficient": s.drag_coefficient,
        "downforce_coefficient": s.downforce_coefficient,
    }


def build_golden_cases() -> dict[str, Any]:
    """Evaluate the golden input grid and return a JSON-ready dictionary."""
    corner_cases = []
    for vehicle in GOLDEN_VEHICLES:
        for env in GOLDEN_ENVIRONMENTS:
            for setup in GOLDEN_SETUPS:
                for v in GOLDEN_SPEEDS:
                    for r in GOLDEN_RADII:
                        res = evaluate_corner(vehicle, setup, v, r, env)
                        out = asdict(res)
                        out.pop("setup")
                        corner_cases.append(
                            {
                                "input": {
                                    "vehicle": asdict(vehicle),
                                    "environment": asdict(env),
                                    "setup": _setup_dict(setup),
                                    "speed": v,
                                    "radius": r,
                                },
                                "output": out,
                                "sensitivities": margin_sensitivities(vehicle, setup, v, r, env),
                            }
                        )

    circuit_cases = []
    weight_options: list[tuple[str, CircuitWeights | None]] = [
        ("default", None),
        ("drag-heavy", CircuitWeights(0.7, 0.2, 0.1)),
        ("grip-heavy", CircuitWeights(0.1, 0.6, 0.3)),
    ]
    for a_ref in (15.0, 30.0):
        for key, summary in REFERENCE_SUMMARIES.items():
            circuit = synthetic_circuit(summary, a_ref)
            segments = [
                {
                    "kind": s.kind.value,
                    "length": s.length,
                    "speed": s.speed,
                    "radius": s.radius,
                    "name": s.name,
                }
                for s in circuit.segments
            ]
            for label, weights in weight_options:
                for normalisation in ("ratio", "minmax"):
                    for gate in ("strict", "none"):
                        ranking = rank_setups(
                            VEHICLE,
                            GOLDEN_SETUPS,
                            circuit,
                            weights,
                            ENVIRONMENT,
                            normalisation,
                            gate,
                        )
                        circuit_cases.append(
                            {
                                "input": {
                                    "circuit_key": key,
                                    "lateral_acceleration": a_ref,
                                    "weights": label,
                                    "normalisation": normalisation,
                                    "gate": gate,
                                },
                                "circuit": {
                                    "length": circuit.length,
                                    "straight_fraction": circuit.straight_fraction,
                                    "mean_corner_radius": circuit.mean_corner_radius,
                                    "segments": segments,
                                },
                                "weights": asdict(ranking.weights),
                                "entries": [
                                    {
                                        "setup": e.name,
                                        "eligible": e.eligible,
                                        "drag_exposure": e.evaluation.drag_exposure,
                                        "grip_capacity": e.evaluation.grip_capacity,
                                        "grip_ratio": e.evaluation.grip_ratio,
                                        "binding_corner": e.evaluation.binding_corner,
                                        "drag_penalty": e.drag_penalty,
                                        "grip_penalty": e.grip_penalty,
                                        "margin_penalty": e.margin_penalty,
                                        "score": e.score,
                                        "rank": e.rank,
                                    }
                                    for e in ranking.entries
                                ],
                            }
                        )

    encoded: dict[str, Any] = _encode(
        {
            "format": "vdpm-golden/1",
            "generator": f"vdpm {__version__} (Python reference implementation)",
            "relative_tolerance": RELATIVE_TOLERANCE,
            "setups": [_setup_dict(s) for s in GOLDEN_SETUPS],
            "corner_cases": corner_cases,
            "circuit_cases": circuit_cases,
        }
    )
    return encoded


def write_golden_cases(path: str | Path) -> int:
    """Write the golden cases to ``path``; returns the number of cases."""
    data = build_golden_cases()
    Path(path).write_text(json.dumps(data, indent=1, allow_nan=False) + "\n", encoding="utf-8")
    return len(data["corner_cases"]) + len(data["circuit_cases"])
