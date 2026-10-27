// Local-mode preflight: does this ComfyUI have every node and model file the loop's graphs ask for?
// Pure check over an /object_info document, so it is testable without a server. `pnpm preflight` fetches it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Graph } from "./client.ts";
import { DA3_MODEL, WORKFLOWS_DIR } from "./graph.ts";

type ObjectInfo = Record<string, { api_node?: boolean; input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }>;

export interface Finding {
  kind: "missing-node" | "missing-model" | "partner-node";
  workflow: string;
  node: string;
  detail: string;
}

/** Workflows the loop submits. Per-run inputs (the uploaded video name) are not model files and are skipped. */
export const LOOP_WORKFLOWS = ["ltx25_union_depth.api.json", "ltx25_extend_segment.api.json", "da3_poses.api.json"] as const;
const PER_RUN_INPUTS = new Set(["file"]);

export function checkGraph(workflow: string, g: Graph, info: ObjectInfo): Finding[] {
  const out: Finding[] = [];
  for (const [id, node] of Object.entries(g)) {
    const spec = info[node.class_type];
    const where = `${id} ${node.class_type}`;
    if (!spec) {
      out.push({ kind: "missing-node", workflow, node: where, detail: `node class ${node.class_type} is not installed` });
      continue;
    }
    if (spec.api_node) out.push({ kind: "partner-node", workflow, node: where, detail: "partner/API node: not allowed (Open Weights Only)" });
    const inputs = { ...spec.input?.required, ...spec.input?.optional };
    for (const [name, value] of Object.entries(node.inputs)) {
      if (typeof value !== "string" || PER_RUN_INPUTS.has(name)) continue;
      const def = inputs[name];
      const choices = Array.isArray(def) && Array.isArray(def[0]) ? (def[0] as unknown[]) : null;
      if (choices && !choices.includes(value)) out.push({ kind: "missing-model", workflow, node: `${where}.${name}`, detail: value });
    }
  }
  return out;
}

export function loadLoopGraphs(): Record<string, Graph> {
  const graphs: Record<string, Graph> = {};
  for (const f of LOOP_WORKFLOWS) {
    const g = JSON.parse(readFileSync(resolve(WORKFLOWS_DIR, f), "utf8")) as Graph;
    // The pose graph ships with da3_small; the server runs DA3_MODEL, so check the one it will actually ask for.
    for (const n of Object.values(g)) if (n.class_type === "DownloadAndLoadDepthAnythingV3Model") n.inputs.model = DA3_MODEL;
    graphs[f] = g;
  }
  return graphs;
}

export const checkAll = (info: ObjectInfo, graphs = loadLoopGraphs()): Finding[] =>
  Object.entries(graphs).flatMap(([w, g]) => checkGraph(w, g, info));

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "preflight ok: every node and model the loop needs is present, no partner nodes.";
  const group = (k: Finding["kind"], title: string) => {
    const rows = findings.filter((f) => f.kind === k);
    if (!rows.length) return [];
    return [title, ...[...new Map(rows.map((r) => [`${r.node}|${r.detail}`, r])).values()].map((r) => `  ${r.detail}   (${r.workflow} ${r.node})`)];
  };
  return [
    ...group("missing-node", "MISSING NODES (install the node pack):"),
    ...group("missing-model", "MISSING MODEL FILES (download into the matching ComfyUI models/ folder):"),
    ...group("partner-node", "PARTNER NODES (remove):"),
  ].join("\n");
}
