"""Import of CFD results (manuscript Sec. 3 and 5).

Supported inputs
----------------
* **OpenFOAM** ``forceCoeffs`` output (``coefficient.dat`` in recent ESI
  releases, ``forceCoeffs.dat`` in older and Foundation releases). Columns are
  located by name from the last commented header line.
* **ANSYS Fluent** report files (``*.out``) written by a report definition.
  Columns are located by name from the quoted header line.
* **Generic CSV** of setups (``name,C_D,C_DF,...``) or of a wing-angle sweep
  (``angle_deg,C_D,C_DF``).

Sign convention
---------------
Solvers report lift positive upward. The VDPM framework uses a positive
downforce coefficient (Sec. 4.2), so by default ``C_DF = -C_L``
(``lift_sign = -1``). Check this against your solver set-up: a case whose lift
direction already points downward needs ``lift_sign = +1``.

Reference area
--------------
Coefficients are only meaningful with the reference area and speed used to
compute them. When an OpenFOAM header reports ``Aref``/``magUInf`` they are
returned in :attr:`ForceHistory.metadata` so callers can check them against
:attr:`vdpm.models.Vehicle.reference_area`.

Convergence
-----------
:func:`converged_coefficients` averages the last fraction of the history and
reports the standard deviation and the drift between the two halves of that
window. Iterative convergence is a precondition, not proof, of accuracy: mesh
independence and validation must be established separately (Sec. 5, Step 4).
"""

from __future__ import annotations

import bisect
import csv
import io
import math
import re
import statistics
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

from .models import AeroSetup

__all__ = [
    "ConvergedCoefficients",
    "ForceHistory",
    "WingSweep",
    "converged_coefficients",
    "read_fluent_report",
    "read_openfoam_force_coeffs",
    "read_setups_csv",
    "read_wing_sweep_csv",
]

_NUMBER = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")


def _read_text(source: str | Path) -> str:
    if isinstance(source, Path) or ("\n" not in str(source) and Path(str(source)).exists()):
        return Path(source).read_text(encoding="utf-8-sig")
    return str(source)


@dataclass(frozen=True, slots=True)
class ForceHistory:
    """Iteration (or time) history of named coefficient columns."""

    index_name: str
    index: tuple[float, ...]
    columns: dict[str, tuple[float, ...]]
    metadata: dict[str, str] = field(default_factory=dict)

    def column(self, name: str) -> tuple[float, ...]:
        try:
            return self.columns[name]
        except KeyError as exc:
            raise KeyError(f"column {name!r} not found; available: {sorted(self.columns)}") from exc


def _parse_numeric_rows(lines: Sequence[str], width: int) -> list[list[float]]:
    rows = []
    for raw in lines:
        tokens = raw.replace(",", " ").split()
        if len(tokens) < width or not all(_NUMBER.match(t) for t in tokens[:width]):
            continue
        rows.append([float(t) for t in tokens[:width]])
    if not rows:
        raise ValueError("no numeric data rows found")
    return rows


def read_openfoam_force_coeffs(source: str | Path) -> ForceHistory:
    """Read an OpenFOAM ``forceCoeffs`` ``.dat`` file (path or text)."""
    text = _read_text(source)
    header: list[str] | None = None
    metadata: dict[str, str] = {}
    data_lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            body = stripped.lstrip("#").strip()
            if ":" in body and not body.startswith(("Time", "Iteration")):
                key, _, value = body.partition(":")
                metadata[key.strip()] = value.strip()
            tokens = body.split()
            if tokens and tokens[0] in ("Time", "Iteration"):
                header = tokens
        else:
            data_lines.append(stripped)
    if header is None:
        raise ValueError("no '# Time ...' header line found in OpenFOAM file")
    rows = _parse_numeric_rows(data_lines, len(header))
    cols = list(zip(*rows, strict=True))
    return ForceHistory(
        index_name=header[0],
        index=tuple(cols[0]),
        columns={name: tuple(values) for name, values in zip(header[1:], cols[1:], strict=True)},
        metadata=metadata,
    )


def read_fluent_report(source: str | Path) -> ForceHistory:
    """Read an ANSYS Fluent report file (``.out``; path or text)."""
    text = _read_text(source)
    header: list[str] | None = None
    data_lines = []
    title = ""
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith(('"', "(")):
            names = re.findall(r'"([^"]*)"', stripped)
            if len(names) == 1 and not title:
                title = names[0]
            elif len(names) > 1:
                header = names
        else:
            data_lines.append(stripped)
    if header is None:
        raise ValueError("no quoted column header found in Fluent report file")
    rows = _parse_numeric_rows(data_lines, len(header))
    cols = list(zip(*rows, strict=True))
    return ForceHistory(
        index_name=header[0],
        index=tuple(cols[0]),
        columns={name: tuple(values) for name, values in zip(header[1:], cols[1:], strict=True)},
        metadata={"title": title} if title else {},
    )


@dataclass(frozen=True, slots=True)
class ConvergedCoefficients:
    """Window-averaged coefficients with convergence indicators."""

    drag_coefficient: float
    downforce_coefficient: float
    drag_std: float
    downforce_std: float
    drag_drift: float
    downforce_drift: float
    samples: int

    def to_setup(self, name: str, **kwargs: object) -> AeroSetup:
        """Create an :class:`~vdpm.models.AeroSetup` from these coefficients."""
        return AeroSetup(
            name=name,
            drag_coefficient=self.drag_coefficient,
            downforce_coefficient=self.downforce_coefficient,
            **kwargs,  # type: ignore[arg-type]
        )


def _window_stats(values: Sequence[float]) -> tuple[float, float, float]:
    mean = math.fsum(values) / len(values)
    std = statistics.pstdev(values) if len(values) > 1 else 0.0
    half = len(values) // 2
    if half == 0:
        return mean, std, 0.0
    first = math.fsum(values[:half]) / half
    second = math.fsum(values[half:]) / (len(values) - half)
    drift = abs(second - first) / abs(mean) if mean != 0 else math.inf
    return mean, std, drift


def converged_coefficients(
    history: ForceHistory,
    drag_column: str,
    lift_column: str,
    window: float = 0.1,
    lift_sign: float = -1.0,
) -> ConvergedCoefficients:
    """Average the last ``window`` fraction of a history.

    Args:
        history: Parsed solver output.
        drag_column: Column holding ``C_D`` (e.g. ``"Cd"`` or ``"cd-1"``).
        lift_column: Column holding the lift coefficient (e.g. ``"Cl"``).
        window: Fraction of samples at the end to average, in (0, 1].
        lift_sign: Multiplier from lift to downforce coefficient; ``-1`` for the
            usual upward-positive lift convention.
    """
    if not 0.0 < window <= 1.0:
        raise ValueError("window must lie in (0, 1]")
    if lift_sign not in (-1.0, 1.0):
        raise ValueError("lift_sign must be +1 or -1")
    cd_all = history.column(drag_column)
    cl_all = history.column(lift_column)
    count = max(1, round(len(cd_all) * window))
    cd = cd_all[-count:]
    cdf = [lift_sign * v for v in cl_all[-count:]]
    cd_mean, cd_std, cd_drift = _window_stats(cd)
    df_mean, df_std, df_drift = _window_stats(cdf)
    return ConvergedCoefficients(cd_mean, df_mean, cd_std, df_std, cd_drift, df_drift, count)


# --------------------------------------------------------------------------- #
# Generic CSV
# --------------------------------------------------------------------------- #


def _dict_rows(source: str | Path) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(_read_text(source)))
    if reader.fieldnames is None:
        raise ValueError("CSV has no header row")
    reader.fieldnames = [h.strip() for h in reader.fieldnames]
    return [{k: (v or "").strip() for k, v in row.items() if k is not None} for row in reader]


def _optional_float(text: str) -> float | None:
    return float(text) if text else None


def read_setups_csv(source: str | Path) -> list[AeroSetup]:
    """Read setups from CSV with columns ``name,C_D,C_DF`` and optionally
    ``description,front_wing_deg,rear_wing_deg,source``."""
    rows = _dict_rows(source)
    setups = []
    for line, row in enumerate(rows, start=2):
        try:
            setups.append(
                AeroSetup(
                    name=row["name"],
                    drag_coefficient=float(row["C_D"]),
                    downforce_coefficient=float(row["C_DF"]),
                    description=row.get("description", ""),
                    front_wing_angle_deg=_optional_float(row.get("front_wing_deg", "")),
                    rear_wing_angle_deg=_optional_float(row.get("rear_wing_deg", "")),
                    source=row.get("source", ""),
                )
            )
        except (KeyError, ValueError) as exc:
            raise ValueError(f"line {line}: {exc}") from exc
    return setups


@dataclass(frozen=True, slots=True)
class WingSweep:
    """Coefficients measured (e.g. by CFD) at a set of wing angles.

    Interpolation is piecewise linear between measured angles. Extrapolation
    outside the measured range is refused, because no data supports it.
    """

    angles_deg: tuple[float, ...]
    drag_coefficients: tuple[float, ...]
    downforce_coefficients: tuple[float, ...]
    label: str = ""

    def __post_init__(self) -> None:
        n = len(self.angles_deg)
        if n < 2 or n != len(self.drag_coefficients) or n != len(self.downforce_coefficients):
            raise ValueError("a sweep needs at least two angles and matching coefficient lists")
        if any(b <= a for a, b in zip(self.angles_deg, self.angles_deg[1:], strict=False)):
            raise ValueError("sweep angles must be strictly increasing")

    def _interp(self, values: Sequence[float], angle: float) -> float:
        lo, hi = self.angles_deg[0], self.angles_deg[-1]
        if not lo <= angle <= hi:
            raise ValueError(f"angle {angle} deg is outside the measured range [{lo}, {hi}] deg")
        i = bisect.bisect_right(self.angles_deg, angle) - 1
        if i >= len(self.angles_deg) - 1:
            return values[-1]
        a0, a1 = self.angles_deg[i], self.angles_deg[i + 1]
        t = (angle - a0) / (a1 - a0)
        return values[i] + t * (values[i + 1] - values[i])

    def coefficients_at(self, angle_deg: float) -> tuple[float, float]:
        """``(C_D, C_DF)`` at ``angle_deg`` by linear interpolation."""
        return (
            self._interp(self.drag_coefficients, angle_deg),
            self._interp(self.downforce_coefficients, angle_deg),
        )

    def setup_at(self, angle_deg: float, name: str | None = None) -> AeroSetup:
        cd, cdf = self.coefficients_at(angle_deg)
        return AeroSetup(
            name=name or f"{self.label or 'Sweep'} @ {angle_deg:g} deg",
            drag_coefficient=cd,
            downforce_coefficient=cdf,
            rear_wing_angle_deg=angle_deg,
            source=f"linear interpolation of wing sweep {self.label!r}",
        )


def read_wing_sweep_csv(source: str | Path, label: str = "") -> WingSweep:
    """Read a sweep from CSV with columns ``angle_deg,C_D,C_DF``."""
    rows = _dict_rows(source)
    try:
        data = sorted((float(r["angle_deg"]), float(r["C_D"]), float(r["C_DF"])) for r in rows)
    except (KeyError, ValueError) as exc:
        raise ValueError(f"invalid sweep CSV: {exc}") from exc
    angles, cds, cdfs = zip(*data, strict=True)
    return WingSweep(tuple(angles), tuple(cds), tuple(cdfs), label)
