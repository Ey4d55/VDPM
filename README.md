# VDPM-RaceTwin

Physics-constrained, circuit-aware screening of Formula 1 aerodynamic setups.

VDPM-RaceTwin is the software that accompanies the manuscript *VDPM: Vehicle Dynamics Performance Metric*. It turns the manuscript's model into two things:

- **`vdpm`**, a Python package with no runtime dependencies. It is the reference implementation of the model, the feasibility gate and the VDPM score, plus a research suite that regenerates every table and figure used as evidence.
- **The RaceTwin dashboard**, a static web application that runs an independent TypeScript implementation of the same model in the browser. Its seven views show the recommendation, the circuit, the forces at a single corner, the setups, what-if analysis, the verification evidence and the method.

**Live dashboard:** https://ey4d55.github.io/VDPM/ · **Source:** https://github.com/Ey4d55/VDPM

The two implementations agree bit for bit on 400 corner cases and 72 circuit rankings (29,080 values, maximum relative difference 0).

## Contents

```
src/vdpm/            Python reference implementation
  models.py          Vehicle, Environment, AeroSetup, Segment, Circuit
  physics.py         Eqs. 4.1 to 4.5 and their closed-form consequences
  scoring.py         Circuit evaluation, feasibility gate, VDPM score, ranking
  explain.py         Analytic margin sensitivities, weight flip point, findings
  baselines.py       Drag-only, downforce-only and efficiency-only rankings
  circuits.py        Reference circuits A, B, C and the segment CSV format
  cfd_io.py          OpenFOAM and Fluent force histories, wing-angle sweeps
  reference.py       Tables 1 and 2 of the manuscript
  golden.py          Cross-implementation test cases
  research/          Verification, timing, sensitivity, Monte Carlo, figures
  cli.py             The `vdpm` command
tests/               63 tests, including property-based tests (Hypothesis)
golden/              Golden cases (Python) and the browser engine's outputs
results/             Output of `vdpm research`: report, tables, figures
web/                 The RaceTwin dashboard (React, TypeScript, Vite)
data/                Example input files in every supported format
docs/                Method, reproducibility, data formats, tech stack
```

## Quick start

### Python

Python 3.10 or newer.

```bash
pip install -e ".[research]"     # numpy and matplotlib, needed only for figures
vdpm table2                      # recompute Table 2 of the manuscript
vdpm rank --circuit C            # rank the Table 1 setups on Circuit C
vdpm rank --circuit-csv data/circuits/example_circuit.csv --setups data/setups_manuscript.csv
vdpm research --out results      # regenerate every table, figure and the report
```

For development: `pip install -e ".[dev]"`, then `pytest`, `ruff check .` and `mypy`.

### Dashboard

Node.js 22.12 or newer.

```bash
cd web
npm ci
npm run dev        # local server with hot reload
npm test           # engine tests, including the golden cases
npm run build      # static site in web/dist
```

The built site is plain static files with relative paths. Opening `web/dist/index.html` straight from disk does not work, because browsers block JavaScript modules on `file://` pages; serve the folder instead, for example with `npm run preview` or `python -m http.server` inside `web/dist`. The live dashboard is rebuilt and published to GitHub Pages on every push to `main` (`.github/workflows/pages.yml`).

The built site It can be served from any static host (GitHub Pages, Zenodo, a university server) or a sub-folder, and needs no backend: every calculation runs in the reader's browser and nothing is uploaded.

## The model in brief

At each corner, with speed `v` and radius `r`:

| Quantity | Equation |
| --- | --- |
| Drag | F_D = ½ ρ v² C_D A |
| Downforce | F_DF = ½ ρ v² C_DF A |
| Required lateral force | F_c = m v² / r |
| Available grip | F_grip = μ (m g + F_DF) |
| Safety margin | M = (F_grip − F_c) / F_c, feasible if M ≥ 0 |

A setup is eligible on a circuit only if it is feasible at every corner. Eligible setups are ranked by

S = w_D · d + w_G · q + w_M · z

where `d`, `q` and `z` are ratio-to-best penalties on lap drag exposure, cornering grip and the grip-to-demand ratio at the tightest corner, and the weights follow the circuit's straight fraction `s`: w_D = (1 − w_M) s, w_G = (1 − w_M)(1 − s), w_M = 0.2. The lowest score ranks first.

The full definition, the derived quantities and the assumptions are in [docs/method.md](docs/method.md).

## Verification

- **Table 2.** All ten published values are reproduced within their printed resolution; the recomputed values match an independent hand calculation to 1.2 × 10⁻¹⁶ (`vdpm table2`, `results/tables/verification_table2.csv`).
- **Unit and property tests.** 63 Python tests, including property-based tests of scaling laws and of every feasibility threshold (`pytest`).
- **Two implementations.** `vdpm golden` writes `golden/cases.json`. The TypeScript engine must reproduce every value (`npm test`), its outputs are compared value by value in the research report, and readers can rerun the comparison in the dashboard's Research view.

## Results

`results/REPORT.md` summarises the research suite: verification, processing time, one-at-a-time ranking robustness, Monte Carlo ranking stability with Wilson intervals, the comparison with single-criterion baselines (hypothesis H1) and a corner-demand sweep. Figures are written as PNG (300 dpi), SVG and PDF. All results use seed 20261122 and are regenerated with one command.

## Reference circuits

Circuits A, B and C are synthetic layouts that reproduce the summary statistics of Fig. 5b of the manuscript exactly (length, number of turns, straight fraction, mean corner radius). Segment radii, lengths and speeds are modelling assumptions, not measured track data; see [docs/method.md](docs/method.md#reference-circuits). Real circuits can be supplied as segment CSV files ([docs/data-formats.md](docs/data-formats.md)).

## Limitations

VDPM is a quasi-steady, point-mass screening model. It has no lap-time simulation, uses a single friction coefficient, and does not model load transfer, tyre load sensitivity, aero balance or elevation. It is meant to narrow down setups before detailed simulation and testing, not to replace them. See [docs/method.md](docs/method.md#assumptions-and-limitations).

## Citation and licence

Please cite the VDPM manuscript and state the software version (0.1.0) and the scenario file used. A citation file, archive DOI and licence will be added on publication.
