"""Baseline rankings the VDPM ranking is compared against (Sec. 7).

* **drag-only**: lower lap-averaged drag ranks higher.
* **downforce-only**: higher downforce coefficient ranks higher.
* **efficiency-only**: higher ``C_DF / C_D`` ranks higher.
* **ungated**: the same weighted VDPM score without the feasibility gate.

Baselines ignore feasibility by construction; that is the point of comparing
them with the gated VDPM ranking (hypothesis H1).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from .models import AeroSetup, Circuit, Environment, Vehicle
from .scoring import (
    CircuitEvaluation,
    CircuitWeights,
    Normalisation,
    competition_ranks,
    evaluate_circuit,
    rank_setups,
)

__all__ = ["BASELINES", "BaselineRanking", "compare_with_baselines", "rank_baseline"]


@dataclass(frozen=True, slots=True)
class BaselineRanking:
    """Ranks by setup name for one method. ``None`` marks an excluded setup."""

    method: str
    ranks: dict[str, int | None]

    @property
    def best(self) -> str | None:
        ranked = [(r, n) for n, r in self.ranks.items() if r is not None]
        return min(ranked)[1] if ranked else None

    def selects_infeasible(self, feasible: dict[str, bool]) -> bool:
        """True if this method's top choice fails the feasibility gate."""
        best = self.best
        return best is not None and not feasible[best]


def _by_key(
    evals: Sequence[CircuitEvaluation], key: Callable[[CircuitEvaluation], float]
) -> list[int]:
    return competition_ranks([key(e) for e in evals])


BASELINES: dict[str, Callable[[CircuitEvaluation], float]] = {
    "drag-only": lambda e: e.drag_exposure,
    "downforce-only": lambda e: -e.setup.downforce_coefficient,
    "efficiency-only": lambda e: -e.setup.efficiency,
}


def rank_baseline(
    method: str,
    vehicle: Vehicle,
    setups: Sequence[AeroSetup],
    circuit: Circuit,
    environment: Environment | None = None,
) -> BaselineRanking:
    """Rank setups by one of :data:`BASELINES`."""
    if method not in BASELINES:
        raise ValueError(f"unknown baseline {method!r}; choose from {sorted(BASELINES)}")
    evals = [evaluate_circuit(vehicle, s, circuit, environment) for s in setups]
    ranks = _by_key(evals, BASELINES[method])
    return BaselineRanking(method, {e.setup.name: r for e, r in zip(evals, ranks, strict=True)})


def compare_with_baselines(
    vehicle: Vehicle,
    setups: Sequence[AeroSetup],
    circuit: Circuit,
    weights: CircuitWeights | None = None,
    environment: Environment | None = None,
    normalisation: Normalisation = "ratio",
) -> dict[str, BaselineRanking]:
    """VDPM (gated), ungated VDPM and every baseline on the same inputs."""
    out: dict[str, BaselineRanking] = {}
    for gate, label in (("strict", "vdpm"), ("none", "ungated")):
        ranking = rank_setups(
            vehicle,
            setups,
            circuit,
            weights,
            environment,
            normalisation,
            gate,  # type: ignore[arg-type]
        )
        out[label] = BaselineRanking(label, {e.name: e.rank for e in ranking.entries})
    for method in BASELINES:
        out[method] = rank_baseline(method, vehicle, setups, circuit, environment)
    return out
