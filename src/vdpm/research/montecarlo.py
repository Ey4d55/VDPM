"""Joint uncertainty analysis and the baseline comparison (Sec. 7, H1).

Monte Carlo ranking stability
-----------------------------
Each sample draws independent multiplicative perturbations, uniform on
``[1 - u, 1 + u]``, for the shared parameters and, separately for every setup,
for its ``C_D`` and ``C_DF`` (CFD uncertainty is not shared between setups).
The default half-widths in :data:`DEFAULT_UNCERTAINTY` are illustrative
assumptions to be replaced by measured uncertainties; they are recorded in
every output so results are never separated from the assumptions behind them.

Proportions are reported with 95 % Wilson score intervals.

Baseline comparison (H1)
------------------------
H1 states that the feasibility constraint reduces physically implausible
rankings. VDPM cannot recommend an infeasible setup by construction, so the
measurable quantity is how often the *unconstrained* alternatives would:
for every sample, does the top choice of drag-only, downforce-only,
efficiency-only or the ungated score fail at least one corner? Such a failure
is *avoidable* when at least one candidate setup was feasible (the gated
ranking then recommends it) and *unavoidable* when none was (the gated
ranking then makes no recommendation).
"""

from __future__ import annotations

import math
import random
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from ..baselines import BASELINES
from ..circuits import REFERENCE_SUMMARIES
from .scenario import Scenario

__all__ = [
    "DEFAULT_UNCERTAINTY",
    "DemandSweepRow",
    "MonteCarloResult",
    "Proportion",
    "demand_sweep",
    "run_monte_carlo",
    "wilson_interval",
]

#: Half-widths of uniform multiplicative uncertainty (illustrative defaults).
DEFAULT_UNCERTAINTY: dict[str, float] = {
    "friction": 0.10,
    "mass": 0.02,
    "air_density": 0.05,
    "reference_area": 0.02,
    "drag_coefficient": 0.05,
    "downforce_coefficient": 0.05,
    "lateral_acceleration": 0.10,
}

_SHARED = ("friction", "mass", "air_density", "reference_area", "lateral_acceleration")


def wilson_interval(successes: int, n: int, z: float = 1.959963984540054) -> tuple[float, float]:
    """95 % Wilson score interval for a binomial proportion."""
    if n == 0:
        return (0.0, 1.0)
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    lo = 0.0 if successes == 0 else max(0.0, centre - half)
    hi = 1.0 if successes == n else min(1.0, centre + half)
    return (lo, hi)


@dataclass(frozen=True, slots=True)
class Proportion:
    label: str
    successes: int
    n: int

    @property
    def value(self) -> float:
        return self.successes / self.n if self.n else math.nan

    @property
    def interval(self) -> tuple[float, float]:
        return wilson_interval(self.successes, self.n)


@dataclass(frozen=True, slots=True)
class MonteCarloResult:
    circuit: str
    samples: int
    seed: int
    uncertainty: Mapping[str, float]
    baseline_best: str
    best_counts: Proportion
    winners: tuple[Proportion, ...]
    feasible: tuple[Proportion, ...]
    baseline_infeasible: tuple[Proportion, ...]
    baseline_avoidable: tuple[Proportion, ...] = ()
    demand_range: tuple[float, float] | None = None


def _sample_scenario(
    base: Scenario,
    rng: random.Random,
    u: Mapping[str, float],
    demand_range: tuple[float, float] | None = None,
) -> Scenario:
    shared = {p: 1.0 + rng.uniform(-u[p], u[p]) for p in _SHARED if u.get(p, 0) > 0}
    if demand_range is not None:
        shared["lateral_acceleration"] = rng.uniform(*demand_range) / base.lateral_acceleration
    own = {
        s.name: (
            1.0 + rng.uniform(-u["drag_coefficient"], u["drag_coefficient"]),
            1.0 + rng.uniform(-u["downforce_coefficient"], u["downforce_coefficient"]),
        )
        for s in base.setups
    }
    scenario = base.scaled(**shared)
    return Scenario(
        scenario.circuit_key,
        scenario.setups,
        scenario.vehicle,
        scenario.environment,
        scenario.lateral_acceleration,
        scenario.multipliers,
        own,
    )


def _top_choice_infeasible(scenario: Scenario) -> dict[str, bool]:
    """For each unconstrained method, does its top choice fail the gate?"""
    ungated = scenario.rank(gate="none")
    feasible = {e.name: e.evaluation.feasible for e in ungated.entries}
    out = {"ungated": not feasible[ungated.best.name]} if ungated.best else {}
    evals = [e.evaluation for e in ungated.entries]
    for method, key in BASELINES.items():
        top = min(evals, key=lambda ev, k=key: (k(ev), ev.setup.name))  # type: ignore[misc]
        out[method] = not top.feasible
    return out


def run_monte_carlo(
    circuit_key: str,
    samples: int = 5000,
    seed: int = 20261122,
    uncertainty: Mapping[str, float] | None = None,
    base: Scenario | None = None,
    demand_range: tuple[float, float] | None = None,
) -> MonteCarloResult:
    """Seeded Monte Carlo analysis on one reference circuit.

    With ``demand_range = (lo, hi)`` the corner demand ``a_ref`` is drawn
    uniformly from that range instead of perturbed around the reference value;
    this explores a wide space of operating conditions for the H1 comparison.
    """
    u = dict(DEFAULT_UNCERTAINTY if uncertainty is None else uncertainty)
    base = base or Scenario(circuit_key)
    rng = random.Random(f"{seed}-{circuit_key}-{demand_range}")
    names = [s.name for s in base.setups]
    best0 = base.rank().best
    best0_name = best0.name if best0 else "none eligible"

    winners: Counter[str] = Counter()
    feasible: Counter[str] = Counter()
    infeasible_pick: Counter[str] = Counter()
    avoidable: Counter[str] = Counter()
    for _ in range(samples):
        sc = _sample_scenario(base, rng, u, demand_range)
        ranking = sc.rank()
        best = ranking.best
        winners[best.name if best else "none eligible"] += 1
        for e in ranking.entries:
            feasible[e.name] += e.evaluation.feasible
        for method, bad in _top_choice_infeasible(sc).items():
            infeasible_pick[method] += bad
            avoidable[method] += bad and best is not None

    labels = [*names, "none eligible"]
    return MonteCarloResult(
        circuit=REFERENCE_SUMMARIES[circuit_key].name,
        samples=samples,
        seed=seed,
        uncertainty=u,
        baseline_best=best0_name,
        best_counts=Proportion(best0_name, winners[best0_name], samples),
        winners=tuple(Proportion(lbl, winners[lbl], samples) for lbl in labels),
        feasible=tuple(Proportion(n, feasible[n], samples) for n in names),
        baseline_infeasible=tuple(
            Proportion(m, infeasible_pick[m], samples) for m in ["ungated", *BASELINES]
        ),
        baseline_avoidable=tuple(
            Proportion(m, avoidable[m], samples) for m in ["ungated", *BASELINES]
        ),
        demand_range=demand_range,
    )


@dataclass(frozen=True, slots=True)
class DemandSweepRow:
    circuit: str
    lateral_acceleration: float
    feasible: Mapping[str, bool]
    min_margin: Mapping[str, float]
    vdpm_best: str
    baseline_top_infeasible: Mapping[str, bool]


def demand_sweep(
    accelerations: Sequence[float] | None = None,
) -> list[DemandSweepRow]:
    """Deterministic sweep of the corner demand ``a_ref`` on every reference circuit.

    Shows where each setup stops being feasible and where the unconstrained
    methods would recommend an infeasible setup.
    """
    grid = accelerations or [10.0 + 0.25 * i for i in range(81)]  # 10 .. 30 m/s^2
    rows = []
    for key in REFERENCE_SUMMARIES:
        for a in grid:
            sc = Scenario(key, lateral_acceleration=a)
            ranking = sc.rank()
            best = ranking.best
            rows.append(
                DemandSweepRow(
                    circuit=REFERENCE_SUMMARIES[key].name,
                    lateral_acceleration=a,
                    feasible={e.name: e.evaluation.feasible for e in ranking.entries},
                    min_margin={e.name: e.evaluation.min_margin for e in ranking.entries},
                    vdpm_best=best.name if best else "none eligible",
                    baseline_top_infeasible=_top_choice_infeasible(sc),
                )
            )
    return rows
