# Versions

Exact versions used to produce the published results (vdpm 0.1.0, seed 20261122). The Python package has no runtime dependencies. `web/package-lock.json` pins every JavaScript dependency, including transitive ones.

## Python

| Component | Version used | Required | Purpose |
| --- | --- | --- | --- |
| Python (CPython) | 3.13.18 | ≥ 3.10 | Language and runtime |
| Standard library (`math`, `dataclasses`, `csv`, `json`, `argparse`, `random`) | with Python | — | Model, I/O, CLI, seeded random numbers |
| NumPy | 2.5.3 | ≥ 1.24 (optional, `research` extra) | Array operations for figures |
| Matplotlib | 3.11.2 | ≥ 3.7 (optional, `research` extra) | Publication figures |
| pytest | 9.1.1 | ≥ 8 (dev) | Test runner |
| Hypothesis | 6.170.17 | ≥ 6 (dev) | Property-based tests |
| Ruff | 0.16.9 | ≥ 0.5 (dev) | Linting and formatting |
| mypy | 2.3.1 | ≥ 1.10 (dev) | Strict static type checking |
| Hatchling | latest at install | ≥ 1.24 (build) | PEP 517 build backend |

## Web dashboard

| Component | Version used | Purpose |
| --- | --- | --- |
| Node.js | 22.23.5 (≥ 22.12 required) | Build and test runtime |
| TypeScript | 5.9.3 | Language, strict mode |
| React, React DOM | 19.3.1 | User interface |
| d3-scale | 4.0.3 | Chart scales |
| d3-shape | 3.2.1 | Line and area geometry |
| d3-array | 3.2.5 | Array helpers used by d3-scale (declared directly) |
| three | 0.187.0 | 3D track twin (WebGL) |
| KaTeX | 0.16.47 | Equation typesetting |
| @fontsource-variable/inter | 5.3.0 | Interface font, self-hosted |
| @fontsource-variable/jetbrains-mono | 5.3.0 | Monospace font for numbers and code |
| Vite | 8.3.8 | Development server and static build |
| @vitejs/plugin-react | 6.3.0 | React support for Vite |
| Vitest | 5.1.1 | Engine and golden-case tests |

## Infrastructure

| Component | Version | Purpose |
| --- | --- | --- |
| Git | — | Version control |
| GitHub | — | Source hosting: https://github.com/Ey4d55/VDPM |
| GitHub Actions | actions/checkout@v4, setup-python@v5, setup-node@v4, upload-pages-artifact@v3, deploy-pages@v4 | Continuous integration and deployment |
| GitHub Pages | — | Static hosting: https://ey4d55.github.io/VDPM/ |
| Chromium (headless, via Playwright) | — | Screenshot review and browser timing during development; not needed to use or build the platform |

## Supported browsers

Any current version of Chrome, Edge, Firefox or Safari. The dashboard uses standard ES2022 JavaScript modules and SVG, and needs no plug-ins.
