// Real-run safety: cost estimate and hard limits for --live.
// Measured Oct 22: 4 takes + 4 DA3 on a warm worker cost 19-21 credits (about 0.25 credits per GPU-second);
// a single cold-start take plus DA3 cost 12. Estimate = warm cost per take + one cold-start margin.
export const CREDITS_PER_TAKE = 4;
export const CREDITS_PER_DA3 = 1;
export const COLD_START_CREDITS = 8;
export const MAX_LIVE_TAKES = 5;
export const MAX_LIVE_CREDITS = 60;

/** One repair = one take-length job + one DA3 re-solve + a cold-start margin. Measured: 8 credits on a warm worker (Oct 26). */
export const REPAIR_CREDITS = CREDITS_PER_TAKE + CREDITS_PER_DA3 + COLD_START_CREDITS;

/** One reference video = one DA3 pose job plus a cold-start margin (no generation job). Free on a local server. */
export const REFERENCE_CREDITS = CREDITS_PER_DA3 + COLD_START_CREDITS;
export const MAX_REFERENCE_BYTES = 60 * 1024 * 1024;
export const MAX_REFERENCE_SECONDS = 90;
export const REFERENCE_SAMPLES = 32;

export const estimateCredits = (n: number) => n * (CREDITS_PER_TAKE + CREDITS_PER_DA3) + COLD_START_CREDITS;

/** Returns an error message when a live run must be refused, else null. */
export function liveRefusal(n: number, apiKey: string | undefined): string | null {
  if (!Number.isInteger(n) || n < 1) return `--n must be a positive integer, got ${n}`;
  if (!apiKey) return "--live needs COMFY_API_KEY in src/.env";
  if (n > MAX_LIVE_TAKES) return `refusing live run: n=${n} exceeds the cap of ${MAX_LIVE_TAKES} takes`;
  const est = estimateCredits(n);
  if (est > MAX_LIVE_CREDITS) return `refusing live run: estimated ${est} credits exceeds the cap of ${MAX_LIVE_CREDITS}`;
  return null;
}

/** One generated actor = one FLUX schnell image (4 steps) + one Hunyuan3D 2.1 shape job + a cold-start margin. Measured Oct 29: 4 credits and 74 s on a warm worker (one sample), plus the usual 8 margin. */
export const ACTOR_CREDITS = 12;
export const MAX_ACTOR_IMAGE_BYTES = 12 * 1024 * 1024;
