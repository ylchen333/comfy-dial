// pnpm serve: the studio's local API on 127.0.0.1:5198 (Vite proxies /api to it).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApi } from "./api.ts";
import { loadEnvFile } from "./env.ts";
import { SRC_DIR } from "./tools.ts";

const here = dirname(fileURLToPath(import.meta.url));
const env = { ...loadEnvFile(resolve(SRC_DIR, ".env")), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("COMFY_"))) };
const port = Number(process.env.PORT ?? 5198);
createApi({ runsDir: resolve(here, "..", ".runs", "studio"), env }).listen(port, "127.0.0.1", () => {
  console.log(`studio API on http://127.0.0.1:${port} (live runs ${env.COMFY_API_KEY ? "available" : "disabled: no COMFY_API_KEY"})`);
});
