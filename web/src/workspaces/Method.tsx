/** Method workspace: equations, score definition, assumptions and provenance. */
import { Callout, Card } from "../components/Card";
import { IconInfo } from "../components/Icons";
import { Tex } from "../components/Tex";
import { REFERENCE_SUMMARIES } from "../engine";
import { fmt } from "../format";
import { APP_VERSION } from "../state";
import { WsHeader } from "./common";

const EQS: [string, string, string][] = [
  ["4.1", "Aerodynamic drag", String.raw`F_\mathrm{D} = \tfrac{1}{2}\,\rho\, v^2 C_\mathrm{D} A`],
  ["4.2", "Downforce", String.raw`F_{\mathrm{DF}} = \tfrac{1}{2}\,\rho\, v^2 C_{\mathrm{DF}} A`],
  ["4.3", "Required lateral force", String.raw`F_\mathrm{c} = \dfrac{m v^2}{r}`],
  ["4.4", "Available lateral grip", String.raw`F_{\mathrm{grip}} = \mu \left( m g + F_{\mathrm{DF}} \right)`],
  ["4.5", "Safety margin", String.raw`M = \dfrac{F_{\mathrm{grip}} - F_\mathrm{c}}{F_\mathrm{c}}, \qquad \text{feasible} \iff M \ge 0`],
];

const DERIVED: [string, string][] = [
  ["Maximum lateral acceleration", String.raw`a_{\mathrm{lat},\max} = \mu \left( g + \dfrac{F_{\mathrm{DF}}}{m} \right)`],
  ["Downforce factor", String.raw`k = \tfrac{1}{2}\,\rho\, C_{\mathrm{DF}} A, \qquad F_{\mathrm{DF}} = k v^2`],
  ["Grip-limited speed", String.raw`v_{\max} = \sqrt{\dfrac{\mu m g}{m / r - \mu k}} \quad \text{for } r < r^{*} = \dfrac{m}{\mu k}`],
  ["Lowest friction", String.raw`\mu_{\min} = \dfrac{F_\mathrm{c}}{m g + F_{\mathrm{DF}}}`],
  ["Highest mass", String.raw`m_{\max} = \dfrac{\mu F_{\mathrm{DF}}}{v^2 / r - \mu g} \quad (\text{unbounded if } v^2/r \le \mu g)`],
  ["Lowest downforce coefficient", String.raw`C_{\mathrm{DF},\min} = \max\!\left(0,\; \dfrac{F_\mathrm{c} / \mu - m g}{\tfrac{1}{2}\rho v^2 A}\right)`],
];

export function Method() {
  return (
    <div className="workspace">
      <WsHeader
        title="Method"
        lead="The model behind every number in this platform, the exact score definition, and what the model leaves out. Nothing here is learned from data: every result follows in closed form from the equations below."
      />

      <div className="grid grid-2">
        <Card title="Governing equations" subtitle="Section 4 of the manuscript. SI units throughout.">
          <table className="data eq-table">
            <tbody>
              {EQS.map(([n, label, tex]) => (
                <tr key={n}>
                  <td className="muted" style={{ width: 170 }}>{label}</td>
                  <td><Tex display>{tex}</Tex></td>
                  <td className="num muted" style={{ width: 48 }}>({n})</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Derived quantities" subtitle="Closed-form consequences of Eqs. 4.1 to 4.5, used for the explanations and limits.">
          <table className="data eq-table">
            <tbody>
              {DERIVED.map(([label, tex]) => (
                <tr key={label}>
                  <td className="muted" style={{ width: 170 }}>{label}</td>
                  <td><Tex display>{tex}</Tex></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="The VDPM score" subtitle="How setups are screened and ranked on a circuit.">
        <div className="prose">
          <Callout icon={<IconInfo />}>
            The manuscript describes the score in words. The definition below is the one this platform implements, stated exactly so that every ranking can be reproduced.
          </Callout>
          <h3>1. Feasibility gate</h3>
          <p>
            A setup is <em>eligible</em> only if it is feasible at every corner <Tex>{String.raw`j`}</Tex> of the circuit, evaluated at the corner's reference speed:
          </p>
          <Tex display>{String.raw`\text{eligible}_i \iff \min_j M_{ij} \ge 0`}</Tex>
          <p>Ineligible setups are reported with the corner that fails them and are not scored. With the gate switched off, every setup is scored.</p>
          <h3>2. Circuit-level metrics</h3>
          <p>Over segments of length <Tex>{"L_j"}</Tex> (straights and corners) and over corners only:</p>
          <Tex display>{String.raw`D_i = \frac{\sum_{j} L_j\, F_{\mathrm{D},ij}}{\sum_j L_j}, \qquad G_i = \frac{\sum_{j \in \text{corners}} L_j\, F_{\mathrm{grip},ij}}{\sum_{j \in \text{corners}} L_j}, \qquad R_i = \min_{j \in \text{corners}} \frac{F_{\mathrm{grip},ij}}{F_{\mathrm{c},ij}}`}</Tex>
          <p>
            <Tex>{"D"}</Tex> is the lap-averaged drag exposure, <Tex>{"G"}</Tex> the length-weighted cornering grip and <Tex>{"R = 1 + \\min_j M_j"}</Tex> the grip-to-demand ratio at the binding corner.
          </p>
          <h3>3. Penalties</h3>
          <p>Each metric becomes a penalty in [0, 1) relative to the best eligible setup (ratio-to-best normalisation, the default):</p>
          <Tex display>{String.raw`d_i = 1 - \frac{\min_k D_k}{D_i}, \qquad q_i = 1 - \frac{G_i}{\max_k G_k}, \qquad z_i = 1 - \frac{R_i}{\max_k R_k}`}</Tex>
          <p>
            Min–max normalisation, <Tex>{String.raw`(x - x_{\min}) / (x_{\max} - x_{\min})`}</Tex> oriented so that 0 is best, is available as an alternative. Ratio-to-best keeps the size of a difference
            meaningful; min–max always stretches the pool to [0, 1].
          </p>
          <h3>4. Weighted score</h3>
          <Tex display>{String.raw`S_i = w_\mathrm{D}\, d_i + w_\mathrm{G}\, q_i + w_\mathrm{M}\, z_i, \qquad w_\mathrm{D} = (1 - w_\mathrm{M})\, s, \quad w_\mathrm{G} = (1 - w_\mathrm{M})(1 - s)`}</Tex>
          <p>
            where <Tex>{"s"}</Tex> is the circuit's straight fraction (share of lap length on straights) and <Tex>{"w_\\mathrm{M} = 0.2"}</Tex> by default. Straight-dominated circuits therefore weight drag
            more and corner-dominated circuits weight grip more. The lowest score ranks first; scores within <Tex>{"10^{-12}"}</Tex> tie (standard competition ranking). Weights can also be set
            by hand.
          </p>
          <h3>5. Weight flip point</h3>
          <p>
            Because <Tex>{"S"}</Tex> is linear in the drag share <Tex>{String.raw`\sigma = w_\mathrm{D} / (w_\mathrm{D} + w_\mathrm{G})`}</Tex>, two eligible setups tie at
          </p>
          <Tex display>{String.raw`\sigma^{*} = -\,\frac{(1 - w_\mathrm{M})\,\Delta q + w_\mathrm{M}\, \Delta z}{(1 - w_\mathrm{M})\,(\Delta d - \Delta q)}`}</Tex>
          <p>with differences taken between the two setups. The Decision view reports it for each runner-up.</p>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Assumptions and limitations" subtitle="What the model includes, and what a user should keep in mind.">
          <div className="prose">
            <ul>
              <li>Quasi-steady point-mass model of each corner at a given reference speed. There is no lap-time simulation; drag exposure is a proxy for straight-line performance, not lap time.</li>
              <li>A single effective friction coefficient. Tyre load sensitivity, combined slip, temperature and wear are not modelled.</li>
              <li>All downforce is assumed to load the tyres. Aero balance, ride-height and yaw sensitivity, load transfer, banking, kerbs and elevation are not modelled.</li>
              <li>Setups are described only by <Tex>{"C_\\mathrm{D}"}</Tex> and <Tex>{"C_{\\mathrm{DF}}"}</Tex> on a common reference area. CFD or wind-tunnel values must use that area.</li>
              <li>The gate is binary: a setup that fails one corner by 0.1 % is excluded. The margin table shows how close each setup is.</li>
              <li>Uncertainty ranges in the Monte Carlo analysis are illustrative assumptions, not measured distributions.</li>
              <li>VDPM is a screening tool to narrow down setups before detailed simulation and testing, not a replacement for them.</li>
            </ul>
          </div>
        </Card>

        <Card title="Reference circuits" subtitle="How circuits A, B and C are built from the summary statistics of Fig. 5b.">
          <div className="prose">
            <table className="data compact" style={{ marginBottom: 12 }}>
              <thead>
                <tr>
                  <th>Circuit</th>
                  <th className="num">Length</th>
                  <th className="num">Turns</th>
                  <th className="num">Straights</th>
                  <th className="num">Mean radius</th>
                  <th className="num">Lap time</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(REFERENCE_SUMMARIES).map((c) => (
                  <tr key={c.key}>
                    <td>{c.name} <span className="faint">({c.character})</span></td>
                    <td className="num">{fmt(c.lengthM, 0)} m</td>
                    <td className="num">{c.turns}</td>
                    <td className="num">{fmt(c.straightFraction * 100, 0)} %</td>
                    <td className="num">{fmt(c.meanCornerRadiusM, 0)} m</td>
                    <td className="num">{fmt(c.lapTimeS, 1)} s</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul>
              <li>Corner radii run linearly from 0.5 to 1.5 times the mean radius and are interleaved around the lap, so the mean matches exactly.</li>
              <li>Corner lengths are proportional to radius and sum to the corner share of the lap; straight lengths vary smoothly around the lap and sum to the straight share.</li>
              <li>Corner speeds are <Tex>{String.raw`v_j = \sqrt{a_{\mathrm{ref}}\, r_j}`}</Tex>, where the corner demand <Tex>{"a_{\\mathrm{ref}}"}</Tex> defaults to the case study's 30²/60 = 15 m/s². Straight speed is lap length over lap time.</li>
              <li>These layouts reproduce the published statistics exactly but are modelling assumptions, not measured track data. Real circuits can be imported as CSV in the Circuit view.</li>
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Reproducibility" subtitle="Every result can be regenerated and checked independently.">
          <div className="prose">
            <ul>
              <li><strong>Two implementations.</strong> The Python package <code>vdpm</code> is the reference. This browser engine is a separate TypeScript implementation checked against 400 corner cases and 72 circuit rankings written by the Python code (Research view).</li>
              <li><strong>Scenario files.</strong> The Save scenario button in the top bar stores every input and the resulting ranking as a JSON scenario (format <code>vdpm-scenario/1</code>). Loading the file restores the exact state.</li>
              <li><strong>Charts.</strong> Every chart exports as SVG (vector) and as PNG at three times screen resolution.</li>
              <li>
                <strong>Research suite.</strong> <code>vdpm research --out results</code> regenerates the published tables, figures and report with a fixed seed. <code>vdpm table2</code> reprints Table 2.
              </li>
            </ul>
          </div>
        </Card>

        <Card title="About" subtitle={`VDPM-RaceTwin ${APP_VERSION}`}>
          <div className="prose">
            <p>
              VDPM-RaceTwin is the interactive decision-support platform accompanying the manuscript <em>VDPM: Vehicle Dynamics Performance Metric</em>. It implements the physics-constrained,
              circuit-aware screening of aerodynamic setups described there, and makes each step inspectable: the forces at a corner, the feasibility of every corner on a lap, the score and its
              composition, and the sensitivity of the recommendation to its inputs.
            </p>
            <p>
              The default inputs are those of Table 1 of the manuscript. When citing results obtained with this platform, please cite the manuscript and state the software version above and
              the scenario file used.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
