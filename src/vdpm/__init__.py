"""VDPM: Vehicle Dynamics Performance Metric.

Reference implementation of the physics-constrained, circuit-aware framework
for screening Formula 1 aerodynamic setups, and the scientific core of the
VDPM-RaceTwin decision-support platform.

Quick start::

    from vdpm import reference, rank_setups, reference_circuit

    a, b = reference.reproduce_table_2()          # Table 2 of the manuscript
    ranking = rank_setups(reference.VEHICLE,
                          [reference.SETUP_A, reference.SETUP_B],
                          reference_circuit("C"))
    print(ranking.best.name)

All quantities are SI. See the package README for the model's scope and
limitations, which apply to every number this package produces.
"""

from . import reference
from .baselines import BASELINES, BaselineRanking, compare_with_baselines, rank_baseline
from .cfd_io import (
    ConvergedCoefficients,
    ForceHistory,
    WingSweep,
    converged_coefficients,
    read_fluent_report,
    read_openfoam_force_coeffs,
    read_setups_csv,
    read_wing_sweep_csv,
)
from .circuits import (
    CASE_STUDY_LATERAL_ACCELERATION,
    REFERENCE_SUMMARIES,
    CircuitSummary,
    circuit_from_csv,
    circuit_to_csv,
    reference_circuit,
    reference_circuits,
    synthetic_circuit,
)
from .explain import Finding, explain_ranking, margin_sensitivities, weight_flip_point
from .models import AeroSetup, Circuit, Environment, Segment, SegmentKind, Vehicle
from .physics import CornerResult, evaluate_corner
from .scoring import (
    CircuitEvaluation,
    CircuitWeights,
    RankedSetup,
    Ranking,
    evaluate_circuit,
    rank_setups,
)

__version__ = "0.1.0"

__all__ = [
    "BASELINES",
    "CASE_STUDY_LATERAL_ACCELERATION",
    "REFERENCE_SUMMARIES",
    "AeroSetup",
    "BaselineRanking",
    "Circuit",
    "CircuitEvaluation",
    "CircuitSummary",
    "CircuitWeights",
    "ConvergedCoefficients",
    "CornerResult",
    "Environment",
    "Finding",
    "ForceHistory",
    "RankedSetup",
    "Ranking",
    "Segment",
    "SegmentKind",
    "Vehicle",
    "WingSweep",
    "__version__",
    "circuit_from_csv",
    "circuit_to_csv",
    "compare_with_baselines",
    "converged_coefficients",
    "evaluate_circuit",
    "evaluate_corner",
    "explain_ranking",
    "margin_sensitivities",
    "rank_baseline",
    "rank_setups",
    "read_fluent_report",
    "read_openfoam_force_coeffs",
    "read_setups_csv",
    "read_wing_sweep_csv",
    "reference",
    "reference_circuit",
    "reference_circuits",
    "synthetic_circuit",
    "weight_flip_point",
]
