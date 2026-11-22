"""Physics-derived explanations of feasibility and ranking.

Nothing here is a learned model. Every statement is computed in closed form
from the equations in :mod:`vdpm.physics` and the score in
:mod:`vdpm.scoring`, so each explanation is exact and reproducible:

* :func:`margin_sensitivities` gives the analytic change in the safety margin
  ``M`` per relative change of each input (elasticity form).
* :func:`weight_flip_point` gives the straight fraction at which two eligible
  setups swap places under the default weight family.
* :func:`explain_ranking` turns a :class:`~vdpm.scoring.Ranking` into
  structured findings with plain-language text.

Derivation of the sensitivities
-------------------------------
With ``k = rho C_DF A / 2``, the grip ratio at a corner is

    R = 1 + M = mu r (g / v^2 + k / m).

Writing ``a = g / v^2`` and ``b = k / m``, the logarithmic derivatives are

    dlnR/dln(mu) = dlnR/dln(r) = 1
    dlnR/dln(v)  = -2a / (a + b)
    dlnR/dln(m)  = -b / (a + b)
    dlnR/dln(rho) = dlnR/dln(C_DF) = dlnR/dln(A) = b / (a + b)
    dlnR/dln(g)  =  a / (a + b)
    dlnR/dln(C_D) = 0

and ``dM/dln(x) = R * dlnR/dln(x)``: the absolute change in ``M`` for a
small relative change in ``x`` (multiply by 0.01 for a 1 % change).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .models import AeroSetup, Environment, Vehicle
from .physics import downforce_factor
from .scoring import RankedSetup, Ranking

__all__ = [
    "SENSITIVITY_PARAMETERS",
    "Finding",
    "explain_ranking",
    "margin_sensitivities",
    "weight_flip_point",
]

#: Inputs for which :func:`margin_sensitivities` reports a derivative.
SENSITIVITY_PARAMETERS = (
    "friction",
    "radius",
    "speed",
    "mass",
    "air_density",
    "downforce_coefficient",
    "reference_area",
    "gravity",
    "drag_coefficient",
)


def margin_sensitivities(
    vehicle: Vehicle,
    setup: AeroSetup,
    speed: float,
    radius: float,
    environment: Environment | None = None,
) -> dict[str, float]:
    """Analytic ``dM/dln(x)`` for every input ``x`` at one cornering state."""
    env = environment or Environment()
    k = downforce_factor(env.air_density, setup.downforce_coefficient, vehicle.reference_area)
    a = env.gravity / (speed * speed)
    b = k / vehicle.mass
    ratio = vehicle.friction * radius * (a + b)
    aero_share = b / (a + b)
    mech_share = a / (a + b)
    log_derivs = {
        "friction": 1.0,
        "radius": 1.0,
        "speed": -2.0 * mech_share,
        "mass": -aero_share,
        "air_density": aero_share,
        "downforce_coefficient": aero_share,
        "reference_area": aero_share,
        "gravity": mech_share,
        "drag_coefficient": 0.0,
    }
    return {name: ratio * d for name, d in log_derivs.items()}


def weight_flip_point(
    first: RankedSetup, second: RankedSetup, margin_weight: float
) -> float | None:
    """Drag share ``s* = w_D / (w_D + w_G)`` at which two eligible setups tie.

    Any weights with ``w_M`` fixed can be written ``w_D = (1 - w_M) s`` and
    ``w_G = (1 - w_M)(1 - s)``; for the default weights ``s`` is the
    circuit's straight fraction. Penalties are those already normalised in
    the ranking. Returns ``None`` if the scores never cross for ``s`` in [0, 1].
    """
    if not (first.eligible and second.eligible):
        raise ValueError("both setups must be eligible")
    assert first.drag_penalty is not None and second.drag_penalty is not None
    assert first.grip_penalty is not None and second.grip_penalty is not None
    assert first.margin_penalty is not None and second.margin_penalty is not None
    dd = first.drag_penalty - second.drag_penalty
    dq = first.grip_penalty - second.grip_penalty
    dz = first.margin_penalty - second.margin_penalty
    rest = 1.0 - margin_weight
    # Delta S(s) = rest * (s dd + (1 - s) dq) + w_M dz = rest * s (dd - dq) + rest dq + w_M dz
    slope = rest * (dd - dq)
    intercept = rest * dq + margin_weight * dz
    if abs(slope) < 1e-15:
        return None
    s_star = -intercept / slope
    return s_star if 0.0 <= s_star <= 1.0 else None


@dataclass(frozen=True, slots=True)
class Finding:
    """One explanation statement with the numbers behind it."""

    kind: str
    setup: str | None
    text: str
    data: dict[str, float | str | None]


def _fmt_kn(newtons: float) -> str:
    return f"{newtons / 1000:.2f} kN"


def _fmt_limit(value: float, unit: str, digits: int = 2) -> str:
    return "no limit" if math.isinf(value) else f"{value:.{digits}f} {unit}".strip()


def explain_ranking(ranking: Ranking) -> list[Finding]:
    """Structured, plain-language explanation of a ranking."""
    findings: list[Finding] = []
    w = ranking.weights

    for entry in ranking.entries:
        ev = entry.evaluation
        corner = ev.corners[ev.binding_corner]
        label = (
            f"{ev.corner_label(ev.binding_corner)} "
            f"(r = {corner.radius:.0f} m, v = {corner.speed:.1f} m/s)"
        )
        if not entry.eligible and ranking.gate == "strict":
            findings.append(
                Finding(
                    "excluded",
                    entry.name,
                    f"{entry.name} is excluded: at {label} it needs "
                    f"{_fmt_kn(corner.required_force)} of lateral force but has only "
                    f"{_fmt_kn(corner.available_grip)} of grip "
                    f"(margin {corner.margin * 100:.1f}%). {len(ev.failed_corners)} of "
                    f"{len(ev.corners)} corners fail.",
                    {
                        "binding_corner": ev.binding_corner,
                        "margin": corner.margin,
                        "failed_corners": len(ev.failed_corners),
                    },
                )
            )
        else:
            limits = (
                f"it stays feasible for friction >= {corner.min_friction:.3f}, "
                f"mass <= {_fmt_limit(corner.max_mass, 'kg', 0)}, "
                f"C_DF >= {corner.min_downforce_coefficient:.3f}"
            )
            findings.append(
                Finding(
                    "binding-corner",
                    entry.name,
                    f"{entry.name}: the tightest point is {label} with margin "
                    f"{corner.margin * 100:.1f}%; {limits}.",
                    {
                        "binding_corner": ev.binding_corner,
                        "margin": corner.margin,
                        "min_friction": corner.min_friction,
                        "max_mass": corner.max_mass,
                        "min_downforce_coefficient": corner.min_downforce_coefficient,
                    },
                )
            )
        not_limited = sum(1 for c in ev.corners if not c.grip_limited)
        if not_limited:
            findings.append(
                Finding(
                    "not-grip-limited",
                    entry.name,
                    f"{entry.name}: {not_limited} of {len(ev.corners)} corners lie beyond the "
                    f"critical radius r* = {ev.corners[0].critical_radius:.0f} m, where the "
                    "simplified model sets no grip-limited speed; those corners cannot fail "
                    "the gate.",
                    {"count": not_limited, "critical_radius": ev.corners[0].critical_radius},
                )
            )

    ordered = [e for e in ranking.ordered if e.eligible]
    non_margin = w.drag + w.grip
    current_share = w.drag / non_margin if non_margin > 0 else None
    if not ordered:
        findings.append(
            Finding(
                "no-eligible", None, "No setup satisfies every corner, so none is recommended.", {}
            )
        )
        return findings

    best = ordered[0]
    parts = best.contributions(w)
    assert parts is not None and best.score is not None
    findings.append(
        Finding(
            "recommendation",
            best.name,
            f"{best.name} ranks first with VDPM score {best.score:.4f} "
            f"(drag {parts['drag']:.4f} + grip {parts['grip']:.4f} + margin {parts['margin']:.4f}; "
            f"weights {w.drag:.2f} / {w.grip:.2f} / {w.margin:.2f}).",
            {"score": best.score, **parts},
        )
    )
    for runner in ordered[1:]:
        assert runner.score is not None
        s_star = weight_flip_point(best, runner, w.margin)
        if s_star is None:
            text = (
                f"{runner.name} scores {runner.score:.4f} and stays behind {best.name} for every "
                "split of weight between drag and grip."
            )
        else:
            text = (
                f"{runner.name} scores {runner.score:.4f}; it would overtake {best.name} if "
                f"the drag share of weight, w_D / (w_D + w_G), crossed {s_star:.3f}"
                + (f" (currently {current_share:.3f})." if current_share is not None else ".")
            )
        findings.append(
            Finding(
                "runner-up",
                runner.name,
                text,
                {"score": runner.score, "flip_straight_fraction": s_star},
            )
        )
    return findings
