"""Circuit construction, reference circuits and the segment CSV format.

Reference circuits A, B and C
-----------------------------
The manuscript characterises three representative circuits only by summary
statistics (Fig. 5b): length, number of turns, straight-line ratio, mean
corner radius, elevation change and a baseline lap time. Segment-level data
is not given. :func:`synthetic_circuit` therefore builds a deterministic
segment layout that reproduces those statistics *exactly*:

* ``n`` corners with radii spaced linearly from 0.5 to 1.5 times the mean
  radius, so the arithmetic mean equals the published value;
* corner arc lengths proportional to radius (every corner turns through the
  same angle), summing to ``(1 - s) L``;
* ``n`` straights, one after each corner, with lengths following
  ``1 + 0.6 cos(2 pi i / n)`` normalised to sum to ``s L``;
* corner reference speeds ``v_i = sqrt(a_ref r_i)`` at a common lateral
  acceleration ``a_ref``. The default ``a_ref = 15 m/s^2`` is the lateral
  demand of the manuscript's case study (30 m/s on a 60 m radius);
* straight reference speed equal to the mean lap speed ``L / t_lap``.

These layouts are labelled synthetic in their provenance. Individual segment
radii, lengths and speeds are modelling assumptions, not measured track data,
and must be described as such wherever results computed on them are reported.

Segment CSV format
------------------
One row per segment, in driving order, with a header row::

    name,kind,length_m,radius_m,speed_mps,grade
    T1,corner,180,60,30,0
    S1,straight,650,,70,0

``kind`` is ``corner`` or ``straight``; ``radius_m`` is empty for straights;
``grade`` is optional (rise over run, stored but unused by the planar model).
"""

from __future__ import annotations

import csv
import io
import math
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from .models import Circuit, Segment, SegmentKind

__all__ = [
    "CASE_STUDY_LATERAL_ACCELERATION",
    "REFERENCE_SUMMARIES",
    "CircuitSummary",
    "circuit_from_csv",
    "circuit_to_csv",
    "reference_circuit",
    "reference_circuits",
    "synthetic_circuit",
]

#: Lateral demand of the manuscript case study, v^2 / r = 30^2 / 60, m/s^2.
CASE_STUDY_LATERAL_ACCELERATION = 30.0**2 / 60.0

CSV_COLUMNS = ("name", "kind", "length_m", "radius_m", "speed_mps", "grade")


@dataclass(frozen=True, slots=True)
class CircuitSummary:
    """Published summary statistics of a circuit (Fig. 5b)."""

    key: str
    name: str
    character: str
    length_m: float
    turns: int
    straight_fraction: float
    mean_corner_radius_m: float
    elevation_change_m: float
    lap_time_s: float

    @property
    def mean_lap_speed(self) -> float:
        """``L / t_lap``, m/s."""
        return self.length_m / self.lap_time_s


#: Fig. 5b of the manuscript.
REFERENCE_SUMMARIES: dict[str, CircuitSummary] = {
    "A": CircuitSummary("A", "Circuit A", "high-speed", 5790.0, 11, 0.72, 320.0, 12.0, 82.4),
    "B": CircuitSummary("B", "Circuit B", "balanced", 4360.0, 14, 0.48, 210.0, 26.0, 74.8),
    "C": CircuitSummary("C", "Circuit C", "technical", 3610.0, 18, 0.28, 120.0, 38.0, 69.5),
}


def _interleave(n: int, stride: int = 5) -> list[int]:
    """Deterministic permutation so that tight and fast corners alternate."""
    if math.gcd(stride, n) != 1:
        stride = 1
    return [(i * stride) % n for i in range(n)]


def synthetic_circuit(
    summary: CircuitSummary,
    lateral_acceleration: float = CASE_STUDY_LATERAL_ACCELERATION,
) -> Circuit:
    """Deterministic segment layout matching a :class:`CircuitSummary`.

    Args:
        summary: Target statistics.
        lateral_acceleration: ``a_ref`` used to set corner speeds, m/s^2.
    """
    n = summary.turns
    if n < 2:
        raise ValueError("a synthetic circuit needs at least two turns")
    if not 0.0 < summary.straight_fraction < 1.0:
        raise ValueError("straight fraction must lie strictly between 0 and 1")
    if lateral_acceleration <= 0:
        raise ValueError("lateral acceleration must be positive")

    radii_sorted = [summary.mean_corner_radius_m * (0.5 + i / (n - 1)) for i in range(n)]
    radii = [radii_sorted[j] for j in _interleave(n)]
    corner_total = (1.0 - summary.straight_fraction) * summary.length_m
    radius_sum = math.fsum(radii)
    corner_lengths = [corner_total * r / radius_sum for r in radii]

    straight_total = summary.straight_fraction * summary.length_m
    weights = [1.0 + 0.6 * math.cos(2.0 * math.pi * i / n) for i in range(n)]
    weight_sum = math.fsum(weights)
    straight_lengths = [straight_total * w / weight_sum for w in weights]
    straight_speed = summary.mean_lap_speed

    segments: list[Segment] = []
    for i in range(n):
        segments.append(
            Segment(
                kind=SegmentKind.CORNER,
                length=corner_lengths[i],
                speed=math.sqrt(lateral_acceleration * radii[i]),
                radius=radii[i],
                name=f"T{i + 1}",
            )
        )
        segments.append(
            Segment(
                kind=SegmentKind.STRAIGHT,
                length=straight_lengths[i],
                speed=straight_speed,
                name=f"S{i + 1}",
            )
        )
    return Circuit(
        name=summary.name,
        segments=tuple(segments),
        description=f"{summary.character.capitalize()} reference circuit",
        provenance=(
            "Synthetic layout generated by vdpm.circuits.synthetic_circuit to match the summary "
            "statistics of Fig. 5b (length, turns, straight ratio, mean corner radius). Segment "
            "radii, lengths and speeds are modelling assumptions, not measured track data. "
            f"Corner speeds use a_ref = {lateral_acceleration:.3f} m/s^2."
        ),
        metadata={
            "key": summary.key,
            "character": summary.character,
            "turns": summary.turns,
            "elevation_change_m": summary.elevation_change_m,
            "lap_time_s": summary.lap_time_s,
            "lateral_acceleration": lateral_acceleration,
        },
    )


def reference_circuit(
    key: str, lateral_acceleration: float = CASE_STUDY_LATERAL_ACCELERATION
) -> Circuit:
    """Synthetic layout of reference circuit ``"A"``, ``"B"`` or ``"C"``."""
    try:
        summary = REFERENCE_SUMMARIES[key.upper()]
    except KeyError as exc:
        raise ValueError(f"unknown reference circuit {key!r}; choose A, B or C") from exc
    return synthetic_circuit(summary, lateral_acceleration)


def reference_circuits(
    lateral_acceleration: float = CASE_STUDY_LATERAL_ACCELERATION,
) -> tuple[Circuit, ...]:
    """All three reference circuits, A to C."""
    return tuple(reference_circuit(k, lateral_acceleration) for k in REFERENCE_SUMMARIES)


# --------------------------------------------------------------------------- #
# CSV
# --------------------------------------------------------------------------- #


def _parse_float(value: str, column: str, line: int) -> float:
    try:
        number = float(value)
    except ValueError as exc:
        raise ValueError(f"line {line}: column {column!r} is not a number: {value!r}") from exc
    if not math.isfinite(number):
        raise ValueError(f"line {line}: column {column!r} must be finite")
    return number


def _rows_to_segments(rows: Iterable[dict[str, str]]) -> list[Segment]:
    segments = []
    for line, row in enumerate(rows, start=2):
        missing = [c for c in ("kind", "length_m", "speed_mps") if not (row.get(c) or "").strip()]
        if missing:
            raise ValueError(f"line {line}: missing value(s) for {', '.join(missing)}")
        kind = row["kind"].strip().lower()
        if kind not in ("corner", "straight"):
            raise ValueError(f"line {line}: kind must be 'corner' or 'straight', got {kind!r}")
        radius_text = (row.get("radius_m") or "").strip()
        radius = _parse_float(radius_text, "radius_m", line) if radius_text else None
        grade_text = (row.get("grade") or "").strip()
        try:
            segments.append(
                Segment(
                    kind=SegmentKind(kind),
                    length=_parse_float(row["length_m"], "length_m", line),
                    speed=_parse_float(row["speed_mps"], "speed_mps", line),
                    radius=radius,
                    name=(row.get("name") or "").strip(),
                    grade=_parse_float(grade_text, "grade", line) if grade_text else 0.0,
                )
            )
        except ValueError as exc:
            raise ValueError(f"line {line}: {exc}") from exc
    return segments


def circuit_from_csv(source: str | Path, name: str | None = None, provenance: str = "") -> Circuit:
    """Read a circuit from a segment CSV file path or CSV text.

    Args:
        source: A path to a ``.csv`` file, or the CSV text itself.
        name: Circuit name; defaults to the file stem.
        provenance: Where the data came from (strongly recommended).
    """
    path = Path(source) if not isinstance(source, str) or "\n" not in source else None
    if path is not None and path.exists():
        text = path.read_text(encoding="utf-8-sig")
        default_name = path.stem
    else:
        text = str(source)
        default_name = "Imported circuit"
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ValueError("CSV has no header row")
    header = [h.strip() for h in reader.fieldnames]
    reader.fieldnames = header
    required = {"kind", "length_m", "speed_mps"}
    if not required.issubset(header):
        raise ValueError(f"CSV header must include {sorted(required)}; got {header}")
    segments = _rows_to_segments(reader)
    return Circuit(name=name or default_name, segments=tuple(segments), provenance=provenance)


def circuit_to_csv(circuit: Circuit) -> str:
    """Serialise a circuit to the segment CSV format (full float precision)."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for seg in circuit.segments:
        writer.writerow(
            [
                seg.name,
                seg.kind.value,
                repr(seg.length),
                "" if seg.radius is None else repr(seg.radius),
                repr(seg.speed),
                repr(seg.grade),
            ]
        )
    return buffer.getvalue()
