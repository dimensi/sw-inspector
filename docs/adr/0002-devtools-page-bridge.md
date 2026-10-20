# ADR 0002: Evaluate through the DevTools entrypoint

- Status: Accepted
- Date: 2026-10-19

## Context

Safari 27.0 (21625.1.29.18.28), on macOS 26.6.2 (25G83), crashed Web Inspector when the temporary extension called native `browser.devtools.inspectedWindow.eval` from its panel. The log reported `WebExtensionContext_DevToolsInspectedWindowEval fails validation` before normal site-access handling.

The standalone, framework-free reproduction evaluates the same synchronous `1 + 1` in both contexts. The user reported that **devtools-page evaluation works and panel evaluation crashes**. The raw result tuple and permission-prompt outcome of that minimal run were not supplied. The failure therefore does not require WXT, Svelte, Cache Storage, or an asynchronous inspected expression.

## Decision

- Keep Safari MV3, WXT, and the existing `devtools_page`. Create the panel unconditionally, before access checks.
- Own the native eval call in `entrypoints/devtools/main.ts` through `installDevtoolsRelay`. The panel uses extension-internal runtime messaging; it never falls back to direct panel eval.
- Generate a random session token for each Inspector and pass it in the panel URL. Match the token, extension runtime ID, and expected extension-page URL. Do not use the panel's `inspectedWindow.tabId` as the routing key: its mapping can also be absent after the process split.
- Normalize native results and exceptions at the relay boundary. Missing, invalid, or timed-out relay responses become visible errors.
- Keep asynchronous diagnostics as synchronous JSON **start/poll** expressions with randomized job/snapshot registries. Awaiting the browser API return does not imply that Safari awaits a Promise returned by the inspected expression. Direct Promise evaluation remains unused and unverified in Safari; the Chrome probe returned a Promise object rather than its resolved JSON value.
- Current defaults are a 15-second transport deadline, 50 ms between polls, and 60-second page-job expiry. Completed jobs are removed when read. Cancellation stops waiting/UI publication rather than guaranteeing interruption of page-side work.
- Keep `devtools` and `activeTab` permissions, with no host patterns, content scripts, or background worker. Grant temporary access by the extension's Safari toolbar action on the inspected tab; opening the Inspector panel alone is insufficient in the verified run.
- Read one overview snapshot on panel mount. Own actual panel visibility in the devtools entrypoint through `ExtensionPanel.onShown`/`onHidden`: the first show belongs to mount, repeated show events are ignored, and each hidden-to-shown return notifies the panel through the existing authenticated Inspector session. Sidebar view changes do not trigger this lifecycle. Remove subscriptions on disposal, including when panel creation completes after the devtools page closes. Each refresh invalidates older pending results; body reads remain explicit.
- Relay native navigation notifications through the same Inspector session. Preserve transport generation/origin checks, but expose manual **Refresh after navigation** because native events were not delivered under the verified temporary grant.
- Leave the content-script fallback unused. Consider it only after a minimal experiment establishes that the existing DevTools boundary cannot serve the required operation.

## Evidence and confidence

The [sanitized log](../evidence/2026-10-19-safari-eval-ipc.txt) confirms IPC validation failure and separate Inspector/devtools-page processes. Both pages logged Site Isolation off and storage blocking policy `0`; neither explains this recorded split.

The local WebKit source examined was commit `2196077a54c42c97792ab2e69a97e3661827acf6` (2026-08-12). It is a source snapshot, **not a verified mapping to the installed Safari binary**. Its relevant chain is:

1. `Source/WebKit/UIProcess/Extensions/WebExtensionContext.messages.in:95–97` assigns `isDevToolsMessageAllowed` to eval. `Source/WebKit/Scripts/webkit/messages.py:1009–1016` emits the validation error and returns before API dispatch.
2. `WebExtensionContextCocoa.mm:3079–3082` and `WebExtensionContext.cpp:1667–1672` require a loaded extension and privileged IPC destination. Website access is checked later in `API/WebExtensionContextAPIDevToolsInspectedWindow.mm:43–72`.
3. `WebExtensionController.cpp:93–102` sends the privileged identifier to an extension-specific page configuration. `WebExtensionContextCocoa.mm:2510` supplies that configuration for `devtools_page`; `WKInspectorViewController.mm:139–176` configures Inspector separately.
4. `WebExtensionContextProxy.h:76` selects the process-local privileged identifier when available, otherwise the unprivileged one. The panel is a subframe of Inspector, so an exposed native API does not prove privileged routing.
5. `WebProcessPool.cpp:1371`, `WebPageProxy.cpp:1410–1414`, and `SharedPreferencesForWebProcess.cpp.erb:65–79` explain how incompatible shared preferences can prevent related-page process reuse. The devtools page logged fullscreen/push enabled; Inspector's complete non-default preference record omitted them. Their local macOS defaults are false.

This strongly supports a shared-preference/process-routing explanation. The installed binary's exact failed comparison and numeric IPC destination were **not instrumented**. No fixed Safari version has been established. Do not turn this explanation into a claim about every Safari release.

The generated WXT 0.20.27 output preserved the one-argument native call. Runtime diagnostics selected native `browser`; installed `@wxt-dev/browser` 0.2.9 was a namespace selector, not a Promise polyfill. The standalone reproduction independently excludes WXT as a necessary trigger.

After moving eval, the product stopped crashing and returned the ordinary “does not have access to this tab” error. Adding `activeTab` and clicking the toolbar button resolved this separate permission stage. The actual Safari run then returned an overview, cache keys, synchronous JSON, and a completed deferred start/poll probe. Exact results and remaining acceptance cases belong in [TESTING.md](../TESTING.md).

## Consequences

The relay adds an explicit, authenticated extension-page hop without changing the page-side diagnostic architecture. A broken relay must fail visibly rather than retry the known crashing context.

Temporary site access can permit eval while suppressing navigation events. In the local source, `inspectedPageDidNavigate` checks `hasPermission(url)` without a tab (`WebExtensionContextCocoa.mm:3302–3307`), whereas temporary activeTab permission is recognized with a tab (`WebExtensionContext.cpp:880–883`). A persistent-origin grant has not been tested to confirm that explanation in the installed binary. Automatic navigation invalidation remains incomplete for the observed temporary-grant workflow. Initial and panel-return snapshots do not establish delivery of navigation events or grant site access; their native Safari lifecycle acceptance remains pending.

Use `.output/safari-mv3` for the temporary-install workflow. At the start of the investigation, the `apple/` resource snapshot differed from that build and was not an equivalent packaging comparison. The wrapper has a separate generated resource copy: run `pnpm sync:safari` before using it. Any packaging comparison must use identical reproduction files.

## Revisit when

A new Safari build is tested with the same [minimal reproduction](../../diagnostics/safari-eval-repro/README.md), a confirmed browser fix changes the IPC behavior, or native navigation under temporary access is demonstrated to work. Replacing the relay or widening permissions requires runtime evidence, not a successful build or API presence.

## References

- [`devtools-relay.ts`](../../src/bridge/devtools-relay.ts), [`expressions.ts`](../../src/bridge/expressions.ts), and [`transport.ts`](../../src/bridge/transport.ts).
- [Apple Inspector extension guide](https://developer.apple.com/documentation/safariservices/adding-a-web-development-tool-to-safari-web-inspector) and [WWDC22 demonstration](https://developer.apple.com/videos/play/wwdc2022/10100/).
- Historical source context: [WebKit shared-preference fix fca31e67](https://github.com/WebKit/WebKit/commit/fca31e67e9f6ee2753de81cdde7b8585a70e05a1) and [Inspector page-identifier change 366e62ce](https://github.com/WebKit/WebKit/commit/366e62cee33201aa57470a99cb9ecabbc0d5b7d8). Neither establishes a fix for this Safari build; the logged storage policy and Site Isolation cases differ.
- [Learnings](../LEARNINGS.md): failure-stage diagnosis and evidence rules.
