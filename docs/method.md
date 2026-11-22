# Method

This document states the model implemented by VDPM-RaceTwin exactly, so that every number the software produces can be reproduced by hand or by an independent implementation. Equation numbers refer to Section 4 of the manuscript. All quantities are SI.

## 1. Corner model

For a vehicle of mass `m`, aerodynamic reference area `A` and effective tyre–road friction coefficient `μ`, in air of density `ρ` and gravity `g`, a setup with drag coefficient `C_D` and downforce coefficient `C_DF` (positive for downforce, `C_DF = −C_L`) taking a corner of radius `r` at speed `v` has:

| | Equation | |
| --- | --- | --- |
| Drag | F_D = ½ ρ v² C_D A | (4.1) |
| Downforce | F_DF = ½ ρ v² C_DF A | (4.2) |
| Required lateral force | F_c = m v² / r | (4.3) |
| Available lateral grip | F_grip = μ (m g + F_DF) | (4.4) |
| Safety margin | M = (F_grip − F_c) / F_c | (4.5) |

The corner is **feasible** if `M ≥ 0`.

### Derived quantities

These follow in closed form and are used for explanations and limits (`vdpm.physics`).

- Maximum lateral acceleration: `a_lat,max = μ (g + F_DF / m)`.
- Downforce factor: `k = ½ ρ C_DF A`, so that `F_DF = k v²`.
- Critical radius: `r* = m / (μ k)`. For `r ≥ r*` the downforce grows at least as fast as the demand and the model sets no grip-limited speed (reported as unbounded). A setup with no downforce has `r* = ∞`.
- Grip-limited cornering speed, for `r < r*`: `v_max = √( μ m g / (m / r − μ k) )`.
- Feasibility limits at a given corner, each the value at which `M = 0` with all other inputs fixed:
  - smallest radius `r_min = m v² / F_grip`;
  - lowest friction `μ_min = F_c / (m g + F_DF)`;
  - highest mass `m_max = μ F_DF / (v² / r − μ g)`, unbounded when `v² / r ≤ μ g`;
  - lowest downforce coefficient `C_DF,min = max(0, (F_c / μ − m g) / (½ ρ v² A))`.
- Margin sensitivities. Writing `R = 1 + M = μ r (g / v² + k / m)`, every elasticity `∂M / ∂ln x` is analytic. With `a = g / v²` and `b = k / m`: friction and radius `R`; speed `−2 R a / (a + b)`; mass `−R b / (a + b)`; air density, `C_DF` and area `R b / (a + b)`; gravity `R a / (a + b)`; `C_D` zero.

## 2. Circuit evaluation

A circuit is an ordered list of segments `i`, each a straight or a corner, with length `L_i` and reference speed `v_i`; corners also have a radius `r_i`. For setup `j`:

- **Drag exposure** (length-weighted mean drag over the lap):
  `D_j = Σ_i L_i F_D,j(v_i) / Σ_i L_i`
- **Grip capacity** (length-weighted mean available grip over the corners):
  `G_j = Σ_corners L_i F_grip,j(v_i) / Σ_corners L_i`
- **Grip ratio** at the tightest corner:
  `R_j = min_corners F_grip,j / F_c = 1 + min_corners M_ij`

The corner where `R_j` is attained is the **binding corner**. Sums use correctly rounded summation (`math.fsum` in Python, a Shewchuk sum in TypeScript), so both implementations produce identical results.

## 3. The VDPM score

The manuscript describes the score qualitatively. The definition below is the one implemented by the software. Each choice is a parameter, so an alternative definition can be selected without changing code.

### Feasibility gate

With the strict gate (default), setup `j` is **eligible** only if `R_j ≥ 1`, that is, if it is feasible at every corner. Ineligible setups receive no score or rank and are reported with the corner that fails them. With the gate switched off, every setup is scored; this mode exists to quantify what the gate prevents.

### Penalties

Over the eligible setups, each metric is turned into a dimensionless penalty that is 0 for the best setup on that metric.

Ratio to best (default), values in [0, 1):

```
d_j = 1 − min_k D_k / D_j
q_j = 1 − G_j / max_k G_k
z_j = 1 − R_j / max_k R_k
```

Min–max (alternative): each metric is mapped linearly to [0, 1] across the eligible setups, 0 best and 1 worst, and to 0 for all setups when the metric is tied. Ratio-to-best keeps the size of a difference meaningful; min–max always stretches the pool to the full range, so a negligible difference can look decisive.

### Score and ranking

```
S_j = w_D d_j + w_G q_j + w_M z_j
```

with non-negative weights summing to one. By default the weights follow the straight fraction `s` of the circuit (share of lap length on straights):

```
w_M = 0.2,   w_D = (1 − w_M) s,   w_G = (1 − w_M)(1 − s)
```

Straight-dominated circuits therefore weight drag more and corner-dominated circuits weight grip more. Weights can also be given explicitly.

The lowest score ranks first. Scores within 10⁻¹² of each other tie and share a rank (standard competition ranking, "1224").

### Weight flip point

For fixed `w_M`, the score is linear in the drag share `σ = w_D / (w_D + w_G)`. Two eligible setups tie at

```
σ* = −[(1 − w_M) Δq + w_M Δz] / [(1 − w_M)(Δd − Δq)]
```

with `Δ` the difference between the two setups' penalties. The software reports `σ*` when it lies in [0, 1]: it is the drag share beyond which the runner-up would rank first.

## 4. Baselines

To test hypothesis H1, the software compares VDPM with single-criterion rankings that ignore feasibility:

- **drag-only**: lowest drag exposure `D`;
- **downforce-only**: highest `C_DF`;
- **efficiency-only**: highest `C_DF / C_D`;
- **ungated VDPM**: the VDPM score without the feasibility gate.

A choice is counted as an **avoidable infeasible choice** when the method recommends a setup that fails at least one corner although at least one setup was feasible. The gated VDPM ranking cannot make such a choice by construction; the comparison measures how often the alternatives do.

## 5. Reference circuits

Circuits A, B and C are built deterministically from the summary statistics of Fig. 5b of the manuscript (`vdpm.circuits.synthetic_circuit`):

| Circuit | Character | Length | Turns | Straight fraction | Mean corner radius | Lap time |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | high-speed | 5,790 m | 11 | 72 % | 320 m | 82.4 s |
| B | balanced | 4,360 m | 14 | 48 % | 210 m | 74.8 s |
| C | technical | 3,610 m | 18 | 28 % | 120 m | 69.5 s |

- `n` corner radii run linearly from 0.5 to 1.5 times the mean radius and are placed around the lap in the order `(5 i) mod n`, so that tight and open corners alternate. The mean radius matches exactly.
- Corner lengths are proportional to radius and sum to `(1 − s)` times the lap length.
- Straight lengths are proportional to `1 + 0.6 cos(2π i / n)` and sum to `s` times the lap length, so straights vary in length around the lap.
- Corner speeds are `v_i = √(a_ref r_i)`: every corner has the same lateral demand `a_ref`. The default `a_ref = 30² / 60 = 15 m/s²` is the demand of the manuscript's case-study corner. With this choice Circuit C's tightest corner is exactly the case-study corner (60 m at 30 m/s).
- Straight speed is the lap length divided by the lap time.

These layouts reproduce the published statistics exactly, but radii, lengths and speeds of individual segments are modelling assumptions, not measured track data. Elevation change is listed but not modelled.

## 6. Uncertainty analysis

The research suite and the dashboard's Research view perturb inputs by independent uniform multiplicative factors around their reference values: `μ` ±10 %, `m` ±2 %, `ρ` ±5 %, `A` ±2 %, `C_D` and `C_DF` ±5 % independently for each setup, and `a_ref` ±10 %. These ranges are illustrative assumptions, not measured distributions. Shares are reported with 95 % Wilson score intervals. The published results use 5,000 samples per circuit and seed 20261122.

The H1 comparison additionally draws `a_ref` uniformly from 10 to 30 m/s², so that each sample covers conditions from comfortable to infeasible. Samples in which no setup is feasible are excluded from the avoidable-choice count and reported separately.

## 7. Assumptions and limitations

- Quasi-steady point-mass model of each corner at a given reference speed. There is no lap-time simulation: drag exposure is a proxy for straight-line performance, not lap time.
- A single effective friction coefficient. Tyre load sensitivity, combined slip, temperature and wear are not modelled.
- All downforce is assumed to load the tyres. Aero balance, ride-height and yaw sensitivity, lateral and longitudinal load transfer, banking, kerbs and elevation are not modelled.
- Setups are described only by `C_D` and `C_DF` on a common reference area. Coefficients from CFD or the wind tunnel must use that area.
- The gate is binary: a setup that fails one corner by 0.1 % is excluded. The margins show how close each setup is.
- VDPM is a screening tool for narrowing down candidate setups before detailed simulation and testing, not a replacement for them.
