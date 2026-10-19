# Learnings

These are evidence-backed prevention rules from the 2026-10-19 implementation and Safari investigation. Decisions live in [ADRs](adr/); acceptance evidence lives in [TESTING.md](TESTING.md). Add a learning only when it names an observed failure and a concrete prevention rule.

## Browser diagnosis

| Failure or misleading assumption | Prevention |
| --- | --- |
| An Inspector crash was treated as missing site permission. | Classify the first failing stage. `DevToolsInspectedWindowEval fails validation` occurs before permission handling; a later ordinary access error is a different failure. See [ADR 0002](adr/0002-devtools-page-bridge.md). |
| An exposed `browser.devtools` method was taken as proof that native IPC was allowed. | Inspect the generated call and namespace, then compare invocation contexts. API presence and privileged process routing are different facts. |
| WXT/polyfill, Promise transport, panel path, and permissions were plausible but unproven explanations. | Vary one factor at a time. The framework-free `1 + 1` probe isolated panel versus devtools-page execution. Retain it as the regression baseline. |
| Repeating earlier changes obscured what each experiment established. | Removing auto-refresh localized the trigger; start/poll, relative panel paths, and `activeTab` did not fix panel IPC. Revisit a rejected hypothesis only with new evidence or another browser build. |
| Opening the Inspector panel was assumed to grant `activeTab`. | Test the actual Safari toolbar gesture on the inspected tab. No separate popup was observed in the successful run. |
| Extension API calls were proposed in the inspected page's console. | That console is not an extension context. Opening `devtools.html` as a normal tab is also not a DevTools entrypoint. |
| Different generated snapshots could masquerade as an installation difference. | Compare identical bundles and record the installation route. Sync Xcode resources first; the wrapper does not itself supply a JavaScript eval fix. |
| A build or Chrome result was mistaken for Safari acceptance. | Record exact Safari/macOS versions, origin, action, result, and pending cases. Separate synthetic UI evidence from native evidence. |
| A nearby WebKit revision looked like proof of the installed binary's exact branch. | Keep the source SHA and confidence label. Logs/repro prove the failing stage/context; process-preference and privileged-ID details remain source-supported explanations. |
| Successful eval was assumed to imply successful navigation events. | Test navigation separately. Temporary tab access and the tab-less navigation permission check can behave differently; keep manual Refresh visible. |

## UI and data correctness

- **A registration is not a controller.** A mixed `??`/ternary expression showed “Not controlled” beside a real controller URL. Use explicit branches or grouping, and check the visible label against representative data.
- **Input text is not a unique row key.** Duplicate offline paths broke keyed rendering. Request rows use `requestKey`; repeated inputs and header rows need identity that permits duplicates.
- **Selection and preview state are distinct.** Loading a preview used to clear the selected request. Keep row identity stable across metadata/preview requests and handle expired snapshots explicitly.
- **Errors belong to their operation.** A failed preview or measurement must not overwrite a valid origin inspection state. Check local error placement as well as happy-path data.
- **Read-only needs precise limits.** `keys()` followed by `open()` is not atomic; do not promise that external deletion can never lead to empty-cache recreation. Body bytes, origin estimates, opaque values, and offline-key checks have distinct semantics ([ADR 0001](adr/0001-read-only-diagnostics.md)).
- **Developer-tool design is durable.** The user selected Safari Storage/Network. Large cards and a dominant status banner competed with inspection work. New features inherit the density, pane boundaries, and selection rules in [DESIGN.md](../DESIGN.md).
- **Toolbar and application icons have different jobs.** Safari displayed the opaque application icon as a gray square around a tiny glyph when `action.default_icon` was absent. Provide a separate transparent monochrome toolbar asset and explicit action icons; keep the application identity separate, and verify the installed Safari rendering instead of inferring it from the source PNG.

## Keeping the record useful

Update conclusions after new evidence. Earlier notes still said successful diagnostics were unverified and the controller label was broken after both had been corrected. Use current action labels (**Refresh**), keep test results dated, and remove superseded plans after their durable decisions are captured. Do not turn this file into a transcript or hypothetical-risk list.
