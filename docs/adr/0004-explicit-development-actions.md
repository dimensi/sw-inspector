# ADR 0004: Explicit development actions alongside passive inspection

- Status: **Proposed — implementation has not started**
- Date: 2026-10-19
- Supersedes: the blanket write/network/message prohibitions in ADR 0001 **only when the corresponding feature is implemented and this decision is accepted**. Other bounded-diagnostics rules remain in force. ADR 0002 is unchanged.

## Context

The user requested plans for Cache Storage deletion, Service Worker management, Web App Manifest inspection, and sending/receiving SW messages. The shipped product is still read-only. Changing that promise without precise targets, document identity and transport outcome semantics would make existing stale-result suppression insufficient: suppressing a result cannot undo a write.

## Proposed decision

Keep passive inspection as the default. Add explicit prepare/confirm/commit actions for Cache Storage deletion, registration update/unregister, and message submission. Bind each action to the inspected document and a retained target; never automatically retry an uncertain mutation. A timeout after possible submission is outcome unknown. Cache deletion and unregister remain subject to browser API concurrency; they are not transactions.

Allow a separate explicit, bounded page-context fetch of the DOM-declared web manifest. Allow opt-in, leased message listeners with bounded buffers. These exceptions do not permit arbitrary network probes, offline emulation, broad host permissions, arbitrary code evaluation, telemetry, or background capture.

Retain the devtools-page relay, activeTab permission boundary, synchronous JSON jobs, existing visual system, and metadata-only default exports. Do not introduce direct-panel eval or a content-script fallback without new reproducible evidence.

## Activation and consequences

The implementation contract and limits live in the [development design](../plans/2026-10-19-development-design.md); small tasks and dependencies are indexed in the [roadmap](../plans/README.md). Before exposing the first new action, accept this ADR and update PRODUCT, AGENTS, UI/manifest/package descriptions and release copy to describe actual capabilities. Do not describe planned capabilities as shipped.

Feature-specific acceptance requires a disposable fixture and native Safari evidence. Reconcile accepted decisions back into ADR 0001 with an explicit superseded-part link. The project retains the distinction between an application message submission and delivery, update completion and activation, registration and control, cache presence and offline behavior.
