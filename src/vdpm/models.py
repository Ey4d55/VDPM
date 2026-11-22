"""Immutable data models for the VDPM framework.

All quantities are in SI units throughout the package:

=================  ==========  ==========================================
Quantity           Unit        Symbol in the manuscript
=================  ==========  ==========================================
mass               kg          m
speed              m/s         v
air density        kg/m^3      rho
reference area     m^2         A
corner radius      m           r
gravity            m/s^2       g
segment length     m           L_i
force              N           F
=================  ==========  ==========================================

The models are deliberately plain, frozen dataclasses: they carry data and
validate it, while all physics lives in :mod:`vdpm.physics`. This keeps every
equation in exactly one place, which is what the cross-implementation
verification against the browser engine relies on.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum

__all__ = [
    "STANDARD_GRAVITY",
    "AeroSetup",
    "Circuit",
    "Environment",
    "Segment",
    "SegmentKind",
    "Vehicle",
]

#: Gravitational acceleration used in the manuscript (Table 1), m/s^2.
STANDARD_GRAVITY = 9.81


def _require_positive(name: str, value: float) -> None:
    if not (isinstance(value, (int, float)) and math.isfinite(value) and value > 0):
        raise ValueError(f"{name} must be a finite positive number, got {value!r}")


def _require_nonnegative(name: str, value: float) -> None:
    if not (isinstance(value, (int, float)) and math.isfinite(value) and value >= 0):
        raise ValueError(f"{name} must be a finite non-negative number, got {value!r}")


@dataclass(frozen=True, slots=True)
class Vehicle:
    """Vehicle properties that do not change between aerodynamic setups.

    Attributes:
        mass: Vehicle mass ``m`` including driver, kg.
        reference_area: Aerodynamic reference area ``A`` used to define both
            ``C_D`` and ``C_DF``, m^2. It must be the same area the CFD
            post-processing used, otherwise forces are scaled incorrectly.
        friction: Effective tyre-road friction coefficient ``mu`` (Sec. 4.4).
            Treated as constant, as in the manuscript's simplified model.
    """

    mass: float
    reference_area: float
    friction: float

    def __post_init__(self) -> None:
        _require_positive("mass", self.mass)
        _require_positive("reference_area", self.reference_area)
        _require_positive("friction", self.friction)


@dataclass(frozen=True, slots=True)
class Environment:
    """Ambient conditions.

    Attributes:
        air_density: ``rho``, kg/m^3. Default 1.225 (ISA sea level, Table 1).
        gravity: ``g``, m/s^2. Default 9.81 (Table 1).
    """

    air_density: float = 1.225
    gravity: float = STANDARD_GRAVITY

    def __post_init__(self) -> None:
        _require_positive("air_density", self.air_density)
        _require_positive("gravity", self.gravity)


@dataclass(frozen=True, slots=True)
class AeroSetup:
    """One aerodynamic configuration, characterised by its force coefficients.

    Attributes:
        name: Display name, e.g. ``"Setup A"``.
        drag_coefficient: ``C_D``, dimensionless, referenced to ``A``.
        downforce_coefficient: ``C_DF``, dimensionless, positive for downforce
            (Sec. 4.2). With the usual upward-positive lift convention,
            ``C_DF = -C_L``.
        description: Free text, e.g. ``"Low drag"``.
        front_wing_angle_deg: Optional front-wing angle, for traceability only.
        rear_wing_angle_deg: Optional rear-wing angle, for traceability only.
        source: Provenance of the coefficients (e.g. a CFD case identifier).
    """

    name: str
    drag_coefficient: float
    downforce_coefficient: float
    description: str = ""
    front_wing_angle_deg: float | None = None
    rear_wing_angle_deg: float | None = None
    source: str = ""

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("setup name must not be empty")
        _require_positive("drag_coefficient", self.drag_coefficient)
        _require_nonnegative("downforce_coefficient", self.downforce_coefficient)

    @property
    def efficiency(self) -> float:
        """Aerodynamic efficiency ``C_DF / C_D`` (Fig. 6a)."""
        return self.downforce_coefficient / self.drag_coefficient


class SegmentKind(str, Enum):
    """Type of a circuit segment."""

    STRAIGHT = "straight"
    CORNER = "corner"


@dataclass(frozen=True, slots=True)
class Segment:
    """A constant-condition piece of a circuit (Sec. 5, Step 5).

    Attributes:
        kind: Straight or corner.
        length: Segment length ``L_i`` along the racing line, m.
        speed: Reference operating speed ``v_i`` for the segment, m/s.
        radius: Constant corner radius ``r_i``, m. Required for corners and
            ignored (must be ``None``) for straights.
        name: Optional label, e.g. ``"T1"``.
        grade: Optional longitudinal grade (rise over run). Stored for
            provenance; the planar model of Sec. 4.3 does not use it.
    """

    kind: SegmentKind
    length: float
    speed: float
    radius: float | None = None
    name: str = ""
    grade: float = 0.0

    def __post_init__(self) -> None:
        object.__setattr__(self, "kind", SegmentKind(self.kind))
        _require_positive("length", self.length)
        _require_positive("speed", self.speed)
        if self.kind is SegmentKind.CORNER:
            if self.radius is None:
                raise ValueError("a corner segment requires a radius")
            _require_positive("radius", self.radius)
        elif self.radius is not None:
            raise ValueError("a straight segment must not have a radius")
        if not math.isfinite(self.grade):
            raise ValueError("grade must be finite")

    @property
    def is_corner(self) -> bool:
        return self.kind is SegmentKind.CORNER


@dataclass(frozen=True, slots=True)
class Circuit:
    """A circuit described as an ordered list of segments.

    Attributes:
        name: Display name.
        segments: Ordered segments, at least one corner.
        description: Free text.
        provenance: Where the segment data came from. Synthetic layouts must
            say so here, so that no result is mistaken for real-track data.
    """

    name: str
    segments: tuple[Segment, ...]
    description: str = ""
    provenance: str = ""
    metadata: dict[str, float | str] = field(default_factory=dict, compare=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "segments", tuple(self.segments))
        if not self.segments:
            raise ValueError("a circuit needs at least one segment")
        if not any(s.is_corner for s in self.segments):
            raise ValueError("a circuit needs at least one corner")

    @property
    def corners(self) -> tuple[Segment, ...]:
        return tuple(s for s in self.segments if s.is_corner)

    @property
    def straights(self) -> tuple[Segment, ...]:
        return tuple(s for s in self.segments if not s.is_corner)

    @property
    def length(self) -> float:
        """Total length, m."""
        return math.fsum(s.length for s in self.segments)

    @property
    def straight_fraction(self) -> float:
        """Share of the total length that is straight, ``s`` in [0, 1]."""
        return math.fsum(s.length for s in self.straights) / self.length

    @property
    def mean_corner_radius(self) -> float:
        """Arithmetic mean of corner radii, m (as reported in Fig. 5b)."""
        radii = [s.radius for s in self.corners if s.radius is not None]
        return math.fsum(radii) / len(radii)
