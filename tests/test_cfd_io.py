"""Importers for OpenFOAM, Fluent and CSV. Sample files are synthetic."""

from __future__ import annotations

import pytest

from vdpm.cfd_io import (
    WingSweep,
    converged_coefficients,
    read_fluent_report,
    read_openfoam_force_coeffs,
    read_setups_csv,
    read_wing_sweep_csv,
)

OPENFOAM_ESI = """# Force coefficients
# dragDir     : (1 0 0)
# liftDir     : (0 0 1)
# magUInf     : 30
# lRef        : 3.6
# Aref        : 1.5
#
# Time\tCd\tCd(f)\tCd(r)\tCl\tCl(f)\tCl(r)
1\t0.95\t0.4\t0.55\t-2.0\t-1.0\t-1.0
2\t0.82\t0.4\t0.42\t-2.4\t-1.2\t-1.2
3\t0.80\t0.4\t0.40\t-2.5\t-1.25\t-1.25
4\t0.80\t0.4\t0.40\t-2.5\t-1.25\t-1.25
"""

OPENFOAM_FOUNDATION = """# Time      Cm        Cd        Cl        Cl(f)     Cl(r)
100  0.1  1.10  -3.50  -1.75  -1.75
200  0.1  1.10  -3.50  -1.75  -1.75
"""

FLUENT = """"cd-cl-rfile"
"Iteration" "cd-1" "cl-1"
("Iteration" "cd-1" "cl-1")
1 1.3 -2.0
2 1.12 -3.4
3 1.10 -3.5
4 1.10 -3.5
"""


def test_openfoam_esi_format():
    hist = read_openfoam_force_coeffs(OPENFOAM_ESI)
    assert hist.index == (1, 2, 3, 4)
    assert hist.metadata["Aref"] == "1.5"
    res = converged_coefficients(hist, "Cd", "Cl", window=0.5)
    assert res.samples == 2
    assert res.drag_coefficient == pytest.approx(0.80)
    assert res.downforce_coefficient == pytest.approx(2.50)
    assert res.drag_std == pytest.approx(0.0)


def test_openfoam_foundation_format():
    hist = read_openfoam_force_coeffs(OPENFOAM_FOUNDATION)
    res = converged_coefficients(hist, "Cd", "Cl", window=1.0)
    assert (res.drag_coefficient, res.downforce_coefficient) == pytest.approx((1.10, 3.50))
    setup = res.to_setup("Setup B")
    assert setup.efficiency == pytest.approx(3.5 / 1.1)


def test_fluent_report_and_lift_sign():
    hist = read_fluent_report(FLUENT)
    assert hist.metadata["title"] == "cd-cl-rfile"
    res = converged_coefficients(hist, "cd-1", "cl-1", window=0.5)
    assert res.downforce_coefficient == pytest.approx(3.5)
    flipped = converged_coefficients(hist, "cd-1", "cl-1", window=0.5, lift_sign=1.0)
    assert flipped.downforce_coefficient == pytest.approx(-3.5)


def test_missing_column_is_explained():
    hist = read_fluent_report(FLUENT)
    with pytest.raises(KeyError, match="available"):
        converged_coefficients(hist, "Cd", "cl-1")


def test_drift_detects_unconverged_history():
    hist = read_openfoam_force_coeffs(OPENFOAM_ESI)
    res = converged_coefficients(hist, "Cd", "Cl", window=1.0)
    assert res.drag_drift > 0.05


def test_setups_csv():
    setups = read_setups_csv(
        "name,C_D,C_DF,description,rear_wing_deg\nA,0.8,2.5,Low drag,6\nB,1.1,3.5,,\n"
    )
    assert [s.name for s in setups] == ["A", "B"]
    assert setups[0].rear_wing_angle_deg == 6.0 and setups[1].rear_wing_angle_deg is None


def test_wing_sweep_interpolation_and_no_extrapolation():
    sweep = read_wing_sweep_csv(
        "angle_deg,C_D,C_DF\n8,0.9,2.9\n0,0.78,1.7\n16,1.2,3.5\n", label="rear"
    )
    assert sweep.angles_deg == (0.0, 8.0, 16.0)
    cd, cdf = sweep.coefficients_at(4.0)
    assert (cd, cdf) == pytest.approx((0.84, 2.3))
    assert sweep.coefficients_at(16.0) == pytest.approx((1.2, 3.5))
    with pytest.raises(ValueError, match="outside"):
        sweep.coefficients_at(18.0)
    assert sweep.setup_at(12.0).rear_wing_angle_deg == 12.0
    with pytest.raises(ValueError):
        WingSweep((0.0, 0.0), (1.0, 1.0), (1.0, 1.0))
