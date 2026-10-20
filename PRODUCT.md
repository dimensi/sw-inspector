# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers inspecting a web origin in Safari Web Inspector on macOS. They need to understand Service Worker control, lifecycle state, and Cache Storage without changing the website or its worker.

## Product Purpose

SW Inspector is a read-only diagnostic panel. It answers what is registered, what controls this page, what is cached, and what can be established from the browser's exposed data.

## Operating Context

The panel lives beside Safari's Storage and Network tools and must remain useful in a narrow dock. The inspected origin is its context; **Refresh** explicitly reads a new snapshot. Chrome is useful for development, but does not substitute for Safari runtime verification.

## Capabilities and Constraints

- Service Worker registrations, installing/waiting/active states, and current controller.
- Cache namespaces and bounded request inventories; response metadata on selection.
- Explicit text/JSON preview of the first 48 KiB, optional full text loading, and response-body measurement.
- Whole-origin storage usage/quota estimates and same-origin cache-key checks.
- Local metadata-only JSON export; no server, telemetry, or automatic body collection.
- No worker lifecycle controls, cache editing, network interception, offline toggles, or claim that cache presence proves offline operation.
- The execution route and permission boundary are recorded in [ADR 0002](docs/adr/0002-devtools-page-bridge.md). Safari 27.0 navigation under temporary access remains a known limitation.

## Evidence on Hand

Future capabilities are scoped in the [development plans](docs/plans/README.md). Cache deletion, worker management, manifest loading and messaging are planned, not part of the current read-only release.

- [Native Safari results and pending acceptance](docs/TESTING.md), versioned separately from automated checks.
- [Approved visual baseline](.impeccable/review/cache.png), using synthetic data, with tokens and rules in [DESIGN.md](DESIGN.md).
- [Minimal browser reproduction](diagnostics/safari-eval-repro/README.md), independent of the product framework.

## Product Principles

- Show runtime facts before secondary diagnostics.
- Preserve the distinction between absent, unknown, partial, failed, and zero.
- Keep body reads explicit and local failures beside the operation that failed.
- Fit the host Inspector's density and conventions; extend the approved design rather than inventing a new visual style per feature.
- Claim only the behavior supported by the recorded evidence.
