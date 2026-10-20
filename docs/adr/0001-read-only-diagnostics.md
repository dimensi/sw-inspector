# ADR 0001: Read-only, bounded diagnostics

- Status: Accepted
- Date: 2026-10-19

## Context

SW Inspector diagnoses the inspected origin without changing its Service Worker lifecycle, cache contents, or network behavior. Cache Storage does not provide an atomic “open only if present” operation. Data can also change between inventory and inspection.

## Decision

- Read registrations with `getRegistrations()` and the current controller; never wait for `serviceWorker.ready` to display an empty state.
- Do not call `fetch`, cache write/delete/add APIs, Service Worker update/unregister/skipWaiting, or Service Worker messaging APIs. No telemetry or network backend.
- Before `caches.open(name)`, check that the name is present in `caches.keys()`. Report a missing cache rather than intentionally creating it.
- Inventory and response metadata are separate from body reads. Measure bodies and load previews only after explicit user actions.
- Identify a cached request by an ephemeral inventory snapshot and index, retaining its original `Request`. A URL alone is not a unique request identity.
- Bound inventories to 1,500 entries, snapshots to 12 with a five-minute lifetime, and streamed text previews to 48 KiB. Previews retain the inventory snapshot so other entries and repeated previews remain accessible until expiry or eviction. Show truncation and expired snapshots honestly.
- Render previews as text; never execute HTML or page-provided content. Do not persist bodies or previews, and exclude them from exported reports.
- Report readable **response-body bytes**, not disk allocation. Report storage estimates as approximate **whole-origin usage/quota**, not Cache Storage size. Preserve unknown, opaque, failed, and partial states instead of converting them to zero.
- Check at most 30 user-entered, same-origin HTTP(S) URLs through Cache Storage. A matching cached response does not prove offline navigation or Service Worker fetch handling.
- Export locally through an explicit user action, using an allowlisted metadata report. Warn that URLs and headers can contain sensitive values.

## Consequences

The read-only promise has one unavoidable platform qualification: if the page deletes a cache between the existence check and `caches.open`, that call can recreate an empty cache. Do not claim an absolute no-create guarantee.

Snapshots expire and live data can change. A stale snapshot produces a recoverable error requiring a fresh inventory; it must not silently select another request. Unknown response sizes remain unknown, and bounded scans may produce partial totals.

Cancellation stops waiting and publishing results in the panel. It does not guarantee that already-started page-side work has stopped.

## Revisit when

A browser API provides atomic read-only cache access, or measured runtime evidence requires a different bound. Changes that introduce writes, network requests, persistence, or broader inspection scope require an explicit product decision and a replacement ADR.

## Evidence

- [Product scope](../../PRODUCT.md) and [acceptance record](../TESTING.md).
- [`page-runner.ts`](../../src/diagnostics/page-runner.ts): existing-cache check, snapshot identity, streaming limit, measurements, and URL checks.
- [`report.ts`](../../src/export/report.ts): metadata-only export construction.
- [`transport.ts`](../../src/bridge/transport.ts): cancellation, timeout, and stale-result checks.
