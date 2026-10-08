# ADR-006: Execution and security model

**Status:** Accepted (2026-10-08)

## Context
We run arbitrary, potentially hostile pages in a browser that we control, from a local HTTP service that any website the user visits could try to reach.

## Problem
Define the security boundaries for V1 without building hosted-grade infrastructure.

## Options considered
- No guarding ("it's local").
- **Local-only service with an app-level guard plus a browser sandbox plus limits.**
- A hosted renderer with a network-egress sandbox.

## Decision
- Bind `127.0.0.1`. A Host-header allowlist (anti DNS rebinding), a same-origin `Origin` check, JSON-only API (forces a preflight).
- URL policy on navigation **and every subrequest and redirect** (`page.route`). Always block link-local/metadata, `0.0.0.0` and multicast. Allow loopback and private ranges in local mode behind `allowPrivateNetworks`.
- Chromium sandbox on, a fresh context per job, service workers, downloads and permissions off.
- Hard limits: [security.md](../security.md).
- Hosted mode is **out of scope** and documented as needing an egress firewall.

## Reasoning
- Local mode's real threat is CSRF or DNS rebinding from a malicious site driving our browser. The Host and Origin checks close that cheaply.
- App-level IP checks can't fully stop rebinding inside Chromium, which is why hosted mode needs network-layer controls rather than more app code.

## Consequences
- Every API route goes through the guard (it's tested).
- Limits produce fatal or error diagnostics rather than hangs.

## Rejected alternatives
- No guard: exploitable from any web page.
- Hosted now: needs container and egress infrastructure that V1 doesn't need.
