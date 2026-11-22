"""One-at-a-time sensitivity screening (manuscript Sec. 7).

Two complementary views:

* :func:`margin_tornado` scales each parameter by ``1 - delta`` and
  ``1 + delta`` at the case-study corner (v = 30 m/s, r = 60 m) and records the
  resulting safety margin of each setup.
* :func:`ranking_robustness` scans each parameter's multiplier over a range on
  each reference circuit and reports the smallest change that alters the
  recommended setup (or removes every eligible setup).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .. import reference
from ..circuits import REFERENCE_SUMMARIES
from ..models import Environment, Vehicle
from ..physics import evaluate_corner
from .scenario import PARAMETERS, Scenario

__all__ = ["RobustnessRow", "TornadoRow", "margin_tornado", "ranking_robustness"]

_CORNER_PARAMETERS = (
    "friction",
    "mass",
    "air_density",
    "reference_area",
    "downforce_coefficient",
    "drag_coefficient",
    "speed",
    "radius",
)


@dataclass(frozen=True, slots=True)
class TornadoRow:
    setup: str
    parameter: str
    delta: float
    margin_base: float
    margin_low: float
    margin_high: float

    @property
    def swing(self) -> float:
        return abs(self.margin_high - self.margin_low)


def _corner_margin(setup_index: int, parameter: str | None, factor: float) -> float:
    v, r = reference.CASE_SPEED, reference.CASE_RADIUS
    veh, env = reference.VEHICLE, reference.ENVIRONMENT
    setup = (reference.SETUP_A, reference.SETUP_B)[setup_index]
    if parameter in ("friction", "mass", "reference_area"):
        kwargs = {"mass": veh.mass, "reference_area": veh.reference_area, "friction": veh.friction}
        kwargs[parameter] *= factor
        veh = Vehicle(**kwargs)
    elif parameter == "air_density":
        env = Environment(env.air_density * factor, env.gravity)
    elif parameter == "drag_coefficient":
        setup = type(setup)(
            setup.name, setup.drag_coefficient * factor, setup.downforce_coefficient
        )
    elif parameter == "downforce_coefficient":
        setup = type(setup)(
            setup.name, setup.drag_coefficient, setup.downforce_coefficient * factor
        )
    elif parameter == "speed":
        v *= factor
    elif parameter == "radius":
        r *= factor
    return evaluate_corner(veh, setup, v, r, env).margin


def margin_tornado(delta: float = 0.10) -> list[TornadoRow]:
    """Margin at the case-study corner with each parameter scaled by ``1 +/- delta``."""
    rows = []
    for idx, setup in enumerate((reference.SETUP_A, reference.SETUP_B)):
        base = _corner_margin(idx, None, 1.0)
        for p in _CORNER_PARAMETERS:
            rows.append(
                TornadoRow(
                    setup.name,
                    p,
                    delta,
                    base,
                    _corner_margin(idx, p, 1.0 - delta),
                    _corner_margin(idx, p, 1.0 + delta),
                )
            )
    return rows


@dataclass(frozen=True, slots=True)
class RobustnessRow:
    circuit: str
    parameter: str
    baseline_best: str
    lower_change: float | None
    lower_outcome: str | None
    upper_change: float | None
    upper_outcome: str | None


def _best(scenario: Scenario) -> str:
    best = scenario.rank().best
    return best.name if best else "none eligible"


def ranking_robustness(
    parameters: Sequence[str] = tuple(PARAMETERS),
    span: float = 0.5,
    steps: int = 200,
) -> list[RobustnessRow]:
    """Smallest relative change of each parameter that changes the recommendation.

    Each parameter is scanned from multiplier 1 outwards to ``1 - span`` and
    ``1 + span`` in ``steps`` increments per side. ``None`` means no change
    within the scanned range.
    """
    rows = []
    for key in REFERENCE_SUMMARIES:
        base = Scenario(key)
        best0 = _best(base)
        for p in parameters:
            found: dict[int, tuple[float, str] | None] = {-1: None, 1: None}
            for sign in (-1, 1):
                for i in range(1, steps + 1):
                    change = sign * span * i / steps
                    outcome = _best(base.scaled(**{p: 1.0 + change}))
                    if outcome != best0:
                        found[sign] = (change, outcome)
                        break
            lo, hi = found[-1], found[1]
            rows.append(
                RobustnessRow(
                    REFERENCE_SUMMARIES[key].name,
                    p,
                    best0,
                    lo[0] if lo else None,
                    lo[1] if lo else None,
                    hi[0] if hi else None,
                    hi[1] if hi else None,
                )
            )
    return rows
