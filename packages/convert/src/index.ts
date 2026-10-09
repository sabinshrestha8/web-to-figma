import { type Capture, type Diagnostic, type Document, SCHEMA_VERSION } from "@w2f/ir";

export * from "./box.ts";
export * from "./css.ts";
export * from "./drift.ts";
export * from "./images.ts";
export * from "./layout.ts";
export * from "./paint.ts";
export * from "./rasters.ts";
export * from "./scale.ts";
export * from "./snapshot.ts";
export * from "./snapshot-to-ir.ts";
export * from "./text.ts";

export const GENERATOR = { name: "web-to-figma", version: "0.5.0" };

export function toDocument(
  captures: Capture[],
  assets: Document["assets"],
  diagnostics: Diagnostic[],
): Document {
  return { schemaVersion: SCHEMA_VERSION, generator: GENERATOR, captures, assets, diagnostics };
}
