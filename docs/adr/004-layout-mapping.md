# ADR-004: Layout mapping (verify, then fall back)

**Status:** Accepted (2026-10-08)

## Context
CSS layout (flex, grid, block flow, margins, collapsing) and Figma Auto Layout aren't equivalent. A naive property mapping produces designs that look right in a few places and shifted everywhere else.

## Problem
How do we produce editable Auto Layout without ever making the result look worse than the source?

## Options considered
1. Map CSS properties directly to Auto Layout.
2. Always position absolutely.
3. **Derive candidate Auto Layouts, verify them by simulation against the measured child rects, and fall back to absolute.**
4. Heuristic or ML grouping.

## Decision
Option 3:
- Candidate A comes from CSS intent. Candidate B comes from measured geometry.
- Each candidate is checked by a pure Figma-Auto-Layout simulator with **1 px tolerance**.
- If neither passes → `layout: none` with absolute children and `LAYOUT_ABSOLUTE_FALLBACK` (info).

Full rules: [mapping.md §3](../mapping.md).

## Reasoning
- Reliability comes before editability: the output is never visually worse than option 2.
- Deterministic and table-testable.
- Fidelity improves incrementally by adding candidate generators without touching the verification.

## Consequences
- The simulator has to model Figma's Auto Layout faithfully: padding, gap, alignment, fill, hug, wrap. It's the most heavily tested module.
- Pages that rely on margins or exotic justification come out partly absolute (less editable) until better candidates exist.

## Rejected alternatives
- (1) Silently wrong.
- (2) Not editable enough.
- (4) Non-deterministic, and AI at runtime is a non-goal.
