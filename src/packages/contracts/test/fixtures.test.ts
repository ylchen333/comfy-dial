// One fixture set, two validators: the JSON Schema (ajv) and the zod mirror must agree.
// python/tests/test_fixtures.py runs the same fixtures through jsonschema + pydantic.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { contracts, type ContractName } from "../src/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const readJson = (...p: string[]): unknown => JSON.parse(readFileSync(join(root, ...p), "utf8"));

const schemaFile: Record<ContractName, string> = {
  Shot: "shot.schema.json",
  ControlPacket: "control-packet.schema.json",
  Candidate: "candidate.schema.json",
  ScoreReport: "score-report.schema.json",
  Poses: "poses.schema.json",
};

const ajv = new Ajv2020({ strict: true, allErrors: true });
for (const f of readdirSync(join(root, "schema"))) ajv.addSchema(readJson("schema", f) as object);
const jsonSchema = (name: ContractName) => {
  const id = `https://comfy-osh.dev/schema/${schemaFile[name]}`;
  const validate = ajv.getSchema(id);
  if (!validate) throw new Error(`schema not loaded: ${id}`);
  return validate;
};

const valid: [ContractName, string[]][] = [
  ...readdirSync(join(root, "fixtures/shots")).map((f): [ContractName, string[]] => ["Shot", ["fixtures/shots", f]]),
  ["ControlPacket", ["fixtures/control_packet.json"]],
  ["Candidate", ["fixtures/candidate.json"]],
  ["ScoreReport", ["fixtures/score_report.json"]],
  ["ScoreReport", ["fixtures/score_report_solve_failed.json"]],
  ["Poses", ["fixtures/poses.json"]],
  ["Poses", ["fixtures/poses_solve_failed.json"]],
];

describe("valid fixtures", () => {
  it("includes the five golden shots", () => {
    const shots = valid.filter(([c]) => c === "Shot").map(([, p]) => p[1]).sort();
    expect(shots).toEqual(["dolly_zoom.json", "orbit.json", "pan.json", "push_in.json", "zoom_only.json"]);
  });

  it.each(valid)("%s %j passes JSON Schema and zod", (name, path) => {
    const data = readJson(...path);
    const validate = jsonSchema(name);
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
    const parsed = contracts[name].safeParse(data);
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

describe("invalid fixtures", () => {
  const files = readdirSync(join(root, "fixtures/invalid"));
  it.each(files)("%s is rejected by zod", (file) => {
    const { contract, data } = readJson("fixtures/invalid", file) as { contract: ContractName; data: unknown };
    expect(contracts[contract].safeParse(data).success).toBe(false);
  });
});
