"""Governing equations of the VDPM framework (manuscript Section 4).

Every function here is a direct, documented transcription of one relation in
the manuscript, or a closed-form consequence of those relations. Functions take
plain floats in SI units so that the browser engine can mirror them one to one;
:func:`evaluate_corner` bundles them for a vehicle, setup and operating state.

Model scope (stated in the manuscript and repeated here on purpose):
planar constant-radius cornering, constant effective friction, no load
transfer, banking, grade, transients, tyre load sensitivity or aero balance.
Results are only as valid as that simplified model.

Closed-form results derived from Sec. 4.3 to 4.5
------------------------------------------------
Write ``k = rho * C_DF * A / 2`` so that ``F_DF = k v^2``. Feasibility
``m v^2 / r <= mu (m g + k v^2)`` rearranges to

    v^2 (m / r - mu k) <= mu m g.

* If ``m / r > mu k`` the maximum grip-limited cornering speed is
  ``v_max = sqrt(mu m g / (m / r - mu k))``.
* If ``m / r <= mu k`` the inequality holds at every speed: downforce grows
  as fast as the cornering demand, so the simplified model sets no
  grip-limited speed. This happens for ``r >= r* = m / (mu k)``, the
  *critical radius*. Beyond it the speed is bounded by power and drag, which
  the manuscript's model does not represent.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .models import AeroSetup, Environment, Vehicle

__all__ = [
    "CornerResult",
    "available_lateral_grip",
    "critical_radius",
    "downforce",
    "downforce_factor",
    "drag",
    "dynamic_pressure",
    "evaluate_corner",
    "lateral_force_reserve",
    "max_cornering_speed",
    "max_lateral_acceleration",
    "max_mass",
    "min_corner_radius",
    "min_downforce_coefficient",
    "min_friction",
    "required_lateral_force",
    "safety_margin",
]


# --------------------------------------------------------------------------- #
# Section 4.1 and 4.2: aerodynamic forces
# --------------------------------------------------------------------------- #


def dynamic_pressure(air_density: float, speed: float) -> float:
    """Dynamic pressure ``q = rho v^2 / 2``, Pa."""
    return 0.5 * air_density * speed * speed


def drag(air_density: float, speed: float, drag_coefficient: float, area: float) -> float:
    """Aerodynamic drag, Eq. 4.1: ``F_D = rho v^2 C_D A / 2``, N."""
    return dynamic_pressure(air_density, speed) * drag_coefficient * area


def downforce(air_density: float, speed: float, downforce_coefficient: float, area: float) -> float:
    """Aerodynamic downforce, Eq. 4.2: ``F_DF = rho v^2 C_DF A / 2``, N."""
    return dynamic_pressure(air_density, speed) * downforce_coefficient * area


def downforce_factor(air_density: float, downforce_coefficient: float, area: float) -> float:
    """``k = rho C_DF A / 2`` such that ``F_DF = k v^2``, kg/m."""
    return 0.5 * air_density * downforce_coefficient * area


# --------------------------------------------------------------------------- #
# Section 4.3 to 4.5: cornering demand, grip and reserve
# --------------------------------------------------------------------------- #


def required_lateral_force(mass: float, speed: float, radius: float) -> float:
    """Required centripetal force, Eq. 4.3: ``F_c = m v^2 / r``, N."""
    return mass * speed * speed / radius


def available_lateral_grip(
    friction: float, mass: float, gravity: float, downforce_n: float
) -> float:
    """Simplified available lateral grip, Eq. 4.4: ``mu (m g + F_DF)``, N."""
    return friction * (mass * gravity + downforce_n)


def lateral_force_reserve(available_n: float, required_n: float) -> float:
    """Absolute reserve ``Delta F = F_lat,max - F_c`` (Fig. 7e), N."""
    return available_n - required_n


def safety_margin(available_n: float, required_n: float) -> float:
    """Normalised reserve, Eq. 4.5: ``M = (F_lat,max - F_c) / F_c``.

    ``M >= 0`` means the corner is feasible under the simplified model.
    """
    if required_n <= 0:
        raise ValueError("required lateral force must be positive")
    return (available_n - required_n) / required_n


def max_lateral_acceleration(
    friction: float, gravity: float, downforce_n: float, mass: float
) -> float:
    """``a_lat,max = mu (g + F_DF / m)`` (Sec. 7, Fig. 7b), m/s^2."""
    return friction * (gravity + downforce_n / mass)


# --------------------------------------------------------------------------- #
# Closed-form consequences (see module docstring)
# --------------------------------------------------------------------------- #


def critical_radius(mass: float, friction: float, k: float) -> float:
    """Critical radius ``r* = m / (mu k)``, m.

    For ``r >= r*`` the simplified model has no grip-limited cornering speed.
    Returns ``inf`` for a setup without downforce, including a downforce so
    small that ``mu k`` underflows to zero.
    """
    muk = friction * k
    if muk <= 0:
        return math.inf
    return mass / muk


def max_cornering_speed(
    mass: float, radius: float, friction: float, gravity: float, k: float
) -> float:
    """Maximum grip-limited cornering speed, m/s.

    Solves ``m v^2 / r = mu (m g + k v^2)`` for ``v``. Returns ``inf`` when
    ``r >= r*`` (no grip-limited speed exists in the simplified model).
    """
    denom = mass / radius - friction * k
    if denom <= 0:
        return math.inf
    return math.sqrt(friction * mass * gravity / denom)


def min_corner_radius(
    mass: float, speed: float, friction: float, gravity: float, downforce_n: float
) -> float:
    """Smallest feasible radius at a given speed: ``m v^2 / (mu (m g + F_DF))``, m."""
    return mass * speed * speed / available_lateral_grip(friction, mass, gravity, downforce_n)


def min_friction(mass: float, gravity: float, downforce_n: float, required_n: float) -> float:
    """Smallest friction coefficient that keeps the corner feasible.

    ``mu_min = F_c / (m g + F_DF)``.
    """
    return required_n / (mass * gravity + downforce_n)


def min_downforce_coefficient(
    mass: float,
    speed: float,
    radius: float,
    friction: float,
    gravity: float,
    air_density: float,
    area: float,
) -> float:
    """Smallest ``C_DF`` that keeps the corner feasible (clipped at 0).

    From ``mu (m g + q C_DF A) >= m v^2 / r``.
    """
    required = required_lateral_force(mass, speed, radius)
    needed_downforce = required / friction - mass * gravity
    return max(0.0, needed_downforce / (dynamic_pressure(air_density, speed) * area))


def max_mass(
    speed: float, radius: float, friction: float, gravity: float, downforce_n: float
) -> float:
    """Largest vehicle mass that keeps the corner feasible, kg.

    ``m (v^2 / r - mu g) <= mu F_DF``. Returns ``inf`` when ``v^2 / r <= mu g``
    (mechanical grip alone suffices at any mass).
    """
    excess = speed * speed / radius - friction * gravity
    if excess <= 0:
        return math.inf
    return friction * downforce_n / excess


# --------------------------------------------------------------------------- #
# Bundled evaluation
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class CornerResult:
    """Complete evaluation of one setup at one cornering state.

    All forces in N, speeds in m/s, radii in m, accelerations in m/s^2.
    Infinite values mean "not limited by grip in the simplified model".
    """

    setup: str
    speed: float
    radius: float
    drag: float
    downforce: float
    required_force: float
    available_grip: float
    reserve_force: float
    margin: float
    feasible: bool
    max_lateral_acceleration: float
    required_lateral_acceleration: float
    max_cornering_speed: float
    critical_radius: float
    grip_limited: bool
    min_radius: float
    min_friction: float
    min_downforce_coefficient: float
    max_mass: float


def evaluate_corner(
    vehicle: Vehicle,
    setup: AeroSetup,
    speed: float,
    radius: float,
    environment: Environment | None = None,
) -> CornerResult:
    """Evaluate one setup at one cornering state (Sec. 4.1 to 4.5).

    Args:
        vehicle: Mass, reference area and effective friction.
        setup: Aerodynamic coefficients.
        speed: Operating speed ``v``, m/s.
        radius: Corner radius ``r``, m.
        environment: Air density and gravity; defaults to Table 1 values.
    """
    env = environment or Environment()
    if not (math.isfinite(speed) and speed > 0):
        raise ValueError(f"speed must be finite and positive, got {speed!r}")
    if not (math.isfinite(radius) and radius > 0):
        raise ValueError(f"radius must be finite and positive, got {radius!r}")

    m, mu, g, area, rho = (
        vehicle.mass,
        vehicle.friction,
        env.gravity,
        vehicle.reference_area,
        env.air_density,
    )
    f_d = drag(rho, speed, setup.drag_coefficient, area)
    f_df = downforce(rho, speed, setup.downforce_coefficient, area)
    f_c = required_lateral_force(m, speed, radius)
    grip = available_lateral_grip(mu, m, g, f_df)
    k = downforce_factor(rho, setup.downforce_coefficient, area)
    r_star = critical_radius(m, mu, k)
    margin = safety_margin(grip, f_c)
    return CornerResult(
        setup=setup.name,
        speed=speed,
        radius=radius,
        drag=f_d,
        downforce=f_df,
        required_force=f_c,
        available_grip=grip,
        reserve_force=lateral_force_reserve(grip, f_c),
        margin=margin,
        feasible=margin >= 0.0,
        max_lateral_acceleration=max_lateral_acceleration(mu, g, f_df, m),
        required_lateral_acceleration=speed * speed / radius,
        max_cornering_speed=max_cornering_speed(m, radius, mu, g, k),
        critical_radius=r_star,
        grip_limited=radius < r_star,
        min_radius=min_corner_radius(m, speed, mu, g, f_df),
        min_friction=min_friction(m, g, f_df, f_c),
        min_downforce_coefficient=min_downforce_coefficient(m, speed, radius, mu, g, rho, area),
        max_mass=max_mass(speed, radius, mu, g, f_df),
    )
