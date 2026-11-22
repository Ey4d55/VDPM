# Data formats

Every input can be supplied as a small text file. Examples of each format are in [`data/`](../data). The Python package and the dashboard read the same formats.

## Circuit (segment CSV)

One row per segment, in lap order, starting after the start/finish line.

| Column | Required | Unit | Meaning |
| --- | --- | --- | --- |
| `name` | no | | Label shown in tables and explanations, e.g. `Turn 1` |
| `kind` | yes | | `corner` or `straight` |
| `length_m` | yes | m | Length along the racing line, > 0 |
| `radius_m` | corners only | m | Corner radius, > 0; empty for straights |
| `speed_mps` | yes | m/s | Reference speed in the segment, > 0 |
| `grade` | no | | Road gradient, recorded but not used by the model |

At least one corner is required. Corner speeds are inputs, so they should come from telemetry, a lap simulation or a stated assumption, and the source should be recorded (the `provenance` argument of `vdpm.circuits.circuit_from_csv`).

Example: [`data/circuits/example_circuit.csv`](../data/circuits/example_circuit.csv) (illustrative). The reference circuits written by `vdpm research` (`results/circuits/`) use the same format.

```bash
vdpm rank --circuit-csv data/circuits/example_circuit.csv --setups data/setups_manuscript.csv
```

## Setups (CSV)

| Column | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Unique setup name |
| `C_D` | yes | Drag coefficient, > 0 |
| `C_DF` | yes | Downforce coefficient, ≥ 0 (positive for downforce) |
| `description` | no | Short description |
| `front_wing_deg`, `rear_wing_deg` | no | Wing angles, recorded for reference |
| `source` | no | Where the coefficients come from |

Both coefficients must refer to the vehicle's reference area `A`.

Example: [`data/setups_manuscript.csv`](../data/setups_manuscript.csv), the two setups of Table 1.

## CFD force histories

- **OpenFOAM** `forceCoeffs` output (`coefficient.dat`): `#` comment lines, a header line beginning `# Time` (or `# Iteration`), then whitespace-separated columns. Comment lines of the form `# key : value` (for example `# Aref : 1.5`) are kept as metadata.
- **ANSYS Fluent** report files (`.out`): a quoted title, a quoted column header such as `"Iteration" "cd-1" "cl-1"`, then numeric rows.

The converged coefficient is the mean over the final fraction of samples (10 % by default). The reader also reports the standard deviation and the drift between the first and second half of the window; a drift above 1 % suggests the run has not converged. Lift is converted to downforce with `C_DF = −C_L` unless the column already holds downforce.

```python
from vdpm.cfd_io import read_openfoam_force_coeffs, converged_coefficients

history = read_openfoam_force_coeffs("data/cfd_examples/synthetic_forceCoeffs.dat")
print(converged_coefficients(history, "Cd", "Cl", window=0.1))
```

[`data/cfd_examples/synthetic_forceCoeffs.dat`](../data/cfd_examples/synthetic_forceCoeffs.dat) is a synthetic history generated to demonstrate the reader. It is not CFD output.

## Wing-angle sweep (CSV)

Columns `angle_deg`, `C_D`, `C_DF`, at least two distinct angles. Coefficients between measured angles are interpolated linearly; angles outside the measured range are rejected rather than extrapolated.

[`data/cfd_examples/synthetic_wing_sweep.csv`](../data/cfd_examples/synthetic_wing_sweep.csv) is synthetic.

## Scenario files (dashboard)

The dashboard's **Save scenario** button writes a JSON file with format identifier `vdpm-scenario/1`. It holds every input (vehicle, environment, setups, circuit or imported circuit, corner demand, weights, normalisation, gate), the resulting ranking and the software version. **Open scenario** restores the exact state. Attaching the scenario file to a result makes it reproducible by anyone with the dashboard.
