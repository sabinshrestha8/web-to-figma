import { readFileSync } from "node:fs";
import { DIAGNOSTIC_CODES, Document } from "@w2f/ir";
import { expect, it } from "vitest";
import { z } from "zod";

const doc = (name: string) => readFileSync(new URL(`../docs/${name}`, import.meta.url), "utf8");

it("docs/ir.schema.json matches the zod schema (run `pnpm test -u` to regenerate)", async () => {
  const schema = z.toJSONSchema(Document, { target: "draft-2020-12", io: "input" });
  await expect(`${JSON.stringify(schema, null, 2)}\n`).toMatchFileSnapshot("../docs/ir.schema.json");
});

it("docs/diagnostics.md documents every diagnostic code with its severity", () => {
  const md = doc("diagnostics.md");
  for (const [code, severity] of Object.entries(DIAGNOSTIC_CODES)) {
    expect(md, code).toContain(`| \`${code}\` | ${severity} |`);
  }
});
