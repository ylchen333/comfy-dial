// Real-run safety: cost estimate and hard limits for --live.
export const CREDITS_PER_TAKE = 11; // measured on Cloud (spike-cloud, 121 frames, 8-step distilled)
export const CREDITS_PER_DA3 = 1; // da3_base on a 31-frame clip: under 1 visible credit, rounded up
export const MAX_LIVE_TAKES = 4;
export const MAX_LIVE_CREDITS = 60;

export const estimateCredits = (n: number) => n * (CREDITS_PER_TAKE + CREDITS_PER_DA3);

/** Returns an error message when a live run must be refused, else null. */
export function liveRefusal(n: number, apiKey: string | undefined): string | null {
  if (!Number.isInteger(n) || n < 1) return `--n must be a positive integer, got ${n}`;
  if (!apiKey) return "--live needs COMFY_API_KEY in src/.env";
  if (n > MAX_LIVE_TAKES) return `refusing live run: n=${n} exceeds the cap of ${MAX_LIVE_TAKES} takes`;
  const est = estimateCredits(n);
  if (est > MAX_LIVE_CREDITS) return `refusing live run: estimated ${est} credits exceeds the cap of ${MAX_LIVE_CREDITS}`;
  return null;
}
