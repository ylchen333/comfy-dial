// zod mirror of schema/*.schema.json. The JSON Schemas are the source of truth;
// the refinements below enforce the cross-field rules JSON Schema cannot express.
import { z } from "zod";

export const FPS = 25;
export const UNIT_QUAT_TOLERANCE = 1e-6;

const nonEmpty = z.string().min(1);
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const quat = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const frameRange = z.strictObject({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
});

const isUnit = (q: readonly number[]) =>
  Math.abs(Math.hypot(...q) - 1) <= UNIT_QUAT_TOLERANCE;

export const isLtxFrameCount = (n: number) => Number.isInteger(n) && n >= 9 && (n - 1) % 8 === 0;

const sceneNode = z.strictObject({
  id: nonEmpty,
  asset: nonEmpty,
  transform: z.strictObject({ position: vec3, quaternion: quat, scale: vec3 }),
});

const keyframe = z.strictObject({
  t: z.number().min(0),
  position: vec3,
  quaternion: quat,
  fov_v_deg: z.number().gt(0).lt(180),
});

export const Shot = z
  .strictObject({
    version: z.literal(1),
    id: nonEmpty,
    name: z.string().optional(),
    scene: z.strictObject({ nodes: z.array(sceneNode) }),
    fps: z.literal(FPS),
    frames: z.number().int().min(9),
    resolution: z.strictObject({
      width: z.number().int().min(64).multipleOf(32),
      height: z.number().int().min(64).multipleOf(32),
    }),
    track: z.array(keyframe).min(2),
    segments: z.array(frameRange).min(1),
  })
  .superRefine((s, ctx) => {
    if (!isLtxFrameCount(s.frames)) {
      ctx.addIssue({ code: "custom", path: ["frames"], message: "frames must be 1 + 8k" });
    }
    const duration = (s.frames - 1) / s.fps;
    s.track.forEach((k, i) => {
      const prev = s.track[i - 1];
      if (prev && k.t <= prev.t) {
        ctx.addIssue({ code: "custom", path: ["track", i, "t"], message: "track t must be strictly increasing" });
      }
      if (k.t > duration + 1e-9) {
        ctx.addIssue({ code: "custom", path: ["track", i, "t"], message: "track t is past the last frame" });
      }
      if (!isUnit(k.quaternion)) {
        ctx.addIssue({ code: "custom", path: ["track", i, "quaternion"], message: "quaternion must be unit length" });
      }
    });
    let cursor = 0;
    s.segments.forEach((seg, i) => {
      if (seg.start !== cursor || seg.end <= seg.start) {
        ctx.addIssue({ code: "custom", path: ["segments", i], message: "segments must be contiguous and non-empty" });
      }
      cursor = seg.end;
    });
    if (cursor !== s.frames) {
      ctx.addIssue({ code: "custom", path: ["segments"], message: "segments must end at frames" });
    }
  });
export type Shot = z.infer<typeof Shot>;

export const ControlPacket = z
  .strictObject({
    shotId: nonEmpty,
    depthVideo: nonEmpty,
    depthNormalization: z.strictObject({
      mode: z.literal("fixed"),
      near: z.number().gt(0),
      far: z.number().gt(0),
    }),
    iclora: z.strictObject({ name: nonEmpty, strength: z.number().min(0).max(1) }),
  })
  .refine((p) => p.depthNormalization.far > p.depthNormalization.near, {
    path: ["depthNormalization", "far"],
    message: "far must be greater than near",
  });
export type ControlPacket = z.infer<typeof ControlPacket>;

export const CandidateStatus = z.enum(["pending", "submitted", "running", "succeeded", "failed"]);
export const Candidate = z.strictObject({
  id: nonEmpty,
  shotId: nonEmpty,
  seed: z.number().int().min(0),
  idempotencyKey: nonEmpty,
  jobId: z.string().nullable(),
  status: CandidateStatus,
  video: z.string().nullable(),
});
export type Candidate = z.infer<typeof Candidate>;

const err = z.number().min(0).nullable();
export const SegmentScore = z.strictObject({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  rotErrDeg: err,
  transErrPct: err,
  fovErrDeg: err,
  pass: z.boolean(),
});
export const ScoreReport = z
  .strictObject({
    candidateId: nonEmpty,
    solveOk: z.boolean(),
    mode: z.enum(["full", "rotation_only"]),
    rotErrDeg: err,
    transErrPct: err,
    fovErrDeg: err,
    perSegment: z.array(SegmentScore),
    composite: err,
    pass: z.boolean(),
  })
  .superRefine((r, ctx) => {
    if (r.solveOk) return;
    if (r.pass) ctx.addIssue({ code: "custom", path: ["pass"], message: "solveOk=false implies pass=false" });
    for (const k of ["rotErrDeg", "transErrPct", "fovErrDeg", "composite"] as const) {
      if (r[k] !== null) ctx.addIssue({ code: "custom", path: [k], message: "solveOk=false implies null errors" });
    }
  });
export type ScoreReport = z.infer<typeof ScoreReport>;

export const contracts = { Shot, ControlPacket, Candidate, ScoreReport } as const;
export type ContractName = keyof typeof contracts;
