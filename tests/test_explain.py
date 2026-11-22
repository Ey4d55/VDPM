"""Analytic explanations must agree with brute-force recomputation."""

from __future__ import annotations

import math
from dataclasses import replace

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from vdpm import AeroSetup, CircuitWeights, Environment, Vehicle, evaluate_corner, rank_setups
from vdpm.circuits import reference_circuit
from vdpm.explain import explain_ranking, margin_sensitivities, weight_flip_point


def _margin(vehicle, setup, v, r, env):
    return evaluate_corner(vehicle, setup, v, r, env).margin


def _perturbed(name, factor, vehicle, setup, v, r, env):
    if name in ("mass", "friction", "reference_area"):
        vehicle = replace(vehicle, **{name: getattr(vehicle, name) * factor})
    elif name in ("drag_coefficient", "downforce_coefficient"):
        setup = replace(setup, **{name: getattr(setup, name) * factor})
    elif name in ("air_density", "gravity"):
        env = replace(env, **{name: getattr(env, name) * factor})
    elif name == "speed":
        v *= factor
    elif name == "radius":
        r *= factor
    return _margin(vehicle, setup, v, r, env)


@settings(max_examples=150, deadline=None)
@given(
    st.floats(600, 1000),
    st.floats(1.0, 2.0),
    st.floats(0.8, 2.0),
    st.floats(0.5, 1.5),
    st.floats(0.5, 5.0),
    st.floats(10, 90),
    st.floats(20, 400),
)
def test_sensitivities_match_finite_differences(m, a, mu, cd, cdf, v, r):
    vehicle, setup, env = Vehicle(m, a, mu), AeroSetup("s", cd, cdf), Environment()
    analytic = margin_sensitivities(vehicle, setup, v, r, env)
    h = 1e-6
    for name, value in analytic.items():
        up = _perturbed(name, math.exp(h), vehicle, setup, v, r, env)
        down = _perturbed(name, math.exp(-h), vehicle, setup, v, r, env)
        numeric = (up - down) / (2 * h)
        assert value == pytest.approx(numeric, rel=1e-5, abs=1e-7), name


def test_weight_flip_point_equalises_scores(vehicle, env):
    setups = [AeroSetup("Setup A", 0.8, 2.5), AeroSetup("Setup B", 1.1, 3.5)]
    circuit = reference_circuit("B")
    ranking = rank_setups(vehicle, setups, circuit, environment=env)
    a, b = ranking.entries
    s_star = weight_flip_point(a, b, ranking.weights.margin)
    assert s_star is not None and 0 <= s_star <= 1
    w = CircuitWeights.from_straight_fraction(s_star, ranking.weights.margin)

    def score(e):
        return w.drag * e.drag_penalty + w.grip * e.grip_penalty + w.margin * e.margin_penalty

    assert score(a) == pytest.approx(score(b), abs=1e-12)


def test_explanations_cover_recommendation_and_exclusion(vehicle, env):
    setups = [AeroSetup("Setup A", 0.8, 2.5), AeroSetup("Setup B", 1.1, 3.5)]
    findings = explain_ranking(
        rank_setups(vehicle, setups, reference_circuit("C"), environment=env)
    )
    kinds = [f.kind for f in findings]
    assert "recommendation" in kinds and "runner-up" in kinds
    rec = next(f for f in findings if f.kind == "recommendation")
    assert rec.setup == "Setup B"
    hard = explain_ranking(
        rank_setups(vehicle, setups, reference_circuit("C", 30.0), environment=env)
    )
    assert sum(f.kind == "excluded" for f in hard) == 2
    assert any(f.kind == "no-eligible" for f in hard)
