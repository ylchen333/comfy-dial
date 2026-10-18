// Focal length <-> vertical FOV. Default sensor height 24 mm (35 mm full-frame, 36x24).
export const DEFAULT_SENSOR_HEIGHT_MM = 24;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function focalMmToVFovDeg(focalMm: number, sensorHeightMm = DEFAULT_SENSOR_HEIGHT_MM): number {
  return deg(2 * Math.atan(sensorHeightMm / (2 * focalMm)));
}

export function vFovDegToFocalMm(vFovDeg: number, sensorHeightMm = DEFAULT_SENSOR_HEIGHT_MM): number {
  return sensorHeightMm / (2 * Math.tan(rad(vFovDeg) / 2));
}

/** Focal length in pixels for an image of the given height (square pixels). */
export function vFovDegToFocalPx(vFovDeg: number, heightPx: number): number {
  return heightPx / (2 * Math.tan(rad(vFovDeg) / 2));
}

export function focalPxToVFovDeg(focalPx: number, heightPx: number): number {
  return deg(2 * Math.atan(heightPx / (2 * focalPx)));
}

export function vFovToHFovDeg(vFovDeg: number, width: number, height: number): number {
  return deg(2 * Math.atan((Math.tan(rad(vFovDeg) / 2) * width) / height));
}

/** Vertical FOV that keeps a subject at `d1` the same framed size as `fov0Deg` at `d0` (dolly zoom). */
export function dollyZoomFovDeg(fov0Deg: number, d0: number, d1: number): number {
  return deg(2 * Math.atan((Math.tan(rad(fov0Deg) / 2) * d0) / d1));
}
