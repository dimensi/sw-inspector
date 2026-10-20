# SW Inspector

Service Worker and Cache Storage diagnostics with explicit confirmed namespace deletion inside Safari Web Inspector. The panel shows registrations and the current controller, cache request keys, response metadata, optional text previews and body measurements, origin storage estimates, cache-key checks, and a local JSON report.

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
- **Delete cache…** deletes only the selected Cache Storage namespace after confirmation. It does not clear HTTP cache, IndexedDB, cookies, or localStorage. The site may recreate the namespace; an unknown outcome requires Refresh, never an automatic retry. **Delete all caches…** confirms the complete fixed list (up to 100 names); **Delete listed caches** affects only those names, sequentially, and reports each outcome. More than 100 names requires deleting individually. No worker lifecycle mutation, entry deletion, network probes, or telemetry are performed. The unavoidable `caches.keys()` / `caches.open()` race is documented in [ADR 0001](docs/adr/0001-read-only-diagnostics.md).

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

Use a separate disposable origin, `http://localhost:4174`, for deletion checks. From the repository run `rtk proxy python3 -m http.server 4174 --bind localhost --directory fixtures/controls-demo`, then open that origin. **Seed fixture** explicitly creates only `sw-inspector-fixture-*` caches from local text; **Cleanup fixture** deletes only that prefix. Neither runs automatically. **Inspect fixture caches** reads current names and key counts independently of the panel. No Service Worker is registered and no fetch is performed by the fixture. Native Safari acceptance is recorded in [TESTING.md](docs/TESTING.md).
