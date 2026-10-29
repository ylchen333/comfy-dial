import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Grid, Line, OrbitControls, TransformControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DEFAULT_DEPTH_NORM, type Pose, type Vec3 } from "@comfy-osh/rig-core";
import type { Aligned } from "../logic/align.ts";
import { evalChannel } from "../logic/keys.ts";
import { lensFrame, overscanFov } from "../logic/frameGuides.ts";
import { closestOnAxis, rayPlane, snapPoint, viewName, viewPose, type Framing, type ViewId } from "../logic/viewControls.ts";
import { assetUrl, hasGround, isModelAsset } from "../logic/scenes.ts";
import type { StudioDoc } from "../logic/types.ts";

export type GizmoTarget = "position" | "aim";

interface Props {
  doc: StudioDoc;
  frame: number;
  poses: Pose[];
  recovered: Aligned | null;
  gizmo: GizmoTarget;
  showPip: boolean;
  /** Review screen: draw the paths only, no editing gizmos. */
  readOnly?: boolean;
  /** Look through the shot camera (wider than the frame so the frame mask has some overscan). */
  lens?: boolean;
  /** A named view for the orbit camera; `n` changes with every request so the same view can be asked for twice. */
  viewCmd?: { n: number; view: ViewId; framing?: Framing } | undefined;
  framing: Framing;
  /** Blender-style display switches: grid, the shot camera's frustum, the camera path with its keys, ghost cameras. */
  overlays?: Overlays;
  /** Orthographic projection (emulated with a very narrow field of view, so orbit, pan, zoom and picking behave as usual). */
  ortho?: boolean;
  /** Solid shows the scene; Depth shows what the shot camera's depth guide contains, in place, from any angle. */
  shading?: "solid" | "depth";
  /** The user took hold of the view (so an automatic orthographic view can return to perspective). */
  onUserOrbit?: () => void;
  /** "Front Orthographic", "User Perspective", "Camera Perspective" ... for the text in the corner. */
  onViewLabel?: (label: string) => void;
  /** G: move this position key with the mouse; X/Y/Z constrain, click or Enter confirms, Esc cancels. */
  grab?: { frame: number; start: Vec3 } | null;
  onGrabPreview?: (info: { frame: number; pos: Vec3; axis: "x" | "y" | "z" | null } | null) => void;
  onGrabEnd?: (frame: number, pos: Vec3 | null) => void;
  snap?: boolean;
  selectedKeyFrame?: number | null;
  onSelectKey?: (frame: number) => void;
  onKeyMove?: (frame: number, value: Vec3) => void;
  onGizmoCommit: (target: GizmoTarget, value: Vec3) => void;
  onAssetError: (msg: string) => void;
}

export interface Overlays { grid: boolean; frustum: boolean; path: boolean; ghosts: boolean }
export const DEFAULT_OVERLAYS: Overlays = { grid: true, frustum: true, path: true, ghosts: false };

const FRUSTUM_DEPTH = 2.2;

// Depth shading: the guide's own mapping (log between near and far, 1 = near) computed per fragment against the SHOT camera,
// so the editor shows the guide's contents from any viewpoint.
const DEPTH_VERT = "varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }";
const DEPTH_FRAG = "varying vec3 vW; uniform vec3 camPos; uniform vec3 fwd; uniform float nearD; uniform float farD; void main() { float z = dot(vW - camPos, fwd); float c = clamp(z, nearD, farD); float v = 1.0 - log(c / nearD) / log(farD / nearD); gl_FragColor = vec4(vec3(v), 1.0); }";
function makeDepthMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, side: THREE.DoubleSide,
    uniforms: { camPos: { value: new THREE.Vector3() }, fwd: { value: new THREE.Vector3(0, 0, -1) }, nearD: { value: DEFAULT_DEPTH_NORM.near }, farD: { value: DEFAULT_DEPTH_NORM.far } },
  });
}

const NO_BUTTON = -1 as unknown as THREE.MOUSE; // not one of ROTATE/DOLLY/PAN, so OrbitControls does nothing for it
/** Blender mouse map: middle orbits (Shift+middle pans, wheel zooms); left only selects, except while Alt is held (see Navigation). */
const MOUSE_BUTTONS = { LEFT: NO_BUTTON, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: NO_BUTTON };
/** Viewing only (Review): the left button orbits, as in any model viewer. */
const VIEWER_BUTTONS = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
const PERSP_FOV = 45, ORTHO_FOV = 1.5;

/** A glTF/GLB node, loaded from the local server. The depth guide is rendered from the same file, so what you see is what the guide shows. */
function GlbModel({ asset, transform, depthMat, onError }: { asset: string; transform: StudioDoc["scene"]["nodes"][number]["transform"]; depthMat: THREE.ShaderMaterial | null; onError: (msg: string) => void }) {
  const [obj, setObj] = useState<THREE.Object3D | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    let dead = false;
    new GLTFLoader().load(
      assetUrl(asset),
      (g) => { if (!dead) setObj(g.scene); },
      undefined,
      () => { if (!dead) onErrorRef.current(`could not load ${asset} (is \`pnpm serve\` running?)`); },
    );
    return () => { dead = true; };
  }, [asset]);
  useEffect(() => {
    obj?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.userData.solid ??= m.material;
      m.material = depthMat ?? (m.userData.solid as THREE.Material);
    });
  }, [obj, depthMat]);
  if (!obj) return null;
  return <primitive object={obj} position={transform.position as Vec3} quaternion={new THREE.Quaternion(...transform.quaternion)} scale={transform.scale as Vec3} />;
}

function SceneObjects({ doc, depthMat, onAssetError }: { doc: StudioDoc; depthMat: THREE.ShaderMaterial | null; onAssetError: (msg: string) => void }) {
  return (
    <>
      {doc.scene.nodes.map((n) => {
        const t = n.transform;
        if (isModelAsset(n.asset)) return <GlbModel key={`${n.id}:${n.asset}`} asset={n.asset} transform={t} depthMat={depthMat} onError={onAssetError} />;
        const kind = n.asset.replace("primitive:", "");
        if (kind === "plane") return null; // the ground is drawn by the editor grid
        const common = { position: t.position as Vec3, quaternion: new THREE.Quaternion(...t.quaternion) };
        if (n.id === "subject") {
          const r = t.scale[0] / 2;
          return (
            <mesh key={n.id} {...common} castShadow>
              <capsuleGeometry args={[r, Math.max(0.01, t.scale[1] - 2 * r), 8, 16]} />
              {depthMat ? <primitive object={depthMat} attach="material" /> : <meshStandardMaterial color="#e8903f" />}
            </mesh>
          );
        }
        return (
          <mesh key={n.id} {...common} scale={t.scale as Vec3} castShadow>
            {kind === "cylinder" ? <cylinderGeometry args={[0.5, 0.5, 1, 24]} /> : <boxGeometry args={[1, 1, 1]} />}
            {depthMat ? <primitive object={depthMat} attach="material" /> : <meshStandardMaterial color="#5a80d9" />}
          </mesh>
        );
      })}
      {hasGround(doc) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          {depthMat ? <primitive object={depthMat} attach="material" /> : <meshStandardMaterial color="#6b8c61" />}
        </mesh>
      )}
    </>
  );
}

/** Wireframe pyramid + far rectangle in camera space (looks down -Z). */
function FrustumGizmo({ pose, aspect, color = "#ffd23f" }: { pose: Pose; aspect: number; color?: string }) {
  const geom = useMemo(() => {
    const hh = FRUSTUM_DEPTH * Math.tan((pose.fov_v_deg * Math.PI) / 360);
    const hw = hh * aspect;
    const c: Vec3[] = [[-hw, hh, -FRUSTUM_DEPTH], [hw, hh, -FRUSTUM_DEPTH], [hw, -hh, -FRUSTUM_DEPTH], [-hw, -hh, -FRUSTUM_DEPTH]];
    const pts: number[] = [];
    c.forEach((p, i) => {
      pts.push(0, 0, 0, ...p); // apex -> corner
      pts.push(...p, ...c[(i + 1) % 4]!); // far rectangle
    });
    // up marker triangle above the far rectangle
    pts.push(-hw * 0.3, hh, -FRUSTUM_DEPTH, 0, hh * 1.25, -FRUSTUM_DEPTH, 0, hh * 1.25, -FRUSTUM_DEPTH, hw * 0.3, hh, -FRUSTUM_DEPTH);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [pose.fov_v_deg, aspect]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <group position={pose.position} quaternion={pose.quaternion}>
      <lineSegments geometry={geom}>
        <lineBasicMaterial color={color} />
      </lineSegments>
    </group>
  );
}

/** Moves the orbit camera when the toolbar (or a key) asks for a named view. */
function ViewCommands({ cmd, framing }: { cmd: Props["viewCmd"]; framing: Framing }) {
  const camera = useThree((st) => st.camera);
  const controls = useThree((st) => st.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const framingRef = useRef(framing);
  framingRef.current = framing;
  useEffect(() => {
    if (!cmd || !controls) return;
    const cur = camera.position.clone().sub(controls.target).toArray() as Vec3;
    const cam = camera as THREE.PerspectiveCamera;
    const v = viewPose(cmd.view, cmd.framing ?? framingRef.current, cur);
    // Orthographic stand-in: a very narrow FOV from proportionally further back shows the same extent.
    const k = Math.tan((PERSP_FOV * Math.PI) / 360) / Math.tan((cam.fov * Math.PI) / 360);
    const rel = new THREE.Vector3(...v.position).sub(new THREE.Vector3(...v.target)).multiplyScalar(cam.fov < PERSP_FOV - 1 ? k : 1);
    camera.position.set(v.target[0] + rel.x, v.target[1] + rel.y, v.target[2] + rel.z);
    controls.target.set(...v.target);
    controls.update();
  }, [cmd?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Path keys as spheres: click to select, drag the selected one to move that key. */
function KeyHandles({ keys, selected, snap, override, onSelect, onMove }: { keys: { frame: number; value: Vec3 }[]; selected: number | null; snap: boolean; override: { frame: number; pos: Vec3 } | null; onSelect: (f: number) => void; onMove: (f: number, v: Vec3) => void }) {
  const [obj, setObj] = useState<THREE.Mesh | null>(null);
  return (
    <>
      {keys.map((k) => {
        const on = k.frame === selected;
        return (
          <mesh key={`pk${k.frame}`} {...(on ? { ref: setObj } : {})} position={override && override.frame === k.frame ? override.pos : k.value} onClick={(e) => { e.stopPropagation(); onSelect(k.frame); }}>
            <sphereGeometry args={[on ? 0.16 : 0.1, 16, 16]} />
            <meshBasicMaterial color={on ? "#ffd23f" : "#ffffff"} />
          </mesh>
        );
      })}
      {selected !== null && obj && !override && (
        <TransformControls
          key={selected}
          object={obj}
          mode="translate"
          size={0.7}
          {...(snap ? { translationSnap: 0.25 } : {})}
          onMouseUp={() => onMove(selected, [obj.position.x, obj.position.y, obj.position.z])}
        />
      )}
    </>
  );
}

/** Orthographic <-> perspective by changing the field of view and the distance together, so the picture keeps its extent. */
function ProjectionSwitch({ ortho, lens }: { ortho: boolean; lens: boolean }) {
  const { camera } = useThree();
  const controls = useThree((st) => st.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const prev = useRef(ortho);
  const nearFar = useRef({ near: 0.1, far: 500 });
  useEffect(() => {
    if (prev.current === ortho) return;
    prev.current = ortho;
    if (lens || !controls) return;
    const cam = camera as THREE.PerspectiveCamera;
    const dir = cam.position.clone().sub(controls.target);
    const d1 = dir.length() * Math.tan((cam.fov * Math.PI) / 360) / Math.tan(((ortho ? ORTHO_FOV : PERSP_FOV) * Math.PI) / 360);
    cam.fov = ortho ? ORTHO_FOV : PERSP_FOV;
    cam.position.copy(controls.target).addScaledVector(dir.normalize(), d1);
    cam.updateProjectionMatrix();
    controls.update();
  }, [ortho, lens, camera, controls]);
  // The clip planes follow the distance so the far scene is neither clipped nor z-fighting.
  useFrame(() => {
    if (lens || !controls) return;
    const cam = camera as THREE.PerspectiveCamera;
    const d = cam.position.distanceTo(controls.target);
    const want = cam.fov < PERSP_FOV - 1 ? { near: d * 0.25, far: d * 4 } : { near: 0.1, far: 500 };
    if (Math.abs(want.near - nearFar.current.near) > want.near * 0.02 || want.far !== nearFar.current.far) {
      nearFar.current = want;
      cam.near = want.near; cam.far = want.far; cam.updateProjectionMatrix();
    }
  }, -2);
  return null;
}

/** Blender navigation: orbit with the middle button, or Alt + left (the "emulate 3 button mouse" setting for trackpads). */
function Navigation({ onUserOrbit }: { onUserOrbit: (() => void) | undefined }) {
  const controls = useThree((st) => st.controls) as unknown as (THREE.EventDispatcher<{ start: object }> & { mouseButtons: typeof MOUSE_BUTTONS }) | null;
  const cb = useRef(onUserOrbit);
  cb.current = onUserOrbit;
  useEffect(() => {
    if (!controls) return;
    const start = () => cb.current?.();
    controls.addEventListener("start", start);
    const alt = (on: boolean) => { MOUSE_BUTTONS.LEFT = on ? THREE.MOUSE.ROTATE : NO_BUTTON; };
    const kd = (e: KeyboardEvent) => { if (e.key === "Alt") alt(true); };
    const ku = (e: KeyboardEvent) => { if (e.key === "Alt") alt(false); };
    const off = () => alt(false);
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku); window.addEventListener("blur", off);
    return () => { controls.removeEventListener("start", start); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("blur", off); off(); };
  }, [controls]);
  return null;
}

/** Reports the view's name the way Blender writes it in the corner: "Front Orthographic", "User Perspective". */
function ViewLabel({ lens, onLabel }: { lens: boolean; onLabel: ((l: string) => void) | undefined }) {
  const { camera } = useThree();
  const last = useRef("");
  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.getWorldDirection(dir);
    const kind = cam.fov < PERSP_FOV - 1 && !lens ? "Orthographic" : "Perspective";
    const label = lens ? `Camera ${kind}` : `${viewName(dir.toArray() as Vec3)} ${kind}`;
    if (label !== last.current) { last.current = label; onLabel?.(label); }
  });
  return null;
}

/** G: move a key with the mouse like Blender's grab. Free movement is in the plane facing the view; X/Y/Z constrain to a world axis. */
function GrabController({ grab, snap, onPreview, onEnd }: { grab: { frame: number; start: Vec3 } | null; snap: boolean; onPreview: Props["onGrabPreview"]; onEnd: Props["onGrabEnd"] }) {
  const { camera, gl } = useThree();
  const pointer = useRef({ x: 0, y: 0 });
  const live = useRef({ grab, snap, onPreview, onEnd });
  live.current = { grab, snap, onPreview, onEnd };
  useEffect(() => {
    const move = (e: PointerEvent) => { pointer.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointermove", move, true);
    return () => window.removeEventListener("pointermove", move, true);
  }, []);
  useEffect(() => {
    if (!grab) return;
    const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as const;
    const ray = () => {
      const r = gl.domElement.getBoundingClientRect();
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(((pointer.current.x - r.left) / r.width) * 2 - 1, -(((pointer.current.y - r.top) / r.height) * 2 - 1)), camera);
      return { o: rc.ray.origin.toArray() as Vec3, d: rc.ray.direction.toArray() as Vec3 };
    };
    let axis: "x" | "y" | "z" | null = null;
    const hit = (): Vec3 => {
      const { o, d } = ray();
      if (axis) return closestOnAxis(o, d, grab.start, [...AXES[axis]] as Vec3);
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
      return rayPlane(o, d, grab.start, fwd.toArray() as Vec3) ?? grab.start;
    };
    let p0 = hit();
    let pos: Vec3 = grab.start;
    const update = () => {
      const p = hit();
      pos = snapPoint([grab.start[0] + p[0] - p0[0], grab.start[1] + p[1] - p0[1], grab.start[2] + p[2] - p0[2]], { on: live.current.snap });
      live.current.onPreview?.({ frame: grab.frame, pos, axis });
    };
    const finish = (commit: boolean) => { live.current.onPreview?.(null); live.current.onEnd?.(grab.frame, commit ? pos : null); };
    const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    const kd = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "x" || k === "y" || k === "z") { stop(e); axis = axis === k ? null : k; p0 = hit(); update(); }
      else if (k === "enter") { stop(e); finish(true); }
      else if (k === "escape") { stop(e); finish(false); }
      else stop(e); // nothing else is handled while grabbing
    };
    const pm = () => update();
    const pd = (e: PointerEvent) => { stop(e); finish(e.button === 0); };
    window.addEventListener("keydown", kd, true);
    window.addEventListener("pointermove", pm, true);
    window.addEventListener("pointerdown", pd, true);
    update();
    return () => { window.removeEventListener("keydown", kd, true); window.removeEventListener("pointermove", pm, true); window.removeEventListener("pointerdown", pd, true); };
  }, [grab, camera, gl]);
  return null;
}

/** Through-the-lens: put the editor camera on the shot camera, with overscan so the frame mask has context around it. */
function LensRig({ pose, aspect, active }: { pose: Pose; aspect: number; active: boolean }) {
  const { camera, size } = useThree();
  const saved = useRef<{ p: THREE.Vector3; q: THREE.Quaternion; fov: number } | null>(null);
  const poseRef = useRef(pose);
  poseRef.current = pose;
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (active) {
      saved.current = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov };
      return () => {
        const s = saved.current;
        if (s) { cam.position.copy(s.p); cam.quaternion.copy(s.q); cam.fov = s.fov; cam.updateProjectionMatrix(); }
      };
    }
  }, [active, camera]);
  useFrame(() => {
    if (!active) return;
    const cam = camera as THREE.PerspectiveCamera;
    const p = poseRef.current;
    const frame = lensFrame(size.width, size.height, aspect);
    cam.position.set(...p.position);
    cam.quaternion.set(...p.quaternion);
    cam.fov = overscanFov(p.fov_v_deg, size.height, frame.h);
    cam.updateProjectionMatrix();
  }, -1);
  return null;
}

/** Renders the editor view, then the shot camera into a scissored picture-in-picture box. */
function PipRenderer({ pose, aspect, enabled, helpers }: { pose: Pose; aspect: number; enabled: boolean; helpers: React.RefObject<THREE.Group | null> }) {
  const shotCam = useMemo(() => new THREE.PerspectiveCamera(40, 1, 0.05, 200), []);
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const { gl } = useThree();
  useFrame(({ scene, camera, size }) => {
    gl.setScissorTest(false);
    gl.clear();
    gl.setViewport(0, 0, size.width, size.height);
    gl.render(scene, camera);
    if (!enabled) return;
    const p = poseRef.current;
    const a = aspectRef.current;
    const maxW = Math.min(360, size.width * 0.4);
    const maxH = size.height * 0.4;
    const w = Math.min(maxW, maxH * a);
    const h = w / a;
    const x = size.width - w - 12;
    const y = 12; // from the bottom-left origin used by setViewport
    shotCam.fov = p.fov_v_deg;
    shotCam.aspect = a;
    shotCam.position.set(...p.position);
    shotCam.quaternion.set(...p.quaternion);
    shotCam.updateProjectionMatrix();
    shotCam.updateMatrixWorld();
    const prevVisible = helpers.current?.visible ?? true;
    if (helpers.current) helpers.current.visible = false;
    gl.setScissorTest(true);
    gl.setViewport(x, y, w, h);
    gl.setScissor(x, y, w, h);
    gl.clearDepth();
    gl.render(scene, shotCam);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
    if (helpers.current) helpers.current.visible = prevVisible;
  }, 1);
  return null;
}

function Gizmos({ doc, frame, pose, gizmo, snap, onGizmoCommit }: Pick<Props, "doc" | "frame" | "gizmo" | "onGizmoCommit"> & { pose: Pose; snap: boolean }) {
  const [posObj, setPosObj] = useState<THREE.Mesh | null>(null);
  const [aimObj, setAimObj] = useState<THREE.Mesh | null>(null);
  const aim = evalChannel(doc, "aim", frame);
  const active = gizmo === "position" ? posObj : aimObj;
  return (
    <>
      <mesh ref={setPosObj} position={pose.position}>
        <boxGeometry args={[0.25, 0.25, 0.25]} />
        <meshBasicMaterial color="#ffd23f" />
      </mesh>
      <mesh ref={setAimObj} position={aim}>
        <octahedronGeometry args={[0.15]} />
        <meshBasicMaterial color="#ff5a7a" />
      </mesh>
      <Line points={[pose.position, aim]} color="#ff5a7a" lineWidth={1} dashed dashSize={0.15} gapSize={0.1} />
      {active && (
        <TransformControls
          key={gizmo}
          object={active}
          mode="translate"
          size={0.8}
          {...(snap ? { translationSnap: 0.25 } : {})}
          onMouseUp={() => {
            const p = active.position;
            onGizmoCommit(gizmo, [p.x, p.y, p.z]);
          }}
        />
      )}
    </>
  );
}

export function Viewport({ doc, frame, poses, recovered, gizmo, showPip, readOnly, lens, viewCmd, framing, overlays = DEFAULT_OVERLAYS, ortho = false, shading = "solid", onUserOrbit, onViewLabel, grab = null, onGrabPreview, onGrabEnd, snap, selectedKeyFrame, onSelectKey, onKeyMove, onGizmoCommit, onAssetError }: Props) {
  const helpers = useRef<THREE.Group>(null);
  const pose = poses[Math.min(frame, poses.length - 1)]!;
  const aspect = doc.resolution.width / doc.resolution.height;
  const pathPoints = useMemo(() => poses.map((p) => p.position), [poses]);
  const [preview, setPreview] = useState<{ frame: number; pos: Vec3 } | null>(null);
  const depthMat = useMemo(() => (shading === "depth" ? makeDepthMaterial() : null), [shading]);
  useEffect(() => {
    if (!depthMat) return;
    depthMat.uniforms.camPos!.value.set(...pose.position);
    depthMat.uniforms.fwd!.value.set(0, 0, -1).applyQuaternion(new THREE.Quaternion(...pose.quaternion));
  }, [depthMat, pose]);
  // Recovered camera nearest the current frame, drawn as a cyan ghost frustum with a ray along its view direction
  // (same length as the authored camera-to-aim distance), so a rotation drift is visible even when the path matches.
  const nearest = useMemo(() => recovered?.poses.reduce((a, b) => (Math.abs(b.frame - frame) < Math.abs(a.frame - frame) ? b : a)) ?? null, [recovered, frame]);
  const ghost: Pose | null = nearest ? { frame: nearest.frame, t: 0, position: nearest.position, quaternion: nearest.quaternion, fov_v_deg: nearest.fovDeg } : null;
  const aimDist = Math.hypot(...(evalChannel(doc, "aim", frame).map((v, i) => v - pose.position[i]!) as Vec3));
  const ghostAim: Vec3 = ghost
    ? (new THREE.Vector3(0, 0, -aimDist).applyQuaternion(new THREE.Quaternion(...ghost.quaternion)).add(new THREE.Vector3(...ghost.position)).toArray() as Vec3)
    : [0, 0, 0];
  return (
    <Canvas camera={{ position: [9, 7, 11], fov: PERSP_FOV, near: 0.1, far: 500 }} gl={{ antialias: true }} style={{ background: "#0e0e0e" }}>
      <color attach="background" args={[shading === "depth" ? "#000000" : "#0e0e0e"]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[6, 10, 4]} intensity={1.2} />
      <SceneObjects doc={doc} depthMat={depthMat} onAssetError={onAssetError} />
      <ViewCommands cmd={viewCmd} framing={framing} />
      <ProjectionSwitch ortho={ortho} lens={Boolean(lens)} />
      <Navigation onUserOrbit={onUserOrbit} />
      <ViewLabel lens={Boolean(lens)} onLabel={onViewLabel} />
      <LensRig pose={pose} aspect={aspect} active={Boolean(lens)} />
      {!readOnly && (
        <GrabController
          grab={grab} snap={Boolean(snap)}
          onPreview={(i) => { setPreview(i ? { frame: i.frame, pos: i.pos } : null); onGrabPreview?.(i); }}
          onEnd={(f, pos) => { setPreview(null); onGrabEnd?.(f, pos); }}
        />
      )}
      <group ref={helpers} visible={!lens}>
        {overlays.grid && <Grid args={[40, 40]} cellSize={1} sectionSize={5} cellColor="#262626" sectionColor="#3d3d3d" fadeDistance={ortho ? 4000 : 60} infiniteGrid position={[0, 0.002, 0]} />}
        {overlays.frustum && <FrustumGizmo pose={pose} aspect={aspect} />}
        {overlays.path && <Line points={pathPoints} color="#ffd23f" lineWidth={2} />}
        {overlays.path && (readOnly
          ? doc.position.map((k) => (
              <mesh key={`pk${k.frame}`} position={k.value}>
                <sphereGeometry args={[0.1, 12, 12]} />
                <meshBasicMaterial color="#ffffff" />
              </mesh>
            ))
          : <KeyHandles keys={doc.position} selected={selectedKeyFrame ?? null} snap={Boolean(snap)} override={preview} onSelect={(f) => onSelectKey?.(f)} onMove={(f, v) => onKeyMove?.(f, v)} />)}
        {overlays.ghosts && poses.filter((p) => p.frame % 20 === 0 && p.frame !== frame).map((p) => <FrustumGizmo key={`g${p.frame}`} pose={p} aspect={aspect} color="#6b5a22" />)}
        {recovered && recovered.path.length > 1 && <Line points={recovered.path} color="#3fd2ff" lineWidth={2} />}
        {ghost && <FrustumGizmo pose={ghost} aspect={aspect} color="#3fd2ff" />}
        {ghost && <Line points={[ghost.position, ghostAim]} color="#3fd2ff" lineWidth={2} />}
        {!readOnly && <Gizmos doc={doc} frame={frame} pose={pose} gizmo={gizmo} snap={Boolean(snap)} onGizmoCommit={onGizmoCommit} />}
      </group>
      <OrbitControls makeDefault enabled={!lens && !grab} enableDamping={false} screenSpacePanning mouseButtons={readOnly ? VIEWER_BUTTONS : MOUSE_BUTTONS} target={[0, 1, 0]} />
      <PipRenderer pose={pose} aspect={aspect} enabled={showPip && !lens} helpers={helpers} />
      {!lens && (
        <GizmoHelper alignment="top-right" margin={[64, 64]} renderPriority={2}>
          <GizmoViewport axisColors={["#e0526b", "#7fc24f", "#4a8fe0"]} labelColor="#ffffff" />
        </GizmoHelper>
      )}
    </Canvas>
  );
}
