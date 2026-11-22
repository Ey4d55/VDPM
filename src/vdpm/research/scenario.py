"""A perturbable description of one evaluation scenario.

Sensitivity and uncertainty experiments all start from the manuscript's
reference inputs and scale individual parameters by multipliers. Keeping the
construction in one place guarantees every experiment perturbs inputs in the
same, documented way.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace

from .. import reference
from ..circuits import CASE_STUDY_LATERAL_ACCELERATION, REFERENCE_SUMMARIES, synthetic_circuit
from ..models import AeroSetup, Circuit, Environment, Vehicle
from ..scoring import Ranking, rank_setups

__all__ = ["PARAMETERS", "Scenario"]

#: Parameters that experiments may scale, with their symbol in the manuscript.
PARAMETERS: dict[str, str] = {
    "friction": "mu",
    "mass": "m",
    "air_density": "rho",
    "reference_area": "A",
    "drag_coefficient": "C_D",
    "downforce_coefficient": "C_DF",
    "lateral_acceleration": "a_ref",
}


@dataclass(frozen=True, slots=True)
class Scenario:
    """Reference inputs plus multipliers.

    ``multipliers`` scales shared parameters; ``setup_multipliers`` maps a setup
    name to its own ``(C_D, C_DF)`` multipliers, applied on top of the shared ones.
    """

    circuit_key: str
    setups: Sequence[AeroSetup] = (reference.SETUP_A, reference.SETUP_B)
    vehicle: Vehicle = reference.VEHICLE
    environment: Environment = reference.ENVIRONMENT
    lateral_acceleration: float = CASE_STUDY_LATERAL_ACCELERATION
    multipliers: Mapping[str, float] = field(default_factory=dict)
    setup_multipliers: Mapping[str, tuple[float, float]] = field(default_factory=dict)

    def scaled(self, **multipliers: float) -> Scenario:
        unknown = set(multipliers) - set(PARAMETERS)
        if unknown:
            raise ValueError(f"unknown parameter(s): {sorted(unknown)}")
        merged = dict(self.multipliers)
        for key, value in multipliers.items():
            merged[key] = merged.get(key, 1.0) * value
        return replace(self, multipliers=merged)

    def _m(self, key: str) -> float:
        return self.multipliers.get(key, 1.0)

    def build(self) -> tuple[Vehicle, list[AeroSetup], Circuit, Environment]:
        vehicle = Vehicle(
            mass=self.vehicle.mass * self._m("mass"),
            reference_area=self.vehicle.reference_area * self._m("reference_area"),
            friction=self.vehicle.friction * self._m("friction"),
        )
        env = replace(
            self.environment, air_density=self.environment.air_density * self._m("air_density")
        )
        setups = []
        for s in self.setups:
            own_cd, own_cdf = self.setup_multipliers.get(s.name, (1.0, 1.0))
            setups.append(
                replace(
                    s,
                    drag_coefficient=s.drag_coefficient * self._m("drag_coefficient") * own_cd,
                    downforce_coefficient=s.downforce_coefficient
                    * self._m("downforce_coefficient")
                    * own_cdf,
                )
            )
        circuit = synthetic_circuit(
            REFERENCE_SUMMARIES[self.circuit_key],
            self.lateral_acceleration * self._m("lateral_acceleration"),
        )
        return vehicle, setups, circuit, env

    def rank(self, gate: str = "strict") -> Ranking:
        vehicle, setups, circuit, env = self.build()
        return rank_setups(vehicle, setups, circuit, environment=env, gate=gate)  # type: ignore[arg-type]
