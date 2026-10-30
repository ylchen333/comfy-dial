// Hosted-demo guard: when COMFY_DEMO_CODE is set, every call that spends Comfy Cloud credits needs the access code
// (x-demo-code header) and draws on a persisted budget (COMFY_DEMO_BUDGET credits). Reads and dry runs stay open.
import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";

export const DEFAULT_DEMO_BUDGET = 150;

export class GateError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Gate {
  /** True when an access code is configured (hosted mode). */
  readonly gated: boolean;
  readonly budget: number;
  spent(): number;
  /** Throws GateError unless the request carries the code and the budget covers `credits`; then records the spend. */
  charge(req: IncomingMessage, credits: number): void;
  /** Gives credits back after a spend that never reached the cloud. */
  refund(credits: number): void;
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createGate(env: Record<string, string | undefined>, runsDir: string): Gate {
  const code = env.COMFY_DEMO_CODE ?? "";
  const budget = Number(env.COMFY_DEMO_BUDGET ?? DEFAULT_DEMO_BUDGET);
  const file = join(runsDir, "demo-budget.json");
  let spent = 0;
  try {
    if (existsSync(file)) spent = Number((JSON.parse(readFileSync(file, "utf8")) as { spent?: number }).spent) || 0;
  } catch { /* a corrupt ledger starts at zero rather than blocking the demo */ }
  const save = () => writeFileSync(file, JSON.stringify({ spent }));
  return {
    gated: code !== "",
    budget,
    spent: () => spent,
    charge(req, credits) {
      if (!code) return;
      const given = req.headers["x-demo-code"];
      if (typeof given !== "string" || !same(given, code)) throw new GateError(401, "live generation on this demo needs the access code");
      if (spent + credits > budget) throw new GateError(402, `demo credit budget used up (${spent} of ${budget}); dry runs are still free`);
      spent += credits;
      save();
    },
    refund(credits) {
      if (!code) return;
      spent = Math.max(0, spent - credits);
      save();
    },
  };
}
