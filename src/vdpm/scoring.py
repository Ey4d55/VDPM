"""Circuit evaluation, the feasibility gate and the VDPM score (Sec. 4.6).

Definition used by this implementation
--------------------------------------
The manuscript leaves the normalisation, the weights and the treatment of
ineligible setups to be confirmed. Until the authors fix them, this module
implements the following explicit, documented default. Every choice is a
parameter, so an alternative definition can be selected without code changes.

For setup ``j`` on circuit ``c`` with segments ``i`` (length ``L_i``, speed
``v_i``, corners with radius ``r_i``):

* Drag exposure ``D_j = sum_i L_i F_D,j(v_i) / sum_i L_i`` (length-weighted
  mean drag over the lap), N.
* Grip capacity ``G_j = sum_corners L_i F_lat,max,j(v_i) / sum_corners L_i``
  (length-weighted mean available grip over the corners), N.
* Grip ratio ``R_j = min_corners F_lat,max,j / F_c`` = ``1 + M`` at the
  binding corner, dimensionless. ``R_j >= 1`` iff every corner is feasible.

Feasibility gate (strict, Sec. 4.6): a setup that violates at least one
corner (``R_j < 1``) is *ineligible* and receives no score or rank.

Normalisation (default ``"ratio"``, ratio to the best eligible value), giving
dimensionless penalties in [0, 1) that are 0 for the best setup on that term:

    d_j = 1 - min_k D_k / D_j
    q_j = 1 - G_j / max_k G_k
    z_j = 1 - R_j / max_k R_k

The alternative ``"minmax"`` maps each term linearly to [0, 1] across the
candidate set (0 best, 1 worst; 0 for all when the term is tied).

Score (lower is better), weights non-negative and summing to one:

    S_j = w_D d_j + w_G q_j + w_M z_j

Default circuit weights from the straight fraction ``s`` of the circuit:
``w_M = 0.2``, ``w_D = 0.8 s``, ``w_G = 0.8 (1 - s)``.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from .models import AeroSetup, Circuit, Environment, Vehicle
from .physics import CornerResult, drag, evaluate_corner

__all__ = [
    "CircuitEvaluation",
    "CircuitWeights",
    "Normalisation",
    "RankedSetup",
    "Ranking",
    "competition_ranks",
    "evaluate_circuit",
    "rank_setups",
]

Normalisation = Literal["ratio", "minmax"]
Gate = Literal["strict", "none"]

#: Default weight on the margin term when weights are derived from a circuit.
DEFAULT_MARGIN_WEIGHT = 0.2

_WEIGHT_TOL = 1e-9


@dataclass(frozen=True, slots=True)
class CircuitWeights:
    """Weights ``(w_D, w_G, w_M)`` of the VDPM score; non-negative, sum to 1."""

    drag: float
    grip: float
    margin: float

    def __post_init__(self) -> None:
        for name, w in (("drag", self.drag), ("grip", self.grip), ("margin", self.margin)):
            if not (math.isfinite(w) and w >= 0):
                raise ValueError(f"weight {name} must be finite and non-negative, got {w!r}")
        total = self.drag + self.grip + self.margin
        if abs(total - 1.0) > _WEIGHT_TOL:
            raise ValueError(f"weights must sum to 1, got {total!r}")

    @classmethod
    def from_straight_fraction(
        cls, straight_fraction: float, margin_weight: float = DEFAULT_MARGIN_WEIGHT
    ) -> CircuitWeights:
        """Default weights: ``w_M`` fixed, the rest split by straight fraction ``s``."""
        if not 0.0 <= straight_fraction <= 1.0:
            raise ValueError("straight_fraction must lie in [0, 1]")
        if not 0.0 <= margin_weight <= 1.0:
            raise ValueError("margin_weight must lie in [0, 1]")
        rest = 1.0 - margin_weight
        return cls(
            drag=rest * straight_fraction,
            grip=rest * (1.0 - straight_fraction),
            margin=margin_weight,
        )

    @classmethod
    def for_circuit(
        cls, circuit: Circuit, margin_weight: float = DEFAULT_MARGIN_WEIGHT
    ) -> CircuitWeights:
        """Default weights for a circuit (see module docstring)."""
        return cls.from_straight_fraction(circuit.straight_fraction, margin_weight)


@dataclass(frozen=True, slots=True)
class CircuitEvaluation:
    """Physics of one setup over every segment of one circuit."""

    setup: AeroSetup
    circuit: str
    corners: tuple[CornerResult, ...]
    drag_exposure: float
    grip_capacity: float
    grip_ratio: float
    binding_corner: int
    corner_names: tuple[str, ...] = ()

    def corner_label(self, index: int) -> str:
        """Name of corner ``index`` (e.g. ``"T3"``), or ``"corner <n>"`` if unnamed."""
        if index < len(self.corner_names) and self.corner_names[index]:
            return self.corner_names[index]
        return f"corner {index + 1}"

    @property
    def feasible(self) -> bool:
        """True iff every corner satisfies ``F_c <= F_lat,max`` (Sec. 4.5)."""
        return all(c.feasible for c in self.corners)

    @property
    def min_margin(self) -> float:
        """Margin ``M`` at the binding corner, ``R - 1``."""
        return self.grip_ratio - 1.0

    @property
    def failed_corners(self) -> tuple[int, ...]:
        """Indices (into :attr:`corners`) of corners that are infeasible."""
        return tuple(i for i, c in enumerate(self.corners) if not c.feasible)


def evaluate_circuit(
    vehicle: Vehicle,
    setup: AeroSetup,
    circuit: Circuit,
    environment: Environment | None = None,
) -> CircuitEvaluation:
    """Evaluate one setup on every segment of a circuit."""
    env = environment or Environment()
    corners = tuple(
        evaluate_corner(vehicle, setup, seg.speed, seg.radius, env)  # type: ignore[arg-type]
        for seg in circuit.corners
    )
    total_length = circuit.length
    drag_exposure = (
        math.fsum(
            seg.length
            * drag(env.air_density, seg.speed, setup.drag_coefficient, vehicle.reference_area)
            for seg in circuit.segments
        )
        / total_length
    )
    corner_lengths = [seg.length for seg in circuit.corners]
    grip_capacity = math.fsum(
        length * res.available_grip for length, res in zip(corner_lengths, corners, strict=True)
    ) / math.fsum(corner_lengths)
    ratios = [res.available_grip / res.required_force for res in corners]
    binding = min(range(len(ratios)), key=ratios.__getitem__)
    return CircuitEvaluation(
        setup=setup,
        circuit=circuit.name,
        corners=corners,
        drag_exposure=drag_exposure,
        grip_capacity=grip_capacity,
        grip_ratio=ratios[binding],
        binding_corner=binding,
        corner_names=tuple(seg.name for seg in circuit.corners),
    )


@dataclass(frozen=True, slots=True)
class RankedSetup:
    """Score and rank of one setup. ``score``/``rank`` are ``None`` if ineligible."""

    evaluation: CircuitEvaluation
    eligible: bool
    drag_penalty: float | None
    grip_penalty: float | None
    margin_penalty: float | None
    score: float | None
    rank: int | None

    @property
    def name(self) -> str:
        return self.evaluation.setup.name

    def contributions(self, weights: CircuitWeights) -> dict[str, float] | None:
        """Weighted terms ``w_D d``, ``w_G q``, ``w_M z`` that sum to the score."""
        if self.score is None:
            return None
        assert self.drag_penalty is not None
        assert self.grip_penalty is not None
        assert self.margin_penalty is not None
        return {
            "drag": weights.drag * self.drag_penalty,
            "grip": weights.grip * self.grip_penalty,
            "margin": weights.margin * self.margin_penalty,
        }


@dataclass(frozen=True, slots=True)
class Ranking:
    """Result of ranking a set of setups on one circuit."""

    circuit: str
    weights: CircuitWeights
    normalisation: Normalisation
    gate: Gate
    entries: tuple[RankedSetup, ...]

    @property
    def eligible(self) -> tuple[RankedSetup, ...]:
        return tuple(e for e in self.entries if e.eligible)

    @property
    def ordered(self) -> tuple[RankedSetup, ...]:
        """Eligible setups best first, then ineligible ones in input order."""
        ranked = sorted(self.eligible, key=lambda e: (e.rank, e.name))
        return tuple(ranked) + tuple(e for e in self.entries if not e.eligible)

    @property
    def best(self) -> RankedSetup | None:
        """The top-ranked eligible setup, or ``None`` if none is eligible."""
        ordered = self.ordered
        return ordered[0] if ordered and ordered[0].eligible else None


def _penalties(values: Sequence[float], lower_is_better: bool, mode: Normalisation) -> list[float]:
    if mode == "ratio":
        if any(v <= 0 for v in values):
            raise ValueError("ratio normalisation requires strictly positive values")
        if lower_is_better:
            best = min(values)
            return [1.0 - best / v for v in values]
        best = max(values)
        return [1.0 - v / best for v in values]
    if mode == "minmax":
        lo, hi = min(values), max(values)
        span = hi - lo
        if span <= 0:
            return [0.0 for _ in values]
        if lower_is_better:
            return [(v - lo) / span for v in values]
        return [(hi - v) / span for v in values]
    raise ValueError(f"unknown normalisation {mode!r}")


def competition_ranks(scores: Sequence[float], tol: float = 1e-12) -> list[int]:
    """Standard competition ranking ("1224"); scores within ``tol`` tie."""
    order = sorted(range(len(scores)), key=scores.__getitem__)
    ranks = [0] * len(scores)
    for position, idx in enumerate(order):
        if position > 0 and abs(scores[idx] - scores[order[position - 1]]) <= tol:
            ranks[idx] = ranks[order[position - 1]]
        else:
            ranks[idx] = position + 1
    return ranks


def rank_setups(
    vehicle: Vehicle,
    setups: Sequence[AeroSetup],
    circuit: Circuit,
    weights: CircuitWeights | None = None,
    environment: Environment | None = None,
    normalisation: Normalisation = "ratio",
    gate: Gate = "strict",
) -> Ranking:
    """Feasibility-gated VDPM ranking of setups on a circuit (Sec. 4.6).

    Args:
        vehicle: Vehicle properties shared by all setups.
        setups: Candidate setups; names must be unique.
        circuit: Circuit to evaluate on.
        weights: Score weights; defaults to :meth:`CircuitWeights.for_circuit`.
        environment: Air density and gravity.
        normalisation: ``"ratio"`` (default) or ``"minmax"``.
        gate: ``"strict"`` excludes setups failing any corner; ``"none"``
            scores every setup (the ungated baseline of Sec. 7).
    """
    if not setups:
        raise ValueError("at least one setup is required")
    names = [s.name for s in setups]
    if len(set(names)) != len(names):
        raise ValueError("setup names must be unique")
    w = weights or CircuitWeights.for_circuit(circuit)
    evaluations = [evaluate_circuit(vehicle, s, circuit, environment) for s in setups]

    if gate == "strict":
        eligible_mask = [e.feasible for e in evaluations]
    elif gate == "none":
        eligible_mask = [True] * len(evaluations)
    else:
        raise ValueError(f"unknown gate {gate!r}")

    pool = [e for e, ok in zip(evaluations, eligible_mask, strict=True) if ok]
    scored: dict[int, tuple[float, float, float, float]] = {}
    if pool:
        d = _penalties([e.drag_exposure for e in pool], True, normalisation)
        q = _penalties([e.grip_capacity for e in pool], False, normalisation)
        z = _penalties([e.grip_ratio for e in pool], False, normalisation)
        scores = [w.drag * a + w.grip * b + w.margin * c for a, b, c in zip(d, q, z, strict=True)]
        pool_ids = [i for i, ok in enumerate(eligible_mask) if ok]
        for j, idx in enumerate(pool_ids):
            scored[idx] = (d[j], q[j], z[j], scores[j])
        ranks = dict(zip(pool_ids, competition_ranks(scores), strict=True))
    else:
        ranks = {}

    entries = []
    for i, ev in enumerate(evaluations):
        if i in scored:
            dp, qp, zp, sc = scored[i]
            entries.append(RankedSetup(ev, True, dp, qp, zp, sc, ranks[i]))
        else:
            entries.append(RankedSetup(ev, False, None, None, None, None, None))
    return Ranking(circuit.name, w, normalisation, gate, tuple(entries))
