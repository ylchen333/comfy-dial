// pnpm preflight: list the nodes and model files a local ComfyUI is missing for the loop. Costs nothing.
import { resolve } from "node:path";
import { loadEnvFile } from "./env.ts";
import { checkAll, formatFindings } from "./preflight.ts";
import { resolveTarget } from "./cli-client.ts";
import { SRC_DIR } from "./tools.ts";

const env = { ...loadEnvFile(resolve(SRC_DIR, ".env")), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("COMFY_"))) };
if (resolveTarget(env.COMFY_BASE_URL)[1] === "cloud") {
  console.error("COMFY_BASE_URL is empty or Comfy Cloud: preflight is for a local ComfyUI. Set it to your server (e.g. http://127.0.0.1:8000).");
  process.exit(2);
}
const base = env.COMFY_BASE_URL!.replace(/\/$/, "");
try {
  const res = await fetch(`${base}/object_info`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const findings = checkAll((await res.json()) as Parameters<typeof checkAll>[0]);
  console.log(`${base}\n${formatFindings(findings)}`);
  process.exit(findings.length ? 1 : 0);
} catch (e) {
  console.error(`cannot read ${base}/object_info: ${(e as Error).message}\nIs ComfyUI running? Desktop uses the port in Settings > Server (usually 8000), not 8188.`);
  process.exit(2);
}
