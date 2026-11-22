# Tech stack

VDPM-RaceTwin has two parts that implement the same model independently: a Python reference package and a browser dashboard written in TypeScript. This folder records every technology used, the exact versions behind the published results, and why each was chosen.

| File | Contents |
| --- | --- |
| [README.md](README.md) | Overview and design rationale (this page) |
| [versions.md](versions.md) | Every language, library and tool with the exact version used |
| [stack.json](stack.json) | The same inventory in machine-readable form |

## At a glance

| Layer | Technology | Role |
| --- | --- | --- |
| Model, reference implementation | Python 3.10+ (standard library only) | Equations 4.1 to 4.5, feasibility gate, VDPM score, circuits, CFD import, CLI |
| Research suite and figures | NumPy, Matplotlib | Monte Carlo, sensitivity, H1 comparison, publication figures (PNG, SVG, PDF) |
| Python quality | pytest, Hypothesis, Ruff, mypy (strict) | Unit and property-based tests, linting, formatting, static typing |
| Model, browser implementation | TypeScript 5.9 | Independent port of the model, checked against the Python golden cases |
| User interface | React 19 | The seven dashboard workspaces |
| Charts | D3 (d3-scale, d3-shape) with hand-written SVG | Every chart, the lap ring and the decision map |
| 3D track twin | three.js | Schematic 3D lap with the car, grip columns and friction circle |
| Equations | KaTeX | Typeset equations in the Method workspace |
| Typography | Inter, JetBrains Mono (self-hosted variable fonts) | Interface text and numbers |
| Build and tests | Vite 8, Vitest 5, Node.js 22 | Development server, static build, engine tests |
| Hosting | GitHub Pages (static files) | Public dashboard, no server |
| Continuous integration | GitHub Actions | Python checks on 3.10 and 3.13; dashboard tests, build and deploy |
| Packaging | Hatchling (PEP 517), npm lockfile | Python package build; pinned JavaScript dependencies |

## Architecture in one paragraph

The Python package `vdpm` is the reference. It writes golden cases (400 corner evaluations and 72 circuit rankings) that the TypeScript engine must reproduce to a relative tolerance of 10⁻¹². In practice the two agree exactly on all 29,080 values compared. The dashboard is a static site: every calculation runs in the reader's browser, nothing is uploaded and no backend is needed. The research suite regenerates every table and figure with one command and a fixed seed.

## Why these choices

**Python with no runtime dependencies for the model.** Python is the common language of engineering research, so reviewers can read and rerun the reference implementation. Using only the standard library (with `math.fsum` for correctly rounded sums) means the core installs anywhere and will keep working for years. NumPy and Matplotlib are optional extras used only to draw figures.

**A second, independent implementation in TypeScript.** Running the model in the browser makes the platform interactive with no server to maintain, which matters for a tool that must stay available as long as the paper is cited. Writing it as a separate port, rather than compiling Python to the web, turns it into a verification instrument: two implementations that agree bit for bit are strong evidence that both follow the specification in `docs/method.md`.

**React for the interface.** It is the most widely used UI library, so the code stays maintainable by others, and its component model suits seven workspaces that share one set of inputs and recompute on every change.

**D3 primitives with SVG, not a charting library.** Research figures need precise control over scales, annotations, symbols and export. Using D3 only for scales and path geometry, with SVG written by hand, gives that control, keeps the bundle small, and lets every chart be exported as vector SVG or high-resolution PNG.

**three.js for the track twin.** The most widely used WebGL library, with no build-time tooling and a stable API. It is loaded only when the twin is shown, so the rest of the dashboard stays fast.

**KaTeX for equations.** It renders TeX quickly in the browser without a network service, so the Method workspace shows the same notation as the manuscript.

**Self-hosted fonts.** Inter and JetBrains Mono are bundled with the site, so it looks the same everywhere and makes no requests to third-party font services.

**Vite and Vitest.** Fast builds and a test runner that shares the build configuration. The build uses relative paths, so the site works from any host or sub-folder, including an archive such as Zenodo.

**Strict quality tooling.** Hypothesis checks scaling laws and every feasibility threshold over randomly generated inputs, mypy runs in strict mode, and Ruff enforces one style. These run on every push to `main`.

**GitHub Pages and GitHub Actions.** Free, durable static hosting tied to the source. Each push to `main` reruns the engine tests, rebuilds the site and redeploys it, so the public dashboard always matches the code.
