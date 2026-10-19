# Safari native eval reproduction

Standalone MV3 extension with no build step or dependencies. Both buttons evaluate only `1 + 1` with the native one-argument API. One executes in the panel, the other sends a session-scoped message to the real `devtools_page`. No eval runs at load.

## Run

1. Disable other copies of the probe/product so the panel is unambiguous.
2. In **Safari Settings → Developer → Add Temporary Extension…**, select this directory and enable **Safari Native Eval Repro**.
3. Open an HTTPS page and its Web Inspector, then choose **Native Eval Repro**.
4. Record exact Safari/macOS versions, initial `ready` / `devtools-page-connected` records, and any site-access prompt or normal permission error.
5. Click **Evaluate from devtools page** once. Save raw results and matching process logs.
6. Close and reopen Inspector; on the same page and permission state, click **Evaluate from panel** once. This path reproduced an Inspector crash in Safari 27.0.

If the devtools-page button remains disabled, record the connection error; do not call it an eval failure. The message route does not depend on `onShown` delivering a cross-process window, and panel `tabId` is logged but not used for routing. An ordinary page console or a normally opened `devtools.html` tab is not the extension's DevTools context.

Expected after access: evaluated value `2`, no exception or crash. Preserve the raw API result rather than assuming its tuple shape. A process crash may erase the displayed `before-eval` record; retain initial records and the button used.

## Recorded result — 2026-10-19

Safari **27.0 (21625.1.29.18.28)**, temporary folder installation. The user reported **devtools-page evaluation works; panel evaluation crashes**. Raw result tuples and the prompt outcome were not supplied. A subsequent log read reproduced the original IPC validation signature. The same files packaged through Xcode were not tested.

This baseline declares only `devtools`; it deliberately excludes `activeTab`, host patterns, WXT, Svelte, background/content scripts, Promise-valued inspected expressions, and Service Worker/Cache Storage access. It is independently authored against Apple's documented API, not Apple's historical downloadable Open Graph sample; that complete sample was not obtained.

The JS syntax and isolated Node VM wiring were checked on 2026-10-19, including no initial eval, separate native objects, session routing, rejected calls, missing panel tab mapping, and absent `onShown`. Those checks do not prove native IPC or permission behavior.

For explanation and current product routing, see [ADR 0002](../../docs/adr/0002-devtools-page-bridge.md). For the separate corrected-product Safari run and pending acceptance, see [TESTING.md](../../docs/TESTING.md). Compare identical files across installation routes; never substitute an unsynchronized product resource bundle.
