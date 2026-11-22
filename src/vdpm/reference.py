"""The manuscript's numerical case study (Section 6) as executable data.

:data:`TABLE_1` holds the published inputs and :data:`TABLE_2` the published
outputs, exactly as printed (with their printed precision). The verification
suite recomputes Table 2 from Table 1 and checks agreement to that precision;
:func:`reproduce_table_2` returns the full-precision values.
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import AeroSetup, Environment, Vehicle
from .physics import CornerResult, evaluate_corner

__all__ = [
    "CASE_RADIUS",
    "CASE_SPEED",
    "ENVIRONMENT",
    "SETUP_A",
    "SETUP_B",
    "TABLE_1",
    "TABLE_2",
    "VEHICLE",
    "PublishedRow",
    "reproduce_table_2",
]

#: Table 1, shared inputs.
VEHICLE = Vehicle(mass=800.0, reference_area=1.50, friction=1.50)
ENVIRONMENT = Environment(air_density=1.225, gravity=9.81)
CASE_SPEED = 30.0  # m/s
CASE_RADIUS = 60.0  # m

#: Table 1, per-setup inputs.
SETUP_A = AeroSetup("Setup A", 0.80, 2.50, description="Low drag", source="Manuscript Table 1")
SETUP_B = AeroSetup(
    "Setup B", 1.10, 3.50, description="High downforce", source="Manuscript Table 1"
)

TABLE_1 = {
    "mass_kg": 800.0,
    "speed_mps": 30.0,
    "air_density_kgm3": 1.225,
    "reference_area_m2": 1.50,
    "friction": 1.50,
    "corner_radius_m": 60.0,
    "gravity_mps2": 9.81,
    "setups": {"Setup A": {"C_D": 0.80, "C_DF": 2.50}, "Setup B": {"C_D": 1.10, "C_DF": 3.50}},
}


@dataclass(frozen=True, slots=True)
class PublishedRow:
    """One row of Table 2 as printed, with the printed resolution of each value."""

    setup: str
    drag_n: float
    downforce_n: float
    demand_n: float
    grip_n: float
    reserve_pct: float
    feasible: bool
    force_resolution: float = 0.1  # N, as printed
    reserve_resolution: float = 0.1  # percentage points, as printed


#: Table 2 of the manuscript.
TABLE_2 = (
    PublishedRow("Setup A", 661.5, 2067.2, 12000.0, 14872.8, 23.9, True),
    PublishedRow("Setup B", 909.6, 2894.1, 12000.0, 16113.1, 34.3, True),
)


def reproduce_table_2() -> tuple[CornerResult, CornerResult]:
    """Recompute Table 2 from Table 1 at full precision."""
    return (
        evaluate_corner(VEHICLE, SETUP_A, CASE_SPEED, CASE_RADIUS, ENVIRONMENT),
        evaluate_corner(VEHICLE, SETUP_B, CASE_SPEED, CASE_RADIUS, ENVIRONMENT),
    )
