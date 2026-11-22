/**
 * Three.js scene for the track twin: a schematic 3D lap with a car driving the
 * selected setup, the grip it has and the grip each corner demands.
 *
 * Every force drawn comes from the engine: corner values are the engine's
 * CornerResult for that corner, straight values use the same equations at the
 * straight's reference speed. Only positions are schematic (see layout.ts).
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { availableLateralGrip, downforce, drag, type CircuitEvaluation, type Environment, type Vehicle } from "../engine";
import type { ChartTheme } from "../theme";
import { animationSpeed, centreline, pointOn, poseAt, type Layout, type LayoutSegment } from "./layout";

export type CameraMode = "orbit" | "chase" | "top";

export interface TwinSetup {
  name: string;
  colour: string;
  dragCoefficient: number;
  downforceCoefficient: number;
  evaluation: CircuitEvaluation;
}

export interface TwinData {
  layout: Layout;
  setups: TwinSetup[];
  driving: number;
  vehicle: Vehicle;
  env: Environment;
  theme: ChartTheme;
}

export interface TwinHud {
  segment: string;
  kind: "straight" | "corner";
  radius: number | null;
  speed: number;
  required: number;
  available: number;
  margin: number | null;
  downforce: number;
  drag: number;
  lapFraction: number;
  cornerIndex: number | null;
}

interface SegmentForces {
  required: number;
  available: number;
  margin: number | null;
  downforce: number;
  drag: number;
}

const TRACK_WIDTH = 5.2;
const SPAN = 112;
const LAP_SECONDS = 26;

const tmpV = new THREE.Vector3();

function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) {
      const map = (mat as THREE.MeshStandardMaterial).map;
      if (map) map.dispose();
      mat.dispose();
    }
    if (o instanceof CSS2DObject) o.element.remove();
  });
}

function marginColour(theme: ChartTheme, m: number): string {
  if (m < 0) return theme.infeasible;
  if (m < 0.1) return theme.warning;
  return theme.feasible;
}

/** An arrow made of a shaft and a cone, pointing along +Y, with settable length. */
class Arrow {
  readonly group = new THREE.Group();
  private shaft: THREE.Mesh;
  private head: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  constructor(colour: string, radius = 0.09) {
    this.material = new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.35, roughness: 0.4 });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 12), this.material);
    this.head = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.6, 1, 16), this.material);
    this.group.add(this.shaft, this.head);
  }
  set(length: number): void {
    const L = Math.max(0.001, length);
    const headLen = Math.min(0.7, L * 0.45);
    const shaftLen = Math.max(0.001, L - headLen);
    this.shaft.scale.set(1, shaftLen, 1);
    this.shaft.position.y = shaftLen / 2;
    this.head.scale.set(1, headLen, 1);
    this.head.position.y = shaftLen + headLen / 2;
    this.group.visible = length > 0.02;
  }
  colour(c: string): void {
    this.material.color.set(c);
    this.material.emissive.set(c);
  }
}

function buildCar(): { group: THREE.Group; livery: THREE.MeshStandardMaterial; rearWing: THREE.Group } {
  const g = new THREE.Group();
  const livery = new THREE.MeshStandardMaterial({ color: "#4d8dff", metalness: 0.35, roughness: 0.32 });
  const carbon = new THREE.MeshStandardMaterial({ color: "#14171d", metalness: 0.2, roughness: 0.55 });
  const tyre = new THREE.MeshStandardMaterial({ color: "#0d0f12", roughness: 0.85 });
  const white = new THREE.MeshStandardMaterial({ color: "#f2f4f8", roughness: 0.4 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  // Floor and monocoque.
  add(new THREE.BoxGeometry(3.0, 0.05, 1.05), carbon, -0.05, 0.12, 0);
  add(new THREE.BoxGeometry(1.9, 0.3, 0.52), livery, 0.05, 0.33, 0);
  // Nose, tapering to the front wing.
  add(new THREE.CylinderGeometry(0.07, 0.22, 1.25, 16), livery, 1.55, 0.3, 0, 0, 0, -Math.PI / 2 + 0.06);
  // Sidepods.
  add(new THREE.BoxGeometry(1.05, 0.26, 0.28), livery, -0.15, 0.3, 0.38);
  add(new THREE.BoxGeometry(1.05, 0.26, 0.28), livery, -0.15, 0.3, -0.38);
  add(new THREE.BoxGeometry(0.06, 0.22, 0.27), carbon, 0.39, 0.3, 0.38);
  add(new THREE.BoxGeometry(0.06, 0.22, 0.27), carbon, 0.39, 0.3, -0.38);
  // Engine cover and airbox.
  add(new THREE.CylinderGeometry(0.12, 0.27, 1.2, 16), livery, -0.75, 0.48, 0, 0, 0, Math.PI / 2);
  add(new THREE.BoxGeometry(0.34, 0.3, 0.24), livery, -0.05, 0.6, 0);
  // Cockpit, helmet and halo.
  add(new THREE.BoxGeometry(0.62, 0.12, 0.34), carbon, 0.45, 0.5, 0);
  add(new THREE.SphereGeometry(0.13, 16, 12), white, 0.38, 0.6, 0);
  add(new THREE.TorusGeometry(0.24, 0.028, 8, 24, Math.PI), carbon, 0.42, 0.6, 0, Math.PI / 2, 0, Math.PI / 2);
  // Front wing with endplates.
  add(new THREE.BoxGeometry(0.42, 0.035, 1.38), livery, 2.12, 0.1, 0);
  add(new THREE.BoxGeometry(0.3, 0.035, 1.3), carbon, 2.02, 0.17, 0, 0, 0, 0.12);
  add(new THREE.BoxGeometry(0.46, 0.18, 0.025), carbon, 2.08, 0.15, 0.69);
  add(new THREE.BoxGeometry(0.46, 0.18, 0.025), carbon, 2.08, 0.15, -0.69);
  // Rear wing: its angle follows the setup's downforce coefficient (illustrative).
  const rearWing = new THREE.Group();
  rearWing.position.set(-1.38, 0.8, 0);
  const plane = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.94), livery);
  plane.castShadow = true;
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.94), carbon);
  flap.position.set(-0.2, 0.1, 0);
  flap.castShadow = true;
  rearWing.add(plane, flap);
  g.add(rearWing);
  add(new THREE.BoxGeometry(0.62, 0.62, 0.03), carbon, -1.4, 0.58, 0.48);
  add(new THREE.BoxGeometry(0.62, 0.62, 0.03), carbon, -1.4, 0.58, -0.48);
  add(new THREE.BoxGeometry(0.06, 0.4, 0.06), carbon, -1.25, 0.55, 0);
  // Wheels.
  const wheel = (x: number, z: number, r: number, w: number) => {
    add(new THREE.CylinderGeometry(r, r, w, 28), tyre, x, r, z, Math.PI / 2);
    add(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.01, 20), carbon, x, r, z, Math.PI / 2);
  };
  wheel(1.12, 0.62, 0.23, 0.26);
  wheel(1.12, -0.62, 0.23, 0.26);
  wheel(-0.98, 0.6, 0.26, 0.34);
  wheel(-0.98, -0.6, 0.26, 0.34);
  // Suspension arms.
  for (const [x, z] of [
    [1.12, 0.4],
    [1.12, -0.4],
    [-0.98, 0.38],
    [-0.98, -0.38],
  ] as const) add(new THREE.BoxGeometry(0.05, 0.03, 0.42), carbon, x, 0.26, z);
  g.scale.setScalar(1.35);
  return { group: g, livery, rearWing };
}

function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 16;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 4; j++) {
      ctx.fillStyle = (i + j) % 2 ? "#111" : "#f4f4f4";
      ctx.fillRect(i * 4, j * 4, 4, 4);
    }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TwinScene {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.5, 900);
  private controls: OrbitControls;
  private content = new THREE.Group();
  private car = buildCar();
  private disc: THREE.Mesh;
  private discEdge: THREE.Mesh;
  private discMat: THREE.MeshBasicMaterial;
  private discEdgeMat: THREE.MeshBasicMaterial;
  private demand = new Arrow("#ffffff", 0.11);
  private downArrow = new Arrow("#ffffff", 0.08);
  private dragArrow = new Arrow("#ffffff", 0.07);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 1.1);
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private bindingRing: THREE.Mesh | null = null;
  private data: TwinData | null = null;
  private forces: SegmentForces[][] = [];
  private toWorld: (x: number, y: number) => THREE.Vector3 = (x, y) => new THREE.Vector3(x, 0, -y);
  private forceScale = 1;
  private downScale = 1;
  private dragScale = 1;
  private s = 0;
  private playing = true;
  private mode: CameraMode = "orbit";
  private raf = 0;
  private last = 0;
  private visible = true;
  private hudTimer = 0;
  private discRadius = 0;
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  private timeScale = 1;
  private userMoved = false;
  private rot = 0;
  private fitPoints: THREE.Vector3[] = [];
  private bounds = { minX: -SPAN / 2, maxX: SPAN / 2, minZ: -SPAN / 2, maxZ: SPAN / 2, height: 12 };
  onHud: ((h: TwinHud) => void) | null = null;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "twin-canvas";
    host.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "twin-labels";
    host.appendChild(this.labels.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.25;
    this.controls.maxPolarAngle = 1.38;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 330;
    this.controls.addEventListener("start", () => {
      this.controls.autoRotate = false;
      this.userMoved = true;
    });

    this.scene.add(this.hemi);
    this.sun.position.set(70, 130, 50);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -95;
    sc.right = 95;
    sc.top = 95;
    sc.bottom = -95;
    sc.near = 10;
    sc.far = 360;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.content);

    this.discMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false });
    this.discEdgeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 });
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), this.discMat);
    this.disc.rotation.x = -Math.PI / 2;
    this.discEdge = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 96), this.discEdgeMat);
    this.discEdge.rotation.x = -Math.PI / 2;
    this.disc.renderOrder = 2;
    this.discEdge.renderOrder = 3;
    this.scene.add(this.disc, this.discEdge);
    this.scene.add(this.car.group);
    this.demand.group.rotation.z = -Math.PI / 2; // +Y -> +X, then yawed per frame
    const demandHolder = new THREE.Group();
    demandHolder.add(this.demand.group);
    demandHolder.name = "demandHolder";
    this.scene.add(demandHolder);
    this.downArrow.group.rotation.z = Math.PI; // points down
    this.scene.add(this.downArrow.group);
    const dragHolder = new THREE.Group();
    dragHolder.name = "dragHolder";
    this.dragArrow.group.rotation.z = Math.PI / 2; // +Y -> -X (backwards)
    dragHolder.add(this.dragArrow.group);
    this.scene.add(dragHolder);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.io = new IntersectionObserver((e) => {
      this.visible = e[0]?.isIntersecting ?? true;
      if (this.visible) this.start();
    });
    this.io.observe(host);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resize();
    this.setCamera("orbit");
  }

  private onVisibility = () => {
    if (document.visibilityState === "visible") this.start();
  };

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved && this.mode !== "chase") this.fitOrbit(this.mode === "top" ? Math.PI / 2 - 0.0001 : 0.56);
    this.renderOnce();
  }

  setPlaying(p: boolean): void {
    this.playing = p;
    this.start();
  }

  setCamera(mode: CameraMode): void {
    this.mode = mode;
    this.controls.enabled = mode !== "chase";
    if (mode === "orbit") {
      this.controls.autoRotate = false;
      this.fitOrbit();
    } else if (mode === "top") {
      this.controls.autoRotate = false;
      this.fitOrbit(Math.PI / 2 - 0.0001);
    }
    this.controls.update();
    this.start();
  }

  /** Place the camera so the whole lap fits the view at the given elevation. */
  private fitOrbit(elevation = 0.56): void {
    const b = this.bounds;
    const top = elevation > 1.5;
    const portrait = this.camera.aspect < 1.05;
    // Portrait panels look along the long axis, landscape panels across it.
    const azimuth = top ? (portrait ? Math.PI / 2 : 0) : portrait ? Math.PI / 2 + 0.35 : 0.3;
    if (!top && portrait) elevation = Math.max(elevation, 0.72);
    const target = new THREE.Vector3((b.minX + b.maxX) / 2, top ? 0 : 2, (b.minZ + b.maxZ) / 2);
    const pts: THREE.Vector3[] = this.fitPoints.length
      ? this.fitPoints.map((p) => (top ? p.clone().setY(0) : p))
      : [b.minX, b.maxX].flatMap((x) => [b.minZ, b.maxZ].map((z) => new THREE.Vector3(x, 0, z)));
    const dir = new THREE.Vector3(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth) + (top ? 1e-4 : 0)).normalize();
    const fits = (d: number) => {
      this.camera.position.copy(target).addScaledVector(dir, d);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      return pts.every((p) => {
        const q = p.clone().project(this.camera);
        return Math.abs(q.x) < 0.9 && Math.abs(q.y) < 0.86 && q.z < 1;
      });
    };
    let lo = 10;
    let hi = 900;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    fits(hi);
    this.controls.target.copy(target);
    this.userMoved = false;
  }

  /** Jump the car to a fraction of the lap. */
  seek(fraction: number): void {
    if (!this.data) return;
    this.s = fraction * this.data.layout.lapLength;
    this.start();
  }

  setData(data: TwinData): void {
    const layoutChanged = !this.data || this.data.layout !== data.layout;
    const keepFraction = this.data ? this.s / this.data.layout.lapLength : 0;
    this.data = data;
    if (layoutChanged) this.s = keepFraction * data.layout.lapLength;
    this.computeForces();
    this.rebuild();
    if (layoutChanged && !this.userMoved && this.mode !== "chase") this.fitOrbit(this.mode === "top" ? Math.PI / 2 - 0.0001 : 0.56);
    this.start();
  }

  private computeForces(): void {
    const d = this.data!;
    const { vehicle: v, env } = d;
    this.forces = d.setups.map((st) =>
      d.layout.segments.map((seg): SegmentForces => {
        if (seg.kind === "corner" && seg.cornerIndex !== null) {
          const r = st.evaluation.corners[seg.cornerIndex]!;
          return { required: r.requiredForce, available: r.availableGrip, margin: r.margin, downforce: r.downforce, drag: r.drag };
        }
        const df = downforce(env.airDensity, seg.speed, st.downforceCoefficient, v.referenceArea);
        return {
          required: 0,
          available: availableLateralGrip(v.friction, v.mass, env.gravity, df),
          margin: null,
          downforce: df,
          drag: drag(env.airDensity, seg.speed, st.dragCoefficient, v.referenceArea),
        };
      }),
    );
    const all = this.forces.flat();
    const maxGrip = Math.max(...all.map((f) => Math.max(f.available, f.required)));
    this.forceScale = 5.2 / maxGrip;
    this.downScale = 4.2 / Math.max(...all.map((f) => f.downforce), 1);
    this.dragScale = 3.2 / Math.max(...all.map((f) => f.drag), 1);
    const lapTime = d.layout.segments.reduce((a, s) => a + s.length / s.speed, 0);
    this.timeScale = lapTime / LAP_SECONDS;
  }

  private rebuild(): void {
    const d = this.data!;
    const t = d.theme;
    disposeTree(this.content);
    this.content.clear();
    this.bindingRing = null;

    const dark = t.name === "dark";
    const bg = new THREE.Color(t.panel);
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 170, 380);
    this.hemi.color.set(dark ? "#b9c6dd" : "#ffffff");
    this.hemi.groundColor.set(dark ? "#1a2130" : "#c9cfda");
    this.hemi.intensity = dark ? 1.0 : 1.5;
    this.sun.intensity = dark ? 2.0 : 2.4;

    // Fit the plan into the scene, long axis along world X.
    const pts = centreline(d.layout, Math.max(2, d.layout.lapLength / 900));
    let mx = 0;
    let my = 0;
    for (const p of pts) {
      mx += p.x / pts.length;
      my += p.y / pts.length;
    }
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of pts) {
      sxx += (p.x - mx) ** 2;
      syy += (p.y - my) ** 2;
      sxy += (p.x - mx) * (p.y - my);
    }
    const rot = -0.5 * Math.atan2(2 * sxy, sxx - syy);
    this.rot = rot;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const rx = (x: number, y: number) => cr * x - sr * y;
    const ry = (x: number, y: number) => sr * x + cr * y;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      const X = rx(p.x, p.y);
      const Y = ry(p.x, p.y);
      minX = Math.min(minX, X);
      maxX = Math.max(maxX, X);
      minY = Math.min(minY, Y);
      maxY = Math.max(maxY, Y);
    }
    const k = SPAN / Math.max(maxX - minX, maxY - minY, 1);
    const ox = (minX + maxX) / 2;
    const oy = (minY + maxY) / 2;
    this.toWorld = (x, y) => new THREE.Vector3((rx(x, y) - ox) * k, 0, -(ry(x, y) - oy) * k);
    const pad = TRACK_WIDTH;
    this.bounds = {
      minX: (minX - ox) * k - pad,
      maxX: (maxX - ox) * k + pad,
      minZ: -(maxY - oy) * k - pad,
      maxZ: -(minY - oy) * k + pad,
      height: 20,
    };

    // Ground.
    const groundCol = dark ? "#0d1119" : "#e8ebf0";
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(420, 64),
      new THREE.MeshStandardMaterial({ color: groundCol, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.content.add(ground);
    const grid = new THREE.GridHelper(420, 84, dark ? "#1b2230" : "#d4d9e2", dark ? "#151b26" : "#dde1e8");
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = dark ? 0.75 : 0.9;
    grid.position.y = -0.01;
    this.content.add(grid);

    // Track ribbon, edge lines and kerbs.
    const n = pts.length;
    const left: THREE.Vector3[] = [];
    const right: THREE.Vector3[] = [];
    const normals: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i]!;
      const c = this.toWorld(p.x, p.y);
      // Plan normal to the left of travel: (-sin h, cos h) -> world (-sin h, 0, -cos h).
      const nx = -Math.sin(p.heading + rot);
      const nz = -Math.cos(p.heading + rot);
      const nrm = new THREE.Vector3(nx, 0, nz);
      normals.push(nrm);
      left.push(c.clone().addScaledVector(nrm, TRACK_WIDTH / 2));
      right.push(c.clone().addScaledVector(nrm, -TRACK_WIDTH / 2));
    }
    this.fitPoints = [];
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 90))) this.fitPoints.push(left[i]!.clone(), right[i]!.clone());
    const ribbon = (a: THREE.Vector3[], b: THREE.Vector3[], y: number, colours?: THREE.Color[]) => {
      const pos: number[] = [];
      const col: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i < a.length; i++) {
        pos.push(a[i]!.x, y, a[i]!.z, b[i]!.x, y, b[i]!.z);
        if (colours) {
          const c = colours[i]!;
          col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
      }
      for (let i = 0; i < a.length; i++) {
        const j = (i + 1) % a.length;
        idx.push(2 * i, 2 * j, 2 * i + 1, 2 * i + 1, 2 * j, 2 * j + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      if (colours) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const asphalt = new THREE.Mesh(
      ribbon(left, right, 0.02),
      new THREE.MeshStandardMaterial({ color: dark ? "#2a3240" : "#4b525f", roughness: 0.82, metalness: 0.05, side: THREE.DoubleSide }),
    );
    asphalt.receiveShadow = true;
    this.content.add(asphalt);
    const lineMat = new THREE.MeshBasicMaterial({ color: dark ? "#c9d0dc" : "#ffffff", side: THREE.DoubleSide });
    const offset = (arr: THREE.Vector3[], sgn: number, w: number) =>
      arr.map((p, i) => p.clone().addScaledVector(normals[i]!, sgn * w));
    this.content.add(new THREE.Mesh(ribbon(offset(left, -1, 0.12), offset(left, -1, 0.26), 0.04), lineMat));
    this.content.add(new THREE.Mesh(ribbon(offset(right, 1, 0.12), offset(right, 1, 0.26), 0.04), lineMat));

    // Kerbs on corners, coloured by the driving setup's margin at that corner.
    const drive = d.setups[d.driving]!;
    const driveForces = this.forces[d.driving]!;
    const kerbColours: THREE.Color[] = [];
    const white = new THREE.Color(dark ? "#d9dee8" : "#ffffff");
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const seg = d.layout.segments[pts[i]!.seg]!;
      if (i > 0) acc += left[i]!.distanceTo(left[i - 1]!);
      if (seg.kind === "corner" && seg.cornerIndex !== null) {
        const m = driveForces[seg.index]!.margin ?? 1;
        const stripe = Math.floor(acc / 1.1) % 2 === 0;
        kerbColours.push(stripe ? new THREE.Color(marginColour(t, m)) : white);
      } else kerbColours.push(new THREE.Color(0, 0, 0));
    }
    const kerbMask = pts.map((p) => d.layout.segments[p.seg]!.kind === "corner");
    const kerbStrip = (edge: THREE.Vector3[], sgn: number) => {
      // Only corner points: collapse straights to zero width.
      const a = edge.map((p, i) => (kerbMask[i] ? p.clone() : p.clone()));
      const b = edge.map((p, i) => (kerbMask[i] ? p.clone().addScaledVector(normals[i]!, sgn * 0.75) : p.clone()));
      return ribbon(a, b, 0.05, kerbColours);
    };
    const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
    this.content.add(new THREE.Mesh(kerbStrip(left, 1), kerbMat));
    this.content.add(new THREE.Mesh(kerbStrip(right, -1), kerbMat.clone()));

    // Start/finish line.
    const p0 = poseAt(d.layout, 0);
    const sf = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, TRACK_WIDTH),
      new THREE.MeshBasicMaterial({ map: checkerTexture() }),
    );
    sf.rotation.x = -Math.PI / 2;
    sf.rotation.z = p0.heading + rot;
    sf.position.copy(this.toWorld(p0.x, p0.y)).setY(0.045);
    this.content.add(sf);
    const gantryMat = new THREE.MeshStandardMaterial({ color: dark ? "#3a4356" : "#9aa2b2", roughness: 0.5 });
    const nrm0 = new THREE.Vector3(-Math.sin(p0.heading + rot), 0, -Math.cos(p0.heading + rot));
    for (const sgn of [1, -1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.2, 0.22), gantryMat);
      post.position.copy(this.toWorld(p0.x, p0.y)).addScaledVector(nrm0, sgn * (TRACK_WIDTH / 2 + 0.9)).setY(2.1);
      post.castShadow = true;
      this.content.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, TRACK_WIDTH + 2.1), gantryMat);
    beam.position.copy(this.toWorld(p0.x, p0.y)).setY(4.2);
    beam.rotation.y = p0.heading + rot;
    beam.castShadow = true;
    this.content.add(beam);

    // Corner columns: glass = grip available, solid = grip demanded.
    const allForces = this.forces.flat();
    const maxF = Math.max(...allForces.map((f) => Math.max(f.available, f.required)));
    const hScale = 20 / maxF;
    const binding = drive.evaluation.bindingCorner;
    for (const seg of d.layout.segments) {
      if (seg.kind !== "corner" || seg.cornerIndex === null) continue;
      const f = driveForces[seg.index]!;
      const apex = this.apex(seg);
      const inward = new THREE.Vector3().subVectors(this.toWorld(seg.cx, seg.cy), apex).setY(0);
      const dist = inward.length();
      inward.normalize();
      const base = apex.clone().addScaledVector(inward, Math.min(dist * 0.6, TRACK_WIDTH * 1.55));
      const m = f.margin ?? 0;
      const ok = m >= 0;
      const colGrip = new THREE.Color(drive.colour);
      const hg = f.available * hScale;
      const hd = f.required * hScale;
      const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(1.05, 1.05, hg, 40, 1, true),
        new THREE.MeshStandardMaterial({
          color: colGrip,
          transparent: true,
          opacity: dark ? 0.34 : 0.3,
          roughness: 0.15,
          metalness: 0.1,
          side: THREE.DoubleSide,
          depthWrite: false,
          emissive: colGrip,
          emissiveIntensity: dark ? 0.55 : 0.2,
        }),
      );
      glass.position.copy(base).setY(hg / 2);
      glass.renderOrder = 4;
      this.content.add(glass);
      const cap = new THREE.Mesh(
        new THREE.TorusGeometry(1.05, 0.06, 8, 48),
        new THREE.MeshStandardMaterial({ color: colGrip, emissive: colGrip, emissiveIntensity: 0.6 }),
      );
      cap.rotation.x = Math.PI / 2;
      cap.position.copy(base).setY(hg);
      this.content.add(cap);
      const baseDisc = new THREE.Mesh(
        new THREE.CircleGeometry(1.05, 40),
        new THREE.MeshBasicMaterial({ color: colGrip, transparent: true, opacity: 0.35 }),
      );
      baseDisc.rotation.x = -Math.PI / 2;
      baseDisc.position.copy(base).setY(0.03);
      this.content.add(baseDisc);
      const coreCol = ok ? (dark ? "#eef1f6" : "#1b2230") : t.infeasible;
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, hd, 28),
        new THREE.MeshStandardMaterial({ color: coreCol, roughness: 0.35, emissive: ok ? "#000000" : t.infeasible, emissiveIntensity: ok ? 0 : 0.5 }),
      );
      core.position.copy(base).setY(hd / 2);
      core.castShadow = true;
      this.content.add(core);
      // Other setups' grip levels as thin rings, for comparison.
      d.setups.forEach((other, oi) => {
        if (oi === d.driving) return;
        const h = this.forces[oi]![seg.index]!.available * hScale;
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(1.32, 0.045, 6, 48),
          new THREE.MeshBasicMaterial({ color: other.colour, transparent: true, opacity: 0.85 }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.copy(base).setY(h);
        this.content.add(ring);
      });
      // Label.
      const isBinding = seg.cornerIndex === binding;
      const el = document.createElement("div");
      el.className = `twin-label${isBinding ? " binding" : ""}${ok ? "" : " fails"}`;
      const name = document.createElement("b");
      name.textContent = seg.name || `T${seg.cornerIndex + 1}`;
      const val = document.createElement("span");
      val.textContent = `${m >= 0 ? "+" : "−"}${Math.abs(m * 100).toFixed(m !== 0 && Math.abs(m) < 0.1 ? 1 : 0)}%`;
      el.append(name, val);
      if (isBinding) {
        const tag = document.createElement("i");
        tag.textContent = "binding";
        el.append(tag);
      }
      el.style.setProperty("--mc", marginColour(t, m));
      const label = new CSS2DObject(el);
      label.position.copy(base).setY(Math.max(hg, hd) + 1.6);
      this.fitPoints.push(base.clone().setY(Math.max(hg, hd) + 3.2));
      label.center.set(0.5, 1);
      this.content.add(label);
      if (isBinding) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(1.6, 1.85, 64),
          new THREE.MeshBasicMaterial({ color: marginColour(t, m), transparent: true, opacity: 0.9, depthWrite: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(base).setY(0.035);
        this.content.add(ring);
        this.bindingRing = ring;
      }
    }

    // Car livery, wing angle and force arrows.
    this.car.livery.color.set(drive.colour);
    const wingAngle = THREE.MathUtils.degToRad(4 + 5.5 * Math.min(5, drive.downforceCoefficient));
    this.car.rearWing.rotation.z = wingAngle;
    this.car.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.discEdgeMat.color.set(drive.colour);
    this.discMat.color.set(drive.colour);
    this.downArrow.colour(drive.colour);
    this.dragArrow.colour(dark ? "#98a1b5" : "#5b6476");
  }

  private apex(seg: LayoutSegment): THREE.Vector3 {
    const p = pointOn(seg, 0.5);
    const f = (seg.start + seg.length / 2) / this.data!.layout.lapLength;
    return this.toWorld(p.x - f * this.data!.layout.residualX, p.y - f * this.data!.layout.residualY);
  }

  private start(): void {
    if (this.raf || !this.visible || document.visibilityState === "hidden") return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private renderOnce(): void {
    if (!this.data) return;
    this.placeCar(0);
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (!this.visible || document.visibilityState === "hidden") return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.data && this.playing) {
      this.s += animationSpeed(this.data.layout, this.s) * this.timeScale * dt;
      this.s %= this.data.layout.lapLength;
    }
    this.placeCar(dt);
    if (this.bindingRing) {
      const p = 1 + 0.18 * Math.sin(now / 320);
      this.bindingRing.scale.set(p, p, 1);
    }
    if (this.mode !== "chase") this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    this.start();
  };

  private placeCar(dt: number): void {
    const d = this.data;
    if (!d) return;
    const pose = poseAt(d.layout, this.s);
    const pos = this.toWorld(pose.x, pose.y);
    const car = this.car.group;
    car.position.copy(pos).setY(0.03);
    car.rotation.y = pose.heading + this.rot;
    const f = this.forces[d.driving]![pose.segment.index]!;

    // Friction circle: radius = available grip, eased so speed changes read smoothly.
    const target = f.available * this.forceScale;
    this.discRadius = this.discRadius === 0 || dt === 0 ? target : this.discRadius + (target - this.discRadius) * Math.min(1, dt * 6);
    this.disc.position.copy(pos).setY(0.07);
    this.discEdge.position.copy(pos).setY(0.075);
    this.disc.scale.setScalar(this.discRadius);
    this.discEdge.scale.setScalar(this.discRadius);

    // Demand arrow towards the centre of curvature.
    const holder = this.scene.getObjectByName("demandHolder")!;
    const seg = pose.segment;
    if (seg.kind === "corner" && f.required > 0) {
      const c = this.toWorld(seg.cx, seg.cy);
      tmpV.subVectors(c, pos).setY(0).normalize();
      holder.position.copy(pos).setY(0.32);
      holder.rotation.y = Math.atan2(-tmpV.z, tmpV.x);
      this.demand.set(f.required * this.forceScale);
      const m = f.margin ?? 0;
      this.demand.colour(m < 0 ? d.theme.infeasible : m < 0.1 ? d.theme.warning : d.theme.name === "dark" ? "#f4f6fa" : "#1b2230");
      holder.visible = true;
    } else holder.visible = false;

    // Downforce from above, drag behind.
    const dfLen = f.downforce * this.downScale;
    this.downArrow.set(dfLen);
    this.downArrow.group.position.copy(pos).setY(1.7 + dfLen);
    const dragHolder = this.scene.getObjectByName("dragHolder")!;
    dragHolder.position.copy(pos).setY(0.55);
    dragHolder.rotation.y = pose.heading + this.rot;
    this.dragArrow.group.position.set(-2.4, 0, 0);
    this.dragArrow.set(f.drag * this.dragScale);

    // Camera follow.
    if (this.mode === "chase") {
      const back = new THREE.Vector3(Math.cos(pose.heading + this.rot), 0, -Math.sin(pose.heading + this.rot));
      const want = pos.clone().addScaledVector(back, -14).setY(6.2);
      const k = dt === 0 ? 1 : Math.min(1, dt * 3.2);
      this.camera.position.lerp(want, k);
      this.camera.lookAt(pos.clone().addScaledVector(back, 7).setY(0.8));
    }

    // HUD at about 8 Hz.
    const now = performance.now();
    if (this.onHud && (now - this.hudTimer > 120 || dt === 0)) {
      this.hudTimer = now;
      this.onHud({
        segment: seg.name || (seg.kind === "corner" ? `T${(seg.cornerIndex ?? 0) + 1}` : "Straight"),
        kind: seg.kind,
        radius: seg.radius,
        speed: seg.speed,
        required: f.required,
        available: f.available,
        margin: f.margin,
        downforce: f.downforce,
        drag: f.drag,
        lapFraction: this.s / d.layout.lapLength,
        cornerIndex: seg.cornerIndex,
      });
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ro.disconnect();
    this.io.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.controls.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}
