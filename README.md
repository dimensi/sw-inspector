# SW Inspector

Service Worker and Cache Storage diagnostics with confirmed worker update/unregister, confirmed namespace deletion and direct selected entry deletion inside Safari Web Inspector. The panel shows registrations and the current controller, cache request keys, response metadata, optional text previews and body measurements, origin storage estimates, cache-key checks, declared Web App Manifest data, and a local JSON report.

## Support

For help, bug reports, or feature requests, [open a GitHub issue](https://github.com/dimensi/sw-inspector/issues/new) or [browse existing issues](https://github.com/dimensi/sw-inspector/issues).

For bug reports, include your macOS, Safari, and SW Inspector versions, what you expected, what happened, and steps to reproduce. Remove personal data, credentials, and private URLs from screenshots or diagnostic reports before posting; GitHub issues are public.

If inspection reports that the extension cannot access the current tab, click **SW Inspector** in Safari's toolbar on that tab, then click **Refresh** in the Inspector panel. Refresh again after navigating to another page.

## Privacy

Inspection data is processed locally on your Mac. SW Inspector does not upload it or include telemetry. See the [Privacy Policy](PRIVACY.md) for details about local processing, exported reports, and your controls.

## Build and run

Requirements: Node.js 20.19+ on the 20.x line, or 22.12+, and pnpm (the installed Vite engine constraint).

```sh
pnpm install
pnpm test
pnpm check
pnpm build:safari
pnpm check:manifest
```

The Safari MV3 build is in `.output/safari-mv3/`.

1. Enable developer features in **Safari Settings → Advanced**.
2. Choose **Settings → Developer → Add Temporary Extension…** and select `.output/safari-mv3/`.
3. Enable **SW Inspector** in **Settings → Extensions**.
4. Open an HTTPS page and its Web Inspector, then select **SW Inspector**.
5. Click the **SW Inspector toolbar button in Safari** on that page to grant temporary site access, then click **Refresh** in the panel. In the verified Safari 27.0 run, opening the panel alone did not grant access and the toolbar grant needed no separate popup.

After rebuilding, use the extension's **Reload** control in Safari Settings and close/reopen Web Inspector. Temporary extensions may be removed when Safari quits or their installation period expires.

The Xcode wrapper under `apple/` has a separate copy of extension resources. Run `pnpm sync:safari` before building that wrapper; it builds and replaces its generated `Resources/` bundle. Use `pnpm sync:logo` to regenerate identity assets from `logo.png` and transparent toolbar PNGs from `public/icons/toolbar.svg` (requires macOS `sips` and ImageMagick `magick`). Safari uses the toolbar SVG directly; the Chrome build uses the PNG set. Never hand-edit generated resources or compare packaging routes with different bundles.

## What the results mean

- A registration and an active page controller are different facts.
- Cache-key presence does not prove offline navigation works.
- Measured response-body bytes are not disk allocation. Storage usage/quota estimates cover the whole origin.
- Preview and body measurement are explicit actions. Exports exclude response bodies and previews; review URLs before sharing.
- With Safari 27.0 temporary `activeTab` access, navigation notifications were not delivered in the recorded run. Click **Refresh** after navigating.
- **Delete cache…** deletes only the selected Cache Storage namespace after confirmation. It does not clear HTTP cache, IndexedDB, cookies, or localStorage. The site may recreate the namespace; an unknown outcome requires Refresh, never an automatic retry. **Delete all caches…** confirms the complete fixed list (up to 100 names); **Delete listed caches** affects only those names, sequentially, and reports each outcome. More than 100 names requires deleting individually. **Delete entry** immediately removes the selected entry without a confirmation dialog, using a fresh document-bound prepare/commit and its retained Cache and Request with ordinary matching. Expired inventories require Refresh; a known result rereads only that cache and clears the response selection. No cache entry editing, arbitrary network probes, or telemetry are performed. The unavoidable `caches.keys()` / `caches.open()` race is documented in [ADR 0001](docs/adr/0001-read-only-diagnostics.md).

**Check for update** and **Unregister** confirm one selected registration using its retained browser reference. Update may download/install a new worker; completion does not guarantee activation. Unregister does not immediately stop control of existing pages and leaves Cache Storage unchanged. After known or unknown outcomes, the panel reads a fresh snapshot for the same document; a failed read keeps the action result and disables stale management handles until Refresh. Neither action retries automatically. No worker start/stop/restart/skipWaiting is exposed.

**Manifest** has three explicit steps: **Discover manifest** reads the first declared link from the current document without network access; **Load manifest** makes one CORS request with a 256 KiB/8-second limit; **Show source** displays the already loaded text without another request. The link controls credentials/referrer policy, so the request may use ordinary browser credentials. Fields and icon URLs are declarations or Inspector reconstructions; icons are never downloaded, and this is not Safari’s processed manifest or an installability check. Refresh/navigation clears local manifest results. Manifest source stays out of metadata exports.

## Project documents

| Document | Purpose |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | Scope, users, and product boundaries |
| [DESIGN.md](DESIGN.md) | Approved Safari-style visual system and extension rules |
| [AGENTS.md](AGENTS.md) | Instructions for future implementation work |
| [ADR 0001](docs/adr/0001-read-only-diagnostics.md) | Bounded diagnostics and data semantics |
| [ADR 0002](docs/adr/0002-devtools-page-bridge.md) | Safari eval routing, transport, and permissions |
| [ADR 0003](docs/adr/0003-inspector-design.md) | Safari Storage/Network design decision |
| [TESTING.md](docs/TESTING.md) | Verification procedure, recorded evidence, and open Safari checks |
| [LEARNINGS.md](docs/LEARNINGS.md) | Concrete failure modes and prevention rules |
| [Development plans](docs/plans/README.md) | Small implementation tasks for cache deletion, SW management, manifest inspection and messaging; not yet shipped |
| [App Store assets](marketing/app-store/README.md) | English screenshots, promotional mockups, and reproducible capture sources |

The [standalone eval reproduction](diagnostics/safari-eval-repro/README.md) remains available for browser regressions. A passing build or synthetic UI preview is not native Safari acceptance.

## Disposable controls fixture

Use a separate disposable origin, `http://localhost:4174`, for deletion checks. From the repository run `rtk proxy python3 fixtures/controls-demo/server.py`, then open that origin. **Seed fixture** explicitly creates only `sw-inspector-fixture-*` caches from local text; **Cleanup fixture** deletes only that prefix. Neither runs automatically. **Inspect fixture caches** reads current names and key counts independently of the panel. Nothing registers automatically. Cache fixture buttons do not register workers or fetch remote data. Native Safari acceptance is recorded in [TESTING.md](docs/TESTING.md).

For worker checks, open [the isolated worker test page](http://localhost:4174/sw-inspector-worker/). **Serve worker v1** selects bytes on the local server; **Register fixture worker** explicitly registers only `/sw-inspector-worker/sw.js` for `/sw-inspector-worker/`. Wait for activation, then reload this scoped page manually to obtain a controller. **Serve worker v2** changes the bytes at the same script URL without requesting an update; use the panel’s **Check for update** and Refresh to inspect installing/waiting separately from active/controller. No `skipWaiting`, `clients.claim`, automatic update, reload or fetch interception is used. **Inspect fixture worker** reads that scope and controller independently. **Remove fixture worker** unregisters only that exact scope with the known fixture script; it leaves all caches intact. A foreign script at that scope causes refusal instead of replacement/removal. The server binds only to loopback and accepts version changes only from the fixture origin. Native Safari acceptance remains pending.

For the pending native navigation race check, **Delay next fixture deletion result** explicitly arms a fixture-only, one-shot fault injection. It restores the original `CacheStorage.delete` method before awaiting the actual deletion, then holds one successful `sw-inspector-fixture-*` deletion result for 10 seconds. Other namespace calls are unchanged. **Restore normal deletion** disarms an unused helper; reloading also restores normal behavior. Seed/Cleanup remain ordinary operations unless the helper is explicitly armed. Before batch testing, use **Inspect fixture caches**: `otherCacheCount` must be `0` and `otherCaches` empty. Other namespaces are listed by name only, without opening them or reading their contents. Stop if any unrelated namespace exists; also confirm the panel’s complete deletion list contains only fixture names. This helper is not included in the extension bundle.


## Disposable manifest fixture

Run `rtk proxy python3 fixtures/manifest-demo/server.py` for two loopback-only origins, `http://127.0.0.1:4187` and `http://127.0.0.1:4188`. Start at [the valid case](http://127.0.0.1:4187/?case=valid), grant the inspected page access, then use Manifest → Discover manifest → Load manifest → Show source. Case links cover absent, valid, redirect, invalid JSON, wrong MIME, delayed body, oversized body, denied CORS and dummy credentials. The redirect changes the response directory, so reconstructed relative URLs must use the final response URL. Slow sends a body prefix then waits 9 seconds; large sends exactly 262145 bytes.

**Inspect fixture requests** reads counters; **Reset request counters** clears them explicitly. Counters classify `Sec-Fetch-Dest: manifest` as browser-declarative, `empty` as fetch-style and other/missing values as unknown. These are request hints, not Inspector identity; automatic browser manifest reads and redirect HTTP hops must not be mistaken for additional Inspector fetch calls. At most 200 request records are retained. No counters are read automatically.

For credentials, choose that case and click **Set fake credential cookie** before Load. Only the dummy `manifest-fixture=demo` cookie is set; reports show its presence and never echo other cookies. The two optional CSP cases contrast `connect-src` restrictions with `manifest-src`: normal Inspector fetch can fail when a declarative manifest is allowed, or succeed while the browser’s manifest processing is blocked. This is not an installability conclusion. The fixture uses no external URLs, image preview or installation request. Chrome fixture checks and pending native Safari acceptance remain separate in TESTING.
