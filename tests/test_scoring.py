"""Feasibility gate, normalisation, weights and ranking (Sec. 4.6)."""

from __future__ import annotations

import pytest

from vdpm import (
    AeroSetup,
    Circuit,
    CircuitWeights,
    Segment,
    SegmentKind,
    rank_setups,
    reference_circuit,
)
from vdpm.scoring import competition_ranks, evaluate_circuit


def _circuit(radius=60.0, speed=30.0):
    return Circuit(
        "test",
        (
            Segment(SegmentKind.CORNER, 100.0, speed, radius, "T1"),
            Segment(SegmentKind.STRAIGHT, 300.0, 60.0, None, "S1"),
        ),
    )


def test_weights_must_be_valid():
    with pytest.raises(ValueError):
        CircuitWeights(0.5, 0.5, 0.5)
    with pytest.raises(ValueError):
        CircuitWeights(-0.1, 0.6, 0.5)
    w = CircuitWeights.from_straight_fraction(0.72)
    assert (w.drag, w.grip, w.margin) == pytest.approx((0.576, 0.224, 0.2))


def test_default_weights_follow_straight_fraction():
    circuit = reference_circuit("A")
    w = CircuitWeights.for_circuit(circuit)
    assert w.drag == pytest.approx(0.8 * 0.72)


def test_case_study_corner_ranking_terms(vehicle, env, setups):
    ranking = rank_setups(vehicle, setups, _circuit(), CircuitWeights(0.5, 0.3, 0.2), env)
    a, b = ranking.entries
    assert a.eligible and b.eligible
    assert a.drag_penalty == 0.0
    assert b.drag_penalty == pytest.approx(1 - 0.8 / 1.1)
    assert b.grip_penalty == 0.0
    assert a.grip_penalty == pytest.approx(
        1 - a.evaluation.grip_capacity / b.evaluation.grip_capacity
    )
    assert a.margin_penalty == pytest.approx(1 - 1.2394 / 1.3428, abs=1e-4)
    for entry in ranking.entries:
        parts = entry.contributions(ranking.weights)
        assert sum(parts.values()) == pytest.approx(entry.score)
        assert 0 <= entry.score < 1


def test_gate_excludes_infeasible_and_ungated_does_not(vehicle, env, setups):
    tight = _circuit(radius=40.0, speed=30.0)  # demand 18 kN; A has 14.9 kN, B 16.1 kN
    strict = rank_setups(vehicle, setups, tight, environment=env)
    assert not any(e.eligible for e in strict.entries)
    assert strict.best is None
    ungated = rank_setups(vehicle, setups, tight, environment=env, gate="none")
    assert all(e.eligible for e in ungated.entries)
    assert ungated.best is not None


def test_gate_removes_only_the_failing_setup(vehicle, env, setups):
    # Demand 15.0 kN: A (14.87 kN) fails, B (16.11 kN) passes.
    circuit = _circuit(radius=48.0, speed=30.0)
    ranking = rank_setups(vehicle, setups, circuit, environment=env)
    a, b = ranking.entries
    assert not a.eligible and a.score is None and a.rank is None
    assert b.eligible and b.rank == 1 and b.score == 0.0
    assert ranking.best.name == "Setup B"
    assert [e.name for e in ranking.ordered] == ["Setup B", "Setup A"]


def test_minmax_normalisation(vehicle, env, setups):
    ranking = rank_setups(
        vehicle, setups, _circuit(), CircuitWeights(1, 0, 0), env, normalisation="minmax"
    )
    assert [e.drag_penalty for e in ranking.entries] == [0.0, 1.0]


def test_identical_setups_tie(vehicle, env):
    twins = [AeroSetup("X", 1.0, 3.0), AeroSetup("Y", 1.0, 3.0)]
    ranking = rank_setups(vehicle, twins, _circuit(), environment=env)
    assert [e.rank for e in ranking.entries] == [1, 1]
    minmax = rank_setups(vehicle, twins, _circuit(), environment=env, normalisation="minmax")
    assert [e.score for e in minmax.entries] == [0.0, 0.0]


def test_competition_ranks():
    assert competition_ranks([0.3, 0.1, 0.3, 0.2]) == [3, 1, 3, 2]


def test_duplicate_names_rejected(vehicle, env):
    with pytest.raises(ValueError):
        rank_setups(
            vehicle, [AeroSetup("X", 1, 2), AeroSetup("X", 1, 3)], _circuit(), environment=env
        )


def test_binding_corner_is_the_minimum_ratio(vehicle, env, setups):
    circuit = reference_circuit("C")
    ev = evaluate_circuit(vehicle, setups[0], circuit, env)
    ratios = [c.available_grip / c.required_force for c in ev.corners]
    assert ev.grip_ratio == min(ratios)
    assert ev.corners[ev.binding_corner].radius == pytest.approx(60.0)
    assert ev.corner_label(ev.binding_corner) == "T1"


def test_reference_circuits_rank_as_expected(vehicle, env, setups):
    """Low drag wins on the high-speed and balanced layouts, high downforce on the technical one."""
    winners = {
        k: rank_setups(vehicle, setups, reference_circuit(k), environment=env).best.name
        for k in "ABC"
    }
    assert winners == {"A": "Setup A", "B": "Setup A", "C": "Setup B"}
