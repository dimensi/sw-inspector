# SW Inspector — App Store assets

English assets for the macOS product page, prepared on 2026-10-19. The approved Inspector design remains unchanged. Start with [the overview](overview.png).

## Upload set

Upload the five files in `screenshots/` in numbered order. Each is **2880 × 1800**, **16:10**, **8-bit RGB PNG without an alpha channel**. These are the App Store upload files; `raw/` contains composition inputs with different dimensions.

| File | Story |
| --- | --- |
| [01-service-workers.png](screenshots/01-service-workers.png) | Controller, active/waiting worker, registrations, whole-origin storage estimate |
| [02-cache-storage.png](screenshots/02-cache-storage.png) | Cache namespaces, cached requests, response headers |
| [03-response-preview.png](screenshots/03-response-preview.png) | Explicit JSON preview in dark appearance |
| [04-body-measurement.png](screenshots/04-body-measurement.png) | URL filtering and body-byte measurement; the measurement covers the entire cache, not just the filtered rows |
| [05-offline-resources.png](screenshots/05-offline-resources.png) | Present and missing same-origin cache keys; no offline-success claim |

## Promotional mockups

Two **3200 × 2000 RGB PNGs**, intended for a website, README, announcement, or press kit:

- [Workspace](mockups/01-workspace.png): overlapping light and dark Inspector windows.
- [Appearance](mockups/02-appearance.png): compact layouts in both themes.

Their title bars and window arrangement are presentation framing. They do not depict Apple hardware or additional application features. Use the five-file upload set for the App Store.

## Source and truthfulness

The UI in every image is the actual compiled `.output/safari-mv3/panel.html`, captured at 2× using **Playwright WebKit on macOS**. It is not an AI reconstruction of the interface and its CSS, labels, rows, and controls were not altered for the screenshots.

`source/demo-fixture.js` supplies deterministic in-memory browser API responses for `https://demo.example.test`. It contains 28 shell requests, four runtime JSON responses, three font payloads, and one registration with active and waiting workers. Response headers and byte measurements derive from the fixture bodies. The origin estimate includes an additional illustrative 32 KiB outside those bodies. All data is synthetic; no real website, personal information, or remote services were accessed. The footer labels demonstration data.

These files demonstrate the product UI. They are **not captures from the Safari application's Web Inspector**, and do not establish native Safari acceptance; [TESTING.md](../../docs/TESTING.md) remains the source for that evidence. The production extension does not include this fixture or the marketing files.

Compositions are rendered from the WebKit captures using Chromium. This exports opaque RGB PNGs directly; WebKit's raw screenshots include an alpha channel. No UI pixels are repainted or retouched. The existing app icon is reused from `public/icons/128.png`; its generation provenance is in [logo.json](../../.impeccable/assets/logo.json).

## Rebuild the assets

From the repository root, build the current panel and start the loopback-only capture server:

```sh
rtk pnpm build:safari
rtk proxy node marketing/app-store/source/server.mjs
```

In a second terminal, use Playwright CLI with WebKit and Chrome installed. The recorded run used `@playwright/cli` 0.1.22. Opening creates isolated sessions; it does not attach to a personal browser profile.

```sh
rtk proxy npx --yes --package @playwright/cli@0.1.22 playwright-cli -s=sw-store open 'http://127.0.0.1:4187/panel.html?session=store' --config=marketing/app-store/source/cli.config.json
rtk proxy npx --yes --package @playwright/cli@0.1.22 playwright-cli -s=sw-store run-code --filename=marketing/app-store/source/capture.js
rtk proxy npx --yes --package @playwright/cli@0.1.22 playwright-cli -s=sw-store-export open 'http://127.0.0.1:4187/composition.html?mode=store' --browser=chrome --config=marketing/app-store/source/cli.config.json
rtk proxy npx --yes --package @playwright/cli@0.1.22 playwright-cli -s=sw-store-export run-code --filename=marketing/app-store/source/compose.js
rtk proxy node marketing/app-store/source/validate.mjs
rtk proxy npx --yes --package @playwright/cli@0.1.22 playwright-cli -s=sw-store close
rtk proxy npx --yes --package @playwright/cli@0.1.22 playwright-cli -s=sw-store-export close
```

Stop the server with Ctrl-C when finished. `capture.js` must finish successfully before `compose.js` runs. Review every output at normal and reduced scale before packaging. `validate.mjs` checks dimensions, RGB/no-alpha format and PNG integrity, and writes file and build hashes to `manifest.json`.

## Art direction

Follow [DESIGN.md](../../DESIGN.md): neutral surfaces, system typography, blue selection, dense inspection data. Marketing headings use larger type outside the untouched UI. Store images give the panel about 70% of the canvas; each explains one concrete capability. Mockups may use restrained window shadows and rounded outer frames. Keep gradients, dramatic lighting, invented hardware, badges, ratings, and unsupported promises out of the kit. This presentation styling does not change the panel's design tokens.

## Apple references

Checked 2026-10-19:

- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications): Mac supports 1–10 JPG/JPEG/PNG screenshots at 1280×800, 1440×900, 2560×1600, or 2880×1800; no alpha/transparency.
- [Guideline 2.3.3](https://developer.apple.com/help/app-review/guideline-reference/2-3-3-screenshots/): show actual app functionality in the majority of images; overlays must not misrepresent or obscure it.
- [Marketing resources and identity guidelines](https://developer.apple.com/app-store/marketing/guidelines/): rules for Apple device imagery and screenshots.

The kit has not been uploaded to App Store Connect and no App Review acceptance is claimed.
