"""Publication figures (300 dpi PNG and vector SVG/PDF).

Colours follow the manuscript: Setup A blue, Setup B red. Every figure states
its inputs in a caption string returned alongside it, so the figure and its
assumptions travel together.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.axes import Axes
from matplotlib.figure import Figure

from .. import reference
from ..physics import downforce_factor
from .montecarlo import DemandSweepRow, MonteCarloResult
from .sensitivity import TornadoRow

__all__ = [
    "SETUP_COLOURS",
    "apply_style",
    "fig_demand_sweep",
    "fig_model_curves",
    "fig_monte_carlo",
    "fig_tornado",
    "save",
]

SETUP_COLOURS = {"Setup A": "#1f5fd1", "Setup B": "#d1242f"}
INK = "#1d2330"
GRID = "#d9dde5"
FEASIBLE = "#2f9e5a"
INFEASIBLE = "#d1242f"

PARAMETER_LABELS = {
    "friction": r"Friction $\mu$",
    "mass": r"Mass $m$",
    "air_density": r"Air density $\rho$",
    "reference_area": r"Reference area $A$",
    "downforce_coefficient": r"Downforce coeff. $C_{DF}$",
    "drag_coefficient": r"Drag coeff. $C_D$",
    "speed": r"Speed $v$",
    "radius": r"Corner radius $r$",
    "lateral_acceleration": r"Corner demand $a_{ref}$",
}


def apply_style() -> None:
    plt.rcParams.update(
        {
            "font.family": "serif",
            "font.serif": ["STIXGeneral", "DejaVu Serif"],
            "mathtext.fontset": "stix",
            "font.size": 9,
            "axes.titlesize": 10,
            "axes.labelsize": 9,
            "axes.edgecolor": INK,
            "axes.labelcolor": INK,
            "axes.grid": True,
            "grid.color": GRID,
            "grid.linewidth": 0.6,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "xtick.color": INK,
            "ytick.color": INK,
            "legend.frameon": False,
            "legend.fontsize": 8,
            "lines.linewidth": 1.6,
            "savefig.dpi": 300,
            "savefig.bbox": "tight",
        }
    )


def save(fig: Figure, out_dir: Path, stem: str) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for ext in ("png", "svg", "pdf"):
        path = out_dir / f"{stem}.{ext}"
        fig.savefig(path, metadata={"Date": None} if ext in ("svg", "pdf") else None)
        paths.append(path)
    plt.close(fig)
    return paths


def _panel_label(ax: Axes, text: str) -> None:
    ax.text(-0.14, 1.04, text, transform=ax.transAxes, fontweight="bold", fontsize=10, color=INK)


def fig_model_curves() -> tuple[Figure, str]:
    """Model-consistent counterparts of Fig. 7b, 7c, 8b and 8c."""
    veh, env = reference.VEHICLE, reference.ENVIRONMENT
    m, mu, g, area, rho = veh.mass, veh.friction, env.gravity, veh.reference_area, env.air_density
    setups = (reference.SETUP_A, reference.SETUP_B)
    fig, axes = plt.subplots(2, 2, figsize=(7.0, 5.2))
    (ax1, ax2), (ax3, ax4) = axes

    v_kmh = np.linspace(100, 300, 201)
    v = v_kmh / 3.6
    r = np.linspace(50, 300, 501)
    for s in setups:
        c = SETUP_COLOURS[s.name]
        k = downforce_factor(rho, s.downforce_coefficient, area)
        a_max = mu * (g + k * v**2 / m) / g
        ax1.plot(v_kmh, a_max, color=c, label=s.name)

        denom = m / r - mu * k
        vmax = (
            np.where(
                denom > 0,
                np.sqrt(np.clip(mu * m * g / np.where(denom > 0, denom, 1), 0, None)),
                np.nan,
            )
            * 3.6
        )
        ax2.plot(r, vmax, color=c, label=s.name)
        r_star = m / (mu * k)
        if r_star < r[-1]:
            ax2.axvline(r_star, color=c, linestyle=":", linewidth=1)
            ax2.annotate(
                f"r* = {r_star:.0f} m",
                xy=(r_star, 40),
                xytext=(4, 0),
                textcoords="offset points",
                color=c,
                fontsize=7.5,
                ha="left",
                va="bottom",
            )

        r_fixed = 150.0
        sm = mu * (m * g + k * v**2) / (m * v**2 / r_fixed) - 1
        ax3.plot(v_kmh, sm, color=c, label=s.name)

        v_fixed = reference.CASE_SPEED
        reserve = (mu * (m * g + k * v_fixed**2) - m * v_fixed**2 / r) / 1000
        ax4.plot(r, reserve, color=c, label=s.name)

    ax1.set(
        xlabel="Speed $v$ (km/h)", ylabel=r"$a_{lat,max}$ (g)", title="Maximum lateral acceleration"
    )
    ax2.set(
        xlabel="Corner radius $r$ (m)",
        ylabel=r"$v_{max}$ (km/h)",
        title="Grip-limited cornering speed",
        ylim=(0, 550),
    )
    ax3.axhline(0, color=INK, linewidth=0.8)
    ax3.set(
        xlabel="Speed $v$ (km/h)", ylabel="Safety margin $M$", title=r"Safety margin at $r$ = 150 m"
    )
    ax4.axhline(0, color=INK, linewidth=0.8)
    ax4.set(
        xlabel="Corner radius $r$ (m)",
        ylabel=r"$\Delta F$ (kN)",
        title=r"Lateral force reserve at $v$ = 30 m/s",
    )
    for ax, lbl in zip(axes.flat, "abcd", strict=True):
        _panel_label(ax, f"({lbl})")
        ax.legend(loc="best")
    fig.tight_layout()
    caption = (
        "Curves computed from Eqs. 4.1 to 4.5 with the inputs of Table 1 "
        f"(m = {m:g} kg, A = {area:g} m^2, rho = {rho:g} kg/m^3, mu = {mu:g}, g = {g:g} m/s^2). "
        "(b) Beyond the critical radius r* the simplified model sets no grip-limited speed. "
        "(c) At fixed radius the margin falls with speed because demand grows with v^2 while "
        "only the aerodynamic part of the grip does."
    )
    return fig, caption


def fig_tornado(rows: Sequence[TornadoRow]) -> tuple[Figure, str]:
    setups = sorted({r.setup for r in rows})
    fig, axes = plt.subplots(1, len(setups), figsize=(7.0, 3.0), sharey=True)
    axes = np.atleast_1d(axes)
    order = sorted(
        {r.parameter for r in rows}, key=lambda p: -max(r.swing for r in rows if r.parameter == p)
    )
    for ax, name in zip(axes, setups, strict=True):
        sub = {r.parameter: r for r in rows if r.setup == name}
        base = next(iter(sub.values())).margin_base * 100
        y = np.arange(len(order))[::-1]
        lows = [sub[p].margin_low * 100 for p in order]
        highs = [sub[p].margin_high * 100 for p in order]
        ax.barh(
            y,
            [lo - base for lo in lows],
            left=base,
            color="#9aa6b8",
            height=0.6,
            label="parameter $-$10 %",
        )
        ax.barh(
            y,
            [hi - base for hi in highs],
            left=base,
            color=SETUP_COLOURS.get(name, INK),
            height=0.6,
            label="parameter +10 %",
        )
        ax.axvline(base, color=INK, linewidth=0.8)
        ax.axvline(0, color=INFEASIBLE, linewidth=0.8, linestyle="--")
        ax.set_yticks(y, [PARAMETER_LABELS.get(p, p) for p in order])
        ax.set(xlabel="Safety margin $M$ (%)", title=f"{name} (base {base:.1f} %)")
        ax.grid(axis="y", visible=False)
    fig.legend(
        *axes[0].get_legend_handles_labels(),
        loc="lower center",
        ncol=2,
        fontsize=7.5,
        bbox_to_anchor=(0.5, -0.02),
    )
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    delta = rows[0].delta * 100 if rows else 10
    caption = (
        f"One-at-a-time sensitivity of the safety margin at the case-study corner (v = 30 m/s, "
        f"r = 60 m, Table 1) to a {delta:.0f} % decrease (grey) or increase (colour) of each "
        "input. "
        "The dashed line marks the feasibility limit M = 0."
    )
    return fig, caption


def fig_demand_sweep(rows: Sequence[DemandSweepRow]) -> tuple[Figure, str]:
    circuits = list(dict.fromkeys(r.circuit for r in rows))
    fig, axes = plt.subplots(1, len(circuits), figsize=(7.0, 2.7), sharey=True)
    for ax, name in zip(np.atleast_1d(axes), circuits, strict=True):
        sub = [r for r in rows if r.circuit == name]
        a = np.array([r.lateral_acceleration for r in sub])
        for setup in sub[0].min_margin:
            ax.plot(
                a,
                [r.min_margin[setup] * 100 for r in sub],
                color=SETUP_COLOURS.get(setup, INK),
                label=setup,
            )
        bad = np.array([r.baseline_top_infeasible.get("drag-only", False) for r in sub])
        none = np.array([r.vdpm_best == "none eligible" for r in sub])
        avoidable = bad & ~none
        xform = ax.get_xaxis_transform()
        if avoidable.any():
            ax.fill_between(
                a,
                0,
                1,
                where=avoidable,
                transform=xform,
                color=INFEASIBLE,
                alpha=0.12,
                linewidth=0,
                step="mid",
                label="drag-only fails, VDPM picks a feasible setup",
            )
        if none.any():
            ax.fill_between(
                a,
                0,
                1,
                where=none,
                transform=xform,
                color="#7d8799",
                alpha=0.15,
                linewidth=0,
                step="mid",
                label="no setup feasible",
            )
        ax.axhline(0, color=INK, linewidth=0.8)
        ax.set(xlabel=r"Corner demand $a_{ref}$ (m/s$^2$)", title=name)
    np.atleast_1d(axes)[0].set_ylabel("Min. margin over corners (%)")
    handles: dict[str, Any] = {}
    for ax in np.atleast_1d(axes):
        for h, lbl in zip(*ax.get_legend_handles_labels(), strict=True):
            handles.setdefault(lbl, h)
    fig.legend(
        handles.values(),
        handles.keys(),
        loc="lower center",
        ncol=4,
        fontsize=7.5,
        bbox_to_anchor=(0.5, -0.02),
    )
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    caption = (
        "Minimum safety margin over all corners of each synthetic reference circuit as the corner "
        "demand a_ref (v^2 / r at every corner) increases. Red: the drag-only ranking recommends a "
        "setup that fails at least one corner while a feasible setup exists, which the gated VDPM "
        "ranking recommends instead. Grey: no setup is feasible and VDPM makes no recommendation."
    )
    return fig, caption


def _errors(vals: Sequence[Any]) -> list[list[float]]:
    """Asymmetric error bars (percentage points) from Wilson intervals."""
    return [
        [max(0.0, (p.value - p.interval[0]) * 100) for p in vals],
        [max(0.0, (p.interval[1] - p.value) * 100) for p in vals],
    ]


def fig_monte_carlo(
    stability: Sequence[MonteCarloResult], h1: Sequence[MonteCarloResult]
) -> tuple[Figure, str]:
    """(a) ranking stability at the reference demand; (b) H1 baseline comparison."""
    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.0, 3.0), gridspec_kw={"width_ratios": [1, 1.25]}
    )
    circuits = [r.circuit for r in stability]
    labels = [p.label for p in stability[0].winners]
    width = 0.8 / len(labels)
    x = np.arange(len(circuits))
    for i, lbl in enumerate(labels):
        vals = [next(p for p in r.winners if p.label == lbl) for r in stability]
        ax1.bar(
            x + (i - (len(labels) - 1) / 2) * width,
            [p.value * 100 for p in vals],
            width,
            yerr=_errors(vals),
            capsize=2,
            color=SETUP_COLOURS.get(lbl, "#9aa6b8"),
            label=lbl,
            error_kw={"linewidth": 0.8},
        )
    ax1.set_xticks(x, circuits)
    ax1.set(ylabel="Recommended in samples (%)", title="Ranking stability", ylim=(0, 112))
    ax1.legend(loc="upper center", ncol=3, fontsize=7, bbox_to_anchor=(0.5, 1.0))

    methods = [p.label for p in h1[0].baseline_infeasible]
    width = 0.8 / len(circuits)
    xm = np.arange(len(methods))
    shades = ["#2c3e5c", "#6b7c99", "#a9b6cb"]
    for j, r in enumerate(h1):
        avoid = [next(p for p in r.baseline_avoidable if p.label == m) for m in methods]
        pos = xm + (j - (len(h1) - 1) / 2) * width
        ax2.bar(
            pos,
            [p.value * 100 for p in avoid],
            width,
            yerr=_errors(avoid),
            capsize=2,
            color=shades[j % len(shades)],
            label=r.circuit,
            error_kw={"linewidth": 0.8},
        )
    ax2.set_xticks(xm, methods, fontsize=7.5)
    ax2.set(ylabel="Avoidable infeasible choice (%)", title="Unconstrained rankings")
    ax2.legend(loc="upper right", fontsize=7)
    for ax, lbl in ((ax1, "(a)"), (ax2, "(b)")):
        _panel_label(ax, lbl)
    fig.tight_layout()
    r0, h0 = stability[0], h1[0]
    unc = ", ".join(f"{k} +/-{v * 100:g}%" for k, v in r0.uncertainty.items())
    lo, hi = h0.demand_range or (math.nan, math.nan)
    caption = (
        f"Monte Carlo analysis, {r0.samples} samples per circuit and panel (seed {r0.seed}). "
        f"(a) Share of samples in which each setup is recommended, with uniform multiplicative "
        f"uncertainty {unc} around the reference inputs. (b) Corner demand a_ref drawn uniformly "
        f"from {lo:g} to {hi:g} m/s^2 with the same uncertainty on the other inputs: share of "
        "samples in which each unconstrained ranking recommends a setup that fails at least one "
        "corner although a feasible setup existed, which the gated VDPM ranking recommends "
        "instead. Samples in which no setup was feasible are excluded from this count. "
        "Error bars: 95 % Wilson intervals."
    )
    return fig, caption
