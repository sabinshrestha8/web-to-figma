import { DIAGNOSTIC_CODES } from "@w2f/ir";
import { describe, expect, it } from "vitest";
import { unknownDiagnosticCodes } from "./unknown-codes.ts";

const bundle = (codes: unknown[]) => ({ ir: { diagnostics: codes.map((code) => ({ code })) } });

describe("unknownDiagnosticCodes", () => {
  it("names codes this build doesn't know, e.g. from a newer capture", () => {
    expect(unknownDiagnosticCodes(bundle(["NOTCHED_OUTLINE", "BOGUS_X", "TIMEOUT", 42, null]))).toEqual([
      "BOGUS_X",
    ]);
  });

  it("stays quiet for every code this build knows", () => {
    expect(unknownDiagnosticCodes(bundle(Object.keys(DIAGNOSTIC_CODES)))).toEqual([]);
  });

  it("stays quiet for garbage input", () => {
    for (const json of [null, 42, "x", [], {}, { ir: null }, { ir: { diagnostics: null } }, { ir: {} }]) {
      expect(unknownDiagnosticCodes(json)).toEqual([]);
    }
  });
});
