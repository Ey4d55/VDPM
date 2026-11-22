"""Processing-time measurements (proposal: "measure processing time").

Timings use :func:`time.perf_counter_ns`, report the median and interquartile
range over repeated batches, and record the interpreter and machine so the
numbers can be reported with their context.
"""

from __future__ import annotations

import platform
import statistics
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass

from .. import reference
from ..circuits import reference_circuit
from ..models import AeroSetup
from ..physics import evaluate_corner
from ..scoring import rank_setups

__all__ = ["TimingResult", "environment_description", "run_timings"]


@dataclass(frozen=True, slots=True)
class TimingResult:
    task: str
    median_us: float
    q1_us: float
    q3_us: float
    repeats: int
    calls_per_repeat: int


def environment_description() -> dict[str, str]:
    return {
        "python": sys.version.split()[0],
        "implementation": platform.python_implementation(),
        "machine": platform.machine(),
        "processor": platform.processor() or "unknown",
        "system": f"{platform.system()} {platform.release()}",
    }


def _time(task: str, fn: Callable[[], object], calls: int, repeats: int) -> TimingResult:
    for _ in range(max(1, calls // 10)):  # warm-up
        fn()
    samples = []
    for _ in range(repeats):
        start = time.perf_counter_ns()
        for _ in range(calls):
            fn()
        samples.append((time.perf_counter_ns() - start) / calls / 1000.0)
    q = statistics.quantiles(samples, n=4)
    return TimingResult(task, statistics.median(samples), q[0], q[2], repeats, calls)


def run_timings(repeats: int = 15) -> list[TimingResult]:
    """Time the core operations on the reference inputs."""
    vehicle, env = reference.VEHICLE, reference.ENVIRONMENT
    setup = reference.SETUP_A
    results = [
        _time(
            "one setup, one corner (evaluate_corner)",
            lambda: evaluate_corner(vehicle, setup, 30.0, 60.0, env),
            calls=2000,
            repeats=repeats,
        )
    ]
    circuit = reference_circuit("C")
    for n in (2, 10, 50):
        setups = [
            AeroSetup(f"S{i}", 0.7 + 0.5 * i / max(1, n - 1), 2.0 + 2.0 * i / max(1, n - 1))
            for i in range(n)
        ]
        calls = max(5, 400 // n)
        results.append(
            _time(
                f"rank {n} setups on Circuit C ({len(circuit.corners)} corners)",
                lambda s=setups: rank_setups(vehicle, s, circuit, environment=env),  # type: ignore[misc]
                calls=calls,
                repeats=repeats,
            )
        )
    return results
