import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, Line, OrbitControls, TransformControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Pose, Vec3 } from "@comfy-osh/rig-core";
import { evalChannel } from "../logic/keys.ts";
import type { StudioDoc } from "../logic/types.ts";

export type GizmoTarget = "position" | "aim";

interface Props {
  doc: StudioDoc;
  frame: number;
  poses: Pose[];
  recovered: Vec3[] | null;
  gizmo: GizmoTarget;
  showPip: boolean;
  onGizmoCommit: (target: GizmoTarget, value: Vec3) => void;
}

const FRUSTUM_DEPTH = 2.2;

function SceneObjects({ doc }: { doc: StudioDoc }) {
  return (
    <>
      {doc.scene.nodes.map((n) => {
        const t = n.transform;
        const kind = n.asset.replace("primitive:", "");
        if (kind === "plane") return null; // the ground is drawn by the editor grid
        const common = { position: t.position as Vec3, quaternion: new THREE.Quaternion(...t.quaternion) };
        if (n.id === "subject") {
          const r = t.scale[0] / 2;
          return (
            <mesh key={n.id} {...common} castShadow>
              <capsuleGeometry args={[r, Math.max(0.01, t.scale[1] - 2 * r), 8, 16]} />
              <meshStandardMaterial color="#e8903f" />
            </mesh>
          );
        }
        return (
          <mesh key={n.id} {...common} scale={t.scale as Vec3} castShadow>
            {kind === "cylinder" ? <cylinderGeometry args={[0.5, 0.5, 1, 24]} /> : <boxGeometry args={[1, 1, 1]} />}
            <meshStandardMaterial color="#5a80d9" />
          </mesh>
        );
      })}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#6b8c61" />
      </mesh>
    </>
  );
}

/** Wireframe pyramid + far rectangle in camera space (looks down -Z). */
function FrustumGizmo({ pose, aspect }: { pose: Pose; aspect: number }) {
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
        <lineBasicMaterial color="#ffd23f" />
      </lineSegments>
    </group>
  );
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

function Gizmos({ doc, frame, pose, gizmo, onGizmoCommit }: Pick<Props, "doc" | "frame" | "gizmo" | "onGizmoCommit"> & { pose: Pose }) {
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
          onMouseUp={() => {
            const p = active.position;
            onGizmoCommit(gizmo, [p.x, p.y, p.z]);
          }}
        />
      )}
    </>
  );
}

export function Viewport({ doc, frame, poses, recovered, gizmo, showPip, onGizmoCommit }: Props) {
  const helpers = useRef<THREE.Group>(null);
  const pose = poses[Math.min(frame, poses.length - 1)]!;
  const aspect = doc.resolution.width / doc.resolution.height;
  const pathPoints = useMemo(() => poses.map((p) => p.position), [poses]);
  return (
    <Canvas camera={{ position: [9, 7, 11], fov: 45, near: 0.1, far: 500 }} gl={{ antialias: true }} style={{ background: "#1b1e24" }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[6, 10, 4]} intensity={1.2} />
      <SceneObjects doc={doc} />
      <group ref={helpers}>
        <Grid args={[40, 40]} cellSize={1} sectionSize={5} cellColor="#3a4150" sectionColor="#566074" fadeDistance={60} infiniteGrid position={[0, 0.002, 0]} />
        <FrustumGizmo pose={pose} aspect={aspect} />
        <Line points={pathPoints} color="#ffd23f" lineWidth={2} />
        {doc.position.map((k) => (
          <mesh key={`pk${k.frame}`} position={k.value}>
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        ))}
        {recovered && recovered.length > 1 && <Line points={recovered} color="#3fd2ff" lineWidth={2} />}
        <Gizmos doc={doc} frame={frame} pose={pose} gizmo={gizmo} onGizmoCommit={onGizmoCommit} />
      </group>
      <OrbitControls makeDefault enableDamping={false} target={[0, 1, 0]} />
      <PipRenderer pose={pose} aspect={aspect} enabled={showPip} helpers={helpers} />
    </Canvas>
  );
}
