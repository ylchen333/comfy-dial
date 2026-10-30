import { focalMmToVFovDeg, vFovDegToFocalMm } from "@comfy-dial/rig-core";

export const SENSOR_PRESETS = [
  { id: "ff", label: "Full frame (24 mm)", heightMm: 24 },
  { id: "s35", label: "Super 35 (18.66 mm)", heightMm: 18.66 },
  { id: "aps", label: "APS-C (15.7 mm)", heightMm: 15.7 },
  { id: "m43", label: "Micro 4/3 (13 mm)", heightMm: 13 },
] as const;

/** Resolutions are multiples of 32 as the Shot contract requires. */
export const ASPECT_PRESETS = [
  { id: "3:2", label: "3:2 (live-validated)", width: 768, height: 512 },
  { id: "21:9", label: "21:9", width: 1120, height: 480 },
  { id: "16:9", label: "16:9", width: 1024, height: 576 },
  { id: "9:16", label: "9:16", width: 576, height: 1024 },
] as const;

export function aspectIdOf(res: { width: number; height: number }): string {
  return ASPECT_PRESETS.find((a) => a.width === res.width && a.height === res.height)?.id ?? "custom";
}

export const focalToFov = (focalMm: number, sensorHeightMm: number) => focalMmToVFovDeg(focalMm, sensorHeightMm);
export const fovToFocal = (fovDeg: number, sensorHeightMm: number) => vFovDegToFocalMm(fovDeg, sensorHeightMm);
