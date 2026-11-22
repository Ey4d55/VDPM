"""Equations of Sec. 4 and their closed-form consequences."""

from __future__ import annotations

import math

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from vdpm import AeroSetup, Environment, Vehicle, evaluate_corner, physics

masses = st.floats(500, 1200)
areas = st.floats(0.8, 2.5)
frictions = st.floats(0.6, 2.2)
cds = st.floats(0.3, 2.0)
# Subnormal coefficients are not physical and only probe floating-point underflow.
cdfs = st.floats(0.0, 6.0, allow_subnormal=False)
speeds = st.floats(5.0, 110.0)
radii = st.floats(10.0, 800.0)
densities = st.floats(0.9, 1.4)


def _case(m, a, mu, cd, cdf, rho):
    return Vehicle(m, a, mu), AeroSetup("x", cd, cdf), Environment(rho, 9.81)


def test_forces_scale_with_speed_squared():
    f1 = physics.drag(1.225, 20, 1.0, 1.5)
    f2 = physics.drag(1.225, 40, 1.0, 1.5)
    assert f2 == pytest.approx(4 * f1)


def test_margin_definition_and_reserve(vehicle, env):
    res = evaluate_corner(vehicle, AeroSetup("x", 1.0, 3.0), 35, 80, env)
    assert res.reserve_force == pytest.approx(res.available_grip - res.required_force)
    assert res.margin == pytest.approx(res.reserve_force / res.required_force)
    assert res.max_lateral_acceleration == pytest.approx(res.available_grip / vehicle.mass)


@settings(max_examples=300, deadline=None)
@given(masses, areas, frictions, cds, cdfs, radii, densities)
def test_margin_is_zero_at_max_cornering_speed(m, a, mu, cd, cdf, r, rho):
    vehicle, setup, env = _case(m, a, mu, cd, cdf, rho)
    k = physics.downforce_factor(rho, cdf, a)
    v_max = physics.max_cornering_speed(m, r, mu, 9.81, k)
    if math.isinf(v_max):
        assert r >= physics.critical_radius(m, mu, k)
        return
    assume(v_max < 1e4)
    res = evaluate_corner(vehicle, setup, v_max, r, env)
    assert res.margin == pytest.approx(0.0, abs=1e-9)
    assert res.grip_limited


@settings(max_examples=300, deadline=None)
@given(masses, areas, frictions, cds, cdfs, speeds, radii, densities)
def test_feasible_iff_speed_not_above_limit(m, a, mu, cd, cdf, v, r, rho):
    vehicle, setup, env = _case(m, a, mu, cd, cdf, rho)
    res = evaluate_corner(vehicle, setup, v, r, env)
    assume(abs(res.margin) > 1e-9)
    assert res.feasible == (v <= res.max_cornering_speed)
    if not res.grip_limited:
        assert res.feasible


@settings(max_examples=300, deadline=None)
@given(masses, areas, frictions, cds, cdfs, speeds, radii, densities)
def test_thresholds_put_the_corner_exactly_on_the_limit(m, a, mu, cd, cdf, v, r, rho):
    vehicle, setup, env = _case(m, a, mu, cd, cdf, rho)
    res = evaluate_corner(vehicle, setup, v, r, env)
    at_mu = evaluate_corner(Vehicle(m, a, res.min_friction), setup, v, r, env)
    assert at_mu.margin == pytest.approx(0.0, abs=1e-9)
    at_r = evaluate_corner(vehicle, setup, v, res.min_radius, env)
    assert at_r.margin == pytest.approx(0.0, abs=1e-9)
    if res.min_downforce_coefficient > 0:
        at_cdf = evaluate_corner(
            vehicle, AeroSetup("y", cd, res.min_downforce_coefficient), v, r, env
        )
        assert at_cdf.margin == pytest.approx(0.0, abs=1e-9)
    else:
        assert evaluate_corner(vehicle, AeroSetup("y", cd, 0.0), v, r, env).feasible
    # A mass limit below 1 kg means downforce is negligible; the check is then ill-conditioned.
    if 1.0 < res.max_mass < math.inf:
        at_m = evaluate_corner(Vehicle(res.max_mass, a, mu), setup, v, r, env)
        assert at_m.margin == pytest.approx(0.0, abs=1e-9)


def test_critical_radius_of_manuscript_setups(vehicle, env):
    for setup, expected in ((AeroSetup("A", 0.8, 2.5), 232.2), (AeroSetup("B", 1.1, 3.5), 165.9)):
        res = evaluate_corner(vehicle, setup, 30, 60, env)
        assert res.critical_radius == pytest.approx(expected, abs=0.05)
        assert res.critical_radius == pytest.approx(
            2
            * vehicle.mass
            / (
                vehicle.friction
                * env.air_density
                * setup.downforce_coefficient
                * vehicle.reference_area
            )
        )


def test_no_downforce_has_infinite_critical_radius(vehicle, env):
    res = evaluate_corner(vehicle, AeroSetup("flat", 0.5, 0.0), 30, 60, env)
    assert math.isinf(res.critical_radius)
    assert res.grip_limited
    assert res.max_cornering_speed == pytest.approx(math.sqrt(vehicle.friction * env.gravity * 60))


def test_beyond_critical_radius_every_speed_is_feasible(vehicle, env):
    setup = AeroSetup("B", 1.1, 3.5)
    for v in (10, 50, 100, 300):
        res = evaluate_corner(vehicle, setup, v, 200, env)
        assert res.feasible and not res.grip_limited
        assert math.isinf(res.max_cornering_speed)


@pytest.mark.parametrize("bad", [0, -1, math.inf, math.nan])
def test_invalid_state_is_rejected(vehicle, env, bad):
    with pytest.raises(ValueError):
        evaluate_corner(vehicle, AeroSetup("x", 1, 1), bad, 60, env)
    with pytest.raises(ValueError):
        evaluate_corner(vehicle, AeroSetup("x", 1, 1), 30, bad, env)


@pytest.mark.parametrize(
    "factory",
    [
        lambda: Vehicle(0, 1.5, 1.5),
        lambda: Vehicle(800, -1, 1.5),
        lambda: Vehicle(800, 1.5, math.nan),
        lambda: AeroSetup("x", 0, 1),
        lambda: AeroSetup("x", 1, -0.1),
        lambda: AeroSetup("", 1, 1),
        lambda: Environment(0, 9.81),
    ],
)
def test_invalid_models_are_rejected(factory):
    with pytest.raises(ValueError):
        factory()


def test_negligible_downforce_has_no_critical_radius(vehicle, env):
    """A downforce coefficient so small that mu * k underflows must not divide by zero."""
    res = evaluate_corner(vehicle, AeroSetup("tiny", 1.0, 5e-324), 5.0, 10.0, env)
    assert res.critical_radius == math.inf
    assert res.grip_limited
