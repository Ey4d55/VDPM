"""The manuscript's case study (Tables 1 and 2) must be reproduced exactly."""

from __future__ import annotations

import pytest

from vdpm import reference
from vdpm.cli import main


@pytest.mark.parametrize("index", [0, 1])
def test_table_2_matches_printed_values(index):
    res = reference.reproduce_table_2()[index]
    pub = reference.TABLE_2[index]
    half_f = pub.force_resolution / 2
    assert res.setup == pub.setup
    assert abs(res.drag - pub.drag_n) <= half_f
    assert abs(res.downforce - pub.downforce_n) <= half_f
    assert abs(res.required_force - pub.demand_n) <= half_f
    assert abs(res.available_grip - pub.grip_n) <= half_f
    assert abs(res.margin * 100 - pub.reserve_pct) <= pub.reserve_resolution / 2
    assert res.feasible is pub.feasible


def test_table_2_full_precision():
    a, b = reference.reproduce_table_2()
    # Hand calculation: q = 0.5 * 1.225 * 30^2 = 551.25 Pa; q * A = 826.875 N.
    assert a.drag == pytest.approx(826.875 * 0.80, rel=1e-15)
    assert a.downforce == pytest.approx(826.875 * 2.50, rel=1e-15)
    assert b.drag == pytest.approx(826.875 * 1.10, rel=1e-15)
    assert b.downforce == pytest.approx(826.875 * 3.50, rel=1e-15)
    assert a.required_force == pytest.approx(12000.0, rel=1e-15)
    assert a.available_grip == pytest.approx(1.5 * (800 * 9.81 + 826.875 * 2.5), rel=1e-15)
    assert b.available_grip == pytest.approx(1.5 * (800 * 9.81 + 826.875 * 3.5), rel=1e-15)


def test_relative_differences_reported_in_figures_3_and_6():
    a, b = reference.reproduce_table_2()
    assert (
        reference.SETUP_B.drag_coefficient / reference.SETUP_A.drag_coefficient - 1
        == pytest.approx(0.375)
    )
    assert (
        reference.SETUP_B.downforce_coefficient / reference.SETUP_A.downforce_coefficient - 1
        == pytest.approx(0.40)
    )
    # Same speed and area, so forces scale exactly like coefficients: +37.5 %, not +37.3 %.
    assert b.drag / a.drag - 1 == pytest.approx(0.375, rel=1e-12)
    assert reference.SETUP_A.efficiency == pytest.approx(3.125)
    assert reference.SETUP_B.efficiency == pytest.approx(3.5 / 1.1)
    assert reference.SETUP_B.efficiency / reference.SETUP_A.efficiency - 1 == pytest.approx(
        0.01818, abs=1e-5
    )


def test_cli_table2_passes(capsys):
    assert main(["table2"]) == 0
    assert "all values agree" in capsys.readouterr().out
