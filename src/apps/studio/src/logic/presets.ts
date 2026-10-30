// Move presets: thin wrapper over rig-core's presets that turns their Shot into editable keyframes.
import { dolly, dollyZoom, orbit, pan, pullOut, pushIn, zoom, type Vec3 } from "@comfy-dial/rig-core";
import type { Shot } from "@comfy-dial/contracts";
import { docFromShot } from "./compile.ts";
import { evalChannel, replaceKeys } from "./keys.ts";
import { focalToFov } from "./lens.ts";
import type { StudioDoc } from "./types.ts";

export const PRESET_IDS = ["push-in", "orbit", "pan", "zoom-only", "dolly-zoom"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const PRESET_LABELS: Record<PresetId, string> = {
  "push-in": "Push-in",
  orbit: "Orbit",
  pan: "Pan",
  "zoom-only": "Zoom only",
  "dolly-zoom": "Dolly zoom",
};

/** Build the rig-core Shot for a preset, framed on the doc's subject and starting at its first lens. */
export function presetShot(doc: StudioDoc, id: PresetId): Shot {
  const fovDeg = focalToFov(evalChannel(doc, "focal", 0), doc.sensorHeightMm);
  const subject = (doc.scene.nodes.find((n) => n.id === "subject")?.transform.position as Vec3 | undefined) ?? [0, 1, 0];
  const base = { id: doc.id, frames: doc.frames, scene: doc.scene, target: subject };
  switch (id) {
    case "push-in": return pushIn({ ...base, from: 7, to: 3, fovDeg });
    case "orbit": return orbit({ ...base, radius: 5, startDeg: -45, endDeg: 45, fovDeg });
    case "pan": return pan({ ...base, distance: 6, yawDeg: 30, fovDeg });
    case "zoom-only": return zoom({ ...base, distance: 6, fromFovDeg: fovDeg, toFovDeg: fovDeg * 0.5 });
    case "dolly-zoom": return dollyZoom({ ...base, from: 8, to: 3, fovDeg });
  }
}

/** Replace the doc's keys with the preset's (frame-aligned, linear easing), keeping scene/lens/resolution. */
export function applyPreset(doc: StudioDoc, id: PresetId): StudioDoc {
  const shot = presetShot(doc, id);
  const keys = docFromShot(shot, { sensorHeightMm: doc.sensorHeightMm });
  return replaceKeys(doc, keys);
}

export { dolly, pullOut };
