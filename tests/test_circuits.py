"""Synthetic reference circuits and the segment CSV format."""

from __future__ import annotations

import math

import pytest

from vdpm import REFERENCE_SUMMARIES, circuit_from_csv, circuit_to_csv, reference_circuit
from vdpm.circuits import CASE_STUDY_LATERAL_ACCELERATION


@pytest.mark.parametrize("key", ["A", "B", "C"])
def test_reference_circuits_match_published_statistics(key):
    summary = REFERENCE_SUMMARIES[key]
    circuit = reference_circuit(key)
    assert circuit.length == pytest.approx(summary.length_m, rel=1e-12)
    assert circuit.straight_fraction == pytest.approx(summary.straight_fraction, rel=1e-12)
    assert len(circuit.corners) == summary.turns
    assert circuit.mean_corner_radius == pytest.approx(summary.mean_corner_radius_m, rel=1e-12)
    assert "Synthetic" in circuit.provenance
    for corner in circuit.corners:
        assert corner.speed**2 / corner.radius == pytest.approx(CASE_STUDY_LATERAL_ACCELERATION)


def test_case_study_corner_is_part_of_circuit_c():
    tightest = min(reference_circuit("C").corners, key=lambda s: s.radius)
    assert tightest.radius == pytest.approx(60.0)
    assert tightest.speed == pytest.approx(30.0)


def test_csv_roundtrip_is_exact():
    circuit = reference_circuit("B")
    again = circuit_from_csv(circuit_to_csv(circuit), name=circuit.name)
    assert again.segments == circuit.segments


def test_csv_reports_bad_rows():
    text = "name,kind,length_m,radius_m,speed_mps\nT1,corner,100,,30\n"
    with pytest.raises(ValueError, match="line 2"):
        circuit_from_csv(text)
    with pytest.raises(ValueError, match="kind"):
        circuit_from_csv("name,kind,length_m,radius_m,speed_mps\nX,hairpin,100,50,30\n")
    with pytest.raises(ValueError, match="header"):
        circuit_from_csv("a,b\n1,2\n")


def test_csv_file_path(tmp_path):
    path = tmp_path / "loop.csv"
    path.write_text(
        "name,kind,length_m,radius_m,speed_mps,grade\nT1,corner,120,50,25,0.01\nS1,straight,400,,70,\n"
    )
    circuit = circuit_from_csv(path)
    assert circuit.name == "loop"
    assert circuit.corners[0].grade == pytest.approx(0.01)
    assert math.isclose(circuit.straight_fraction, 400 / 520)
