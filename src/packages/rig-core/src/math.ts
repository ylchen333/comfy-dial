// Vector / quaternion helpers. Convention: right-handed, Y-up, three.js; camera looks down local -Z;
// quaternions are [x, y, z, w] and map camera-local -> world.
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const normalize = (a: Vec3): Vec3 => {
  const n = len(a);
  return [a[0] / n, a[1] / n, a[2] / n];
};
export const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [
  a[0] + (b[0] - a[0]) * u,
  a[1] + (b[1] - a[1]) * u,
  a[2] + (b[2] - a[2]) * u,
];

export const quatNormalize = (q: Quat): Quat => {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
};

/** Shortest-arc slerp; falls back to normalized lerp when nearly parallel. */
export function slerp(a: Quat, b: Quat, u: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb: Quat = b;
  if (d < 0) {
    d = -d;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (d > 0.999999) {
    return quatNormalize([
      a[0] + (bb[0] - a[0]) * u,
      a[1] + (bb[1] - a[1]) * u,
      a[2] + (bb[2] - a[2]) * u,
      a[3] + (bb[3] - a[3]) * u,
    ]);
  }
  const theta = Math.acos(d);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - u) * theta) / s;
  const wb = Math.sin(u * theta) / s;
  return quatNormalize([
    a[0] * wa + bb[0] * wb,
    a[1] * wa + bb[1] * wb,
    a[2] * wa + bb[2] * wb,
    a[3] * wa + bb[3] * wb,
  ]);
}

/** Row-major 3x3 rotation matrix (camera/local -> world) from a unit quaternion. */
export function quatToMat3(q: Quat): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  const m = quatToMat3(q);
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

/** Camera quaternion for a camera at `eye` looking at `target` (three.js Matrix4.lookAt, up = +Y). */
export function lookAtQuat(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Quat {
  const z = normalize(sub(eye, target)); // camera +Z points away from the target
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return quatNormalize(q);
}

/** Rotation of `deg` about +Y (positive = counter-clockwise seen from above = pan left). */
export const yawQuat = (deg: number): Quat => {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
};

/** Geodesic angle between two unit quaternions, in degrees. */
export function quatAngleDeg(a: Quat, b: Quat): number {
  const d = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return (2 * Math.acos(d) * 180) / Math.PI;
}
