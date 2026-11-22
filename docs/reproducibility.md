# Reproducibility

Every number, table and figure produced by VDPM-RaceTwin can be regenerated from this repository with fixed inputs and a fixed random seed.

## Regenerating the published results

```bash
pip install -e ".[research]"
vdpm research --out results
```

This writes, in about 15 seconds:

- `results/REPORT.md`: the summary used as evidence in the manuscript;
- `results/summary.json`: every reported number in machine-readable form;
- `results/tables/*.csv`: the full data behind each table and figure;
- `results/figures/*.{png,svg,pdf}`: figures at 300 dpi and as vector files;
- `results/circuits/*.csv`: the synthetic reference circuits as segment files.

The Monte Carlo analysis uses seed 20261122 (`--seed`) and 5,000 samples per circuit (`--samples`). Processing times depend on the machine; the report records the Python version and platform.

To include the cross-implementation comparison in the report, first export the browser engine's outputs and pass them in:

```bash
cd web && VDPM_EXPORT=1 npx vitest run && cd ..
vdpm research --out results --browser-output golden/browser-engine-output.json
```

## Cross-implementation verification

The model exists twice: in Python (`src/vdpm`, the reference) and in TypeScript (`web/src/engine`, used by the dashboard). They were written to the same specification with the same order of floating-point operations and correctly rounded sums.

1. `vdpm golden --out golden/cases.json` writes 400 corner cases (four setups, a grid of speeds and radii, two vehicles, two environments) and 72 circuit rankings (three circuits, two corner demands, three weightings, two normalisations, two gates).
2. `npm test` in `web/` requires the TypeScript engine to reproduce every value to a relative tolerance of 10⁻¹².
3. The research report compares both engines value by value. The current result is 29,080 values with a maximum relative difference of 0.
4. Readers can rerun the comparison in their own browser in the dashboard's Research view.

## Tests and static checks

```bash
pip install -e ".[dev]"
pytest              # 63 tests, including Hypothesis property tests
ruff check .        # lint
ruff format --check .
mypy                # strict type checking
cd web && npm ci && npm test && npm run typecheck
```

## Versions

| Component | Version used for the published results |
| --- | --- |
| vdpm | 0.1.0 |
| Python | 3.13 (supported: 3.10 or newer) |
| numpy, matplotlib | figures only; see `pyproject.toml` |
| Node.js | 22 (dashboard build and tests) |
| React, Vite, TypeScript | see `web/package-lock.json` |

`web/package-lock.json` pins every JavaScript dependency. The Python package has no runtime dependencies.

## Hosting the dashboard

`npm run build` writes a static site to `web/dist` with relative paths. Copy that folder to any static host, or archive it with the repository (for example on Zenodo) so that the version cited in the manuscript stays available.
