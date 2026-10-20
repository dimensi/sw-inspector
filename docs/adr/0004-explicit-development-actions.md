# ADR 0004: Explicit development actions alongside passive inspection

- Status: **Accepted for selected/fixed-list namespaces and selected Cache Storage entry deletion — 2026-10-21**
- Date: 2026-10-19
- Supersedes: the blanket cache-delete prohibition in ADR 0001 only for explicit confirmed selected namespace/fixed-list batch deletion or explicit direct retained-request entry deletion. No network, worker or messaging exception is activated. Other bounded-diagnostics rules remain in force. ADR 0002 is unchanged.

## Context

The user requested plans for Cache Storage deletion, Service Worker management, Web App Manifest inspection, and sending/receiving SW messages. The first enabled action is deletion of one selected cache namespace. Changing that promise without precise targets, document identity and transport outcome semantics would make existing stale-result suppression insufficient: suppressing a result cannot undo a write.

## Accepted scope

Keep passive inspection as the default. Enable explicit prepare/confirm/commit for one selected Cache Storage namespace. Prepare checks current presence and retains the name; commit invokes `caches.delete(name)` once. True means applied, false means absent, rejection means failed. Cache Storage offers no atomic generation comparison; the site may recreate the name. Known outcomes refresh overview; applied/absent invalidate only that name’s inventory/details/measurement. Unknown outcomes retain a warning and an explicit Refresh action. Bind each action to the inspected document and a retained target; never automatically retry an uncertain mutation. A timeout after possible submission is outcome unknown. Cache deletion remains subject to browser API concurrency; they are not transactions.

C2 also enables a complete `caches.keys()` snapshot of at most 100 names. Zero names cannot prepare a ticket; more than 100 rejects without truncation and instructs individual deletion. Confirmation lists the origin, exact count and every name. Commit deletes only the retained list, sequentially, checking current identity before each call; one rejection does not stop other current targets. Known per-name outcomes survive inside the handler, while navigation still suppresses publication through the existing runner/transport boundary and yields unknown. No automatic retry or claim that the origin stays empty is made. Applied/absent names alone invalidate their snapshots and UI data; overview refresh is independent from the receipt.

C3 enables one selected entry. On explicit user request (2026-10-21), **Delete entry** executes directly without a confirmation dialog; namespace and batch deletion retain confirmation. The entry-only controller path freshly prepares and commits the exact local ticket within the same generation, never by confirming shared controller state after an await. Reset/selection/navigation before dispatch suppresses the old operation. No Undo or automatic retry is provided. Inventory behavior: inventory snapshots retain the Cache handle and original Request with their existing five-minute TTL and twelve-snapshot eviction bound. Prepare requires an exact snapshot/index key with a canonical nonnegative integer index, matching cache and unexpired snapshot; no URL reconstruction or new cache open is allowed. Commit revalidates the retained snapshot and current document immediately before ordinary `Cache.delete(retainedRequest)` without ignore options. True means applied, false absent, rejection failed. Applied/absent invalidate every snapshot and selected details/measurement for that cache; reread only that cache and leave the response selection empty. Missing cache returns to Cache Storage. Preview does not extend snapshot lifetime. Unknown outcomes use the existing warning and never retry.

Registration actions, manifest fetch, message submission and listeners remain proposed and disabled. These exceptions do not permit arbitrary network probes, offline emulation, broad host permissions, arbitrary code evaluation, telemetry, or background capture.

Retain the devtools-page relay, activeTab permission boundary, synchronous JSON jobs, existing visual system, and metadata-only default exports. Do not introduce direct-panel eval or a content-script fallback without new reproducible evidence.

## Activation and consequences

The implementation contract and limits live in the [development design](../plans/2026-10-19-development-design.md); small tasks and dependencies are indexed in the [roadmap](../plans/README.md). C1, C2 and C3 activate this scoped decision together with PRODUCT, AGENTS, UI/manifest/package descriptions and release copy. Do not describe planned capabilities as shipped.

Feature-specific acceptance requires a disposable fixture and native Safari evidence. Reconcile accepted decisions back into ADR 0001 with an explicit superseded-part link. The project retains the distinction between an application message submission and delivery, update completion and activation, registration and control, cache presence and offline behavior.
