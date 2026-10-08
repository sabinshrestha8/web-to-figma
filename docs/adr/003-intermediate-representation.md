# ADR-003: Intermediate representation

**Status:** Accepted (2026-10-08)

## Context
Something has to sit between "DOM facts" and "Figma nodes". It must be typed, versioned, serializable, testable, and independent of both React and Figma.

## Problem
What shape does the IR take, how is it defined, and how does it evolve?

## Options considered
- Informal JSON.
- TypeScript types plus a hand-written validator.
- JSON Schema first, with codegen.
- **Zod schema as the single source**, with types inferred and JSON Schema generated.
- A Figma-shaped IR (raw `FrameNode` props).

## Decision
A Zod 4 schema in `packages/ir`:
- Versioned `major.minor` with a migration registry.
- Three node types: box, text, vector. **Images are paints on boxes.**
- Bounds in absolute page coordinates.
- A **verified, target-neutral layout**: `none | stack | grid`.
- CSS-specific facts stay out of the IR.

See [ir-schema.md](../ir-schema.md).

## Reasoning
- One definition gives TS types, runtime validation at trust boundaries, and a JSON Schema for docs and other languages.
- Few node types means less mapping code. Images as paints matches Figma, Penpot and Sketch alike.
- Absolute bounds make layout verification and preview trivial; consumers convert to relative coordinates.
- A neutral stack/grid layout keeps the IR consumable by non-Figma targets, and the CSS→layout ambiguity stays in one place (convert).

## Consequences
- Schema changes need care: a minor bump for additive fields, a major bump plus migration for breaking ones. `docs/ir.schema.json` is checked by a test.
- Recursion means `BoxNode`/`Node` carry explicit TS types (`z.ZodType<…>`), and the node union isn't a discriminated union, so error messages for an unknown node `type` are generic ("Invalid input").

## Rejected alternatives
- Informal JSON: drifts silently.
- JSON Schema first: worse TS ergonomics.
- Figma-shaped IR: couples the converter to one target and leaks Figma quirks into extraction.
