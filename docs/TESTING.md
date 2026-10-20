# Verification and Safari acceptance

This file owns verification procedures and recorded outcomes. A build proves that assets were generated; it does not prove Safari IPC, site access, or async result semantics.

## Automated checks

Run from the project root:

```sh
pnpm test
pnpm check
pnpm build:safari
pnpm check:manifest
```

Inspect `.output/safari-mv3/manifest.json`: MV3, `devtools_page: devtools.html`, `devtools` and `activeTab`, no host patterns/background/content scripts. The current manifest script checks the entrypoint, panel file, and `devtools` permission; it does not enforce every item in that list. Use `pnpm sync:safari` before testing the Xcode wrapper.

The suite covers relay/session routing, expression escaping, timeouts/stale results, request identity, bounded previews, measurements, formatting, local errors, metadata export, and icon packaging. Report the count from the run performed, not a copied historical total.

## A1 document identity and routing — 2026-10-20

00/A1 is code-complete and passed independent code and design reviews. It adds document identity and exhaustive command routing inside the existing relay; A2 is now code-complete (see below); A3–A4 and action handlers/UI remain unimplemented. The read-only scope and Proposed status of ADR 0004 are unchanged. No UI source, copy, or tokens changed, so a visual sweep was not applicable.

Red/green evidence: before implementation, the new unknown-command assertion failed because the runner fell through to `checkUrls`, and the new context suite failed because its module did not exist. Tests now cover same-document identity reuse, fresh-realm and Inspector-key isolation, URL/hash invalidation, one-time pagehide disposal, new BFCache identity, context injection into overview/start-poll, explicit rejection without an injected context, and omission of page identity from the metadata report. Review found two additional lifecycle cases; each received a failing regression before its fix: a reused snapshot Map survived the second BFCache/pagehide cycle, and a pending inventory could retain Requests after pagehide. Both now pass, including rejection of the previous snapshot through the restored context.

Independent verification: targeted `pnpm exec vitest run tests/bridge/page-context.test.ts tests/bridge/expressions.test.ts tests/diagnostics/page-runner.test.ts` passed (3 files, 21 tests); full `pnpm test` passed (15 files, 68 tests); `pnpm check` reported 0 errors/0 warnings; `pnpm build:safari`, `pnpm check:manifest`, and `pnpm sync:safari` passed. Manual generated-manifest inspection confirmed MV3, `devtools_page: devtools.html`, only `devtools`/`activeTab`, and no host permissions, background, or content scripts. `diff -qr .output/safari-mv3 'apple/SW Inspector/SW Inspector Extension/Resources'` returned exit 0: wrapper resources match the Safari output. The signed Debug wrapper then built successfully with `xcodebuild -project 'apple/SW Inspector/SW Inspector.xcodeproj' -scheme 'SW Inspector' -configuration Debug -derivedDataPath /tmp/sw-inspector-a1-signed build`, using existing signing without configuration, account, or certificate edits. The resulting `/tmp/sw-inspector-a1-signed/Build/Products/Debug/SW Inspector.app` passed `codesign --verify --deep --strict` (exit 0); comparison of the Safari output with its embedded extension Resources returned exit 0. Opening the local app returned exit 0. App launch does not establish that Safari reloaded the extension or discarded its cached bundle.

Pending native Safari acceptance: record Safari/macOS versions, installation route, bundle identity, disposable origin, permission gesture, and actual results for Refresh/context/relay; same-origin reload at the same URL without a navigation event; SPA path/hash changes; BFCache restore through repeated pagehide/pageshow cycles; and concurrent Inspectors. A browser fixture run and native Safari run were not performed for A1. Safari extension reload and cache acceptance remain pending despite the successful local signed build and app launch. Source-factory fresh-realm tests do not establish generated-bundle fresh-realm acceptance from A3. **Refresh after navigation remains necessary** for the recorded temporary-access case.

User smoke evidence after the A1 checks: after restarting Safari with one enabled 0.1.1 extension copy, the user reported “ну вроде рефрешит” (“seems to refresh”). This is limited confirmation of Refresh only. Safari/macOS versions, origin, and extension reload route were not confirmed for that smoke check; preview behavior and the complete navigation/lifecycle matrix remain pending.

## A2 prepare/commit and bounded ledger — 2026-10-20

00/A2 is code-complete and passed independent code and design reviews. It adds action contracts and a self-contained control runner with shared document-scoped state, prepare/commit tickets, single-execution locking, and a bounded result ledger. No production handlers, control-expression routing, UI, permissions, or shipped read-only scope changed. ADR 0004 remains Proposed. No UI source or tokens changed, so screenshot and visual sweeps were not applicable.

Red/green evidence: the initial action suite failed before implementation because the runner module did not exist. Independent review then identified a concrete stale-confirmation bug: a newer unsupported prepare left the previous ticket executable. A new regression failed with an unexpected successful commit before the fix. Every newer prepare now invalidates prior prepared tickets and pending prepare revisions, including when intent validation or handler selection rejects the new request; a running commit retains its lock.

The 14 action tests cover prepare without effects, single execute and stable duplicate result, pending duplicates and shared locks across runner instances, supported-intent validation, frozen intent/page and copied ticket data, competing prepare completion, document changes, disposal with late prepare/execute completion, typed rejection allowlisting, unexpected execution exceptions, partial receipts preserving per-target outcomes, the handler current-page callback after an await, and bounded completed records. A deferred execution survives 300,001 ms and ledger cleanup while both duplicate commit and prepare remain busy, then settles once. Fake-clock disposal leaves no timers; the runner itself schedules none.

Independent verification: targeted action/page-context/expression/transport/devtools-relay tests passed (5 files, 51 tests); full `pnpm test` passed (16 files, 82 tests); `pnpm check` reported 0 errors/0 warnings; `pnpm build:safari`, `pnpm check:manifest`, and `pnpm sync:safari` passed. Manual generated-manifest inspection confirmed MV3, `devtools_page: devtools.html`, only `devtools`/`activeTab`, and no host permissions, background, or content scripts. Exact comparison of `.output/safari-mv3` with the Xcode extension Resources returned exit 0.

Additional independent source-factory fresh-realm checks passed: a prepared ticket is accepted at 29,999 ms and expired at 30,000 ms; a completed receipt is reused at 299,999 ms and expired at 300,000 ms; duplicate consumption of an unknown execution result calls execute only once. These checks validate the source factory without imported runtime closures. They do not establish compiled-bundle serialization or real start/poll control integration: both belong to A3 and remain pending. Native Safari actions, control transport, and feature/UI acceptance were not run; no new app build, installation, or extension registration was used for A2. A1 native lifecycle acceptance remains pending with the limited user Refresh smoke evidence above.

## UI fixture and visual baseline

### Sequential response previews — 2026-10-20

Added a regression test that reads metadata and previews for the first entry, the second entry, and the first entry again using one inventory. Before the fix it failed with `Cache inventory expired; refresh the cache list`; retaining the snapshot after preview makes it pass. The existing five-minute expiry test still passes. Full suite: 56 tests passed; `check` reported 0 errors/0 warnings; `sync:safari` (including `build:safari`) and `check:manifest` passed. Inspected the generated manifest: MV3, `devtools_page`, only `devtools`/`activeTab`, no host permissions, background, or content scripts. Xcode resources were synchronized. After rebuilding and launching the Xcode application, the user confirmed in Safari that the reported cache browsing issue was resolved. Safari/macOS versions and origin were not re-recorded for this check; this confirmation does not close other native acceptance cases.

Build Safari, then run `python3 .impeccable/preview/server.py` and open `http://127.0.0.1:4186/preview.html?session=preview`. Stop the server after use. The fixture provides synthetic in-memory browser data and exercises the built panel; it is not included in the extension bundle and does not inspect a real website.

Inspect both themes, wide and narrow dock widths, long values, empty/error/partial states, keyboard selection, local filtering, explicit preview, measurement, and duplicate offline inputs. Verify no automatic eval on initial mount and no document-wide horizontal overflow. Preserve [DESIGN.md](../DESIGN.md).

Recorded on 2026-10-19: wide light and compact dark layouts, manual refresh/cache inventory, filter, arrow-key selection, preview retaining selection, measurement, duplicate/missing offline paths, permission error, and zero initial eval calls passed in the synthetic fixture. These checks do not replace the native matrix below.

- [Worker properties, 1440×900 light](../.impeccable/review/desktop.png)
- [Cache and response, 1440×900 light](../.impeccable/review/cache.png)
- [Compact dock, 390×844 dark](../.impeccable/review/mobile.png)
- [Dated verification record](../.impeccable/review/result.json)

## Oversized preview cancellation — 2026-10-20

The user reported a JavaScript response preview remaining in Loading before `Inspected-page operation timed out`. A regression stream exceeding 48 KiB with non-settling cancellation reproduced a test timeout before the fix. Reading the fresh Cache.match response without cloning and cancelling without awaiting cleanup returns `too-large`. The test fixture now returns fresh response clones per match, as Cache Storage does. All 57 tests, `check` (0 errors/0 warnings), `sync:safari`, and `check:manifest` passed. Generated manifest inspection confirmed MV3, devtools_page, only devtools/activeTab permissions, and no background/content scripts or host permissions. Verification of the reported resource in native Safari remains pending.

## Partial and full text preview — 2026-10-20

Initial previews now return the first 48 KiB with `truncated: true`, avoiding a replacement character when UTF-8 ends mid-character. The separate `fullPreview` action reads the full response, retaining the transport deadline. The partial preview remains visible during loading and local errors. Regression tests cover non-settling cancellation, truncation, UTF-8 boundaries, full loading, and repeated previews. All 58 tests, `check` (0 errors/0 warnings), `sync:safari`, and `check:manifest` passed. The official Svelte autofixer found no issues; the Impeccable detector returned no findings.

Synthetic Chrome UI check: partial notice/button rendered, full-load click replaced the text and removed the notice, the button accepted focus, and no document overflow occurred at the initial wide viewport or 390×844 dark viewport. The fixture reply was overridden to supply partial/full text; this verifies UI handling separately from the runner tests, not native Cache Storage. Signed Xcode Debug build succeeded and the rebuilt application was launched. The user then confirmed in Safari that partial preview and full loading work. Safari/macOS versions and origin were not re-recorded; this confirmation does not close unrelated native acceptance cases.

## Recorded native Safari run — 2026-10-19

| Environment | Value |
| --- | --- |
| Safari | 27.0 (21625.1.29.18.28) |
| macOS | 26.6.2 (25G83) |
| Extension | 0.1.0, temporary installation from `.output/safari-mv3` |
| Origin | `https://web-test2.oneme.ru` |
| Access | `devtools` + `activeTab`; Safari toolbar button on the inspected tab, after user approval; no separate popup observed |

The standalone user-run probe established that devtools-page eval worked while panel eval crashed; its raw tuple and prompt outcome were not supplied. The later corrected-product run was observed through computer use: Inspector stayed open, one registration and an activated `/service-worker.js` controller appeared, `app-cache-20122` loaded 44 request keys, and whole-origin estimated usage was approximately 8.8 MiB.

Exact product probe outcomes (timings were not recorded):

```json
{"probe":"sync","origin":"https://web-test2.oneme.ru"}
{"probe":"deferred-started"}
{"state":"complete","result":{"probe":"deferred","origin":"https://web-test2.oneme.ru"}}
```

The native run predates the redesigned UI. The controller-label bug was corrected in that redesign and checked with synthetic data; it is not an additional native acceptance claim.

## Native acceptance matrix

| Scenario | Recorded status / remaining check |
| --- | --- |
| Minimal panel versus devtools-page eval | User reproduced the context-dependent crash. [Repro](../diagnostics/safari-eval-repro/README.md), [ADR 0002](adr/0002-devtools-page-bridge.md). |
| Product relay and explicit Refresh | Passed for overview, cache keys, synchronous JSON, and deferred start/poll on the recorded origin. |
| Temporary site access | Toolbar action enabled the product run. Opening the panel alone did not. |
| Controlled origin | Data returned as above; independent comparison of every worker lifecycle field remains pending. |
| No worker / empty caches | Pending native verification; must complete without waiting for `serviceWorker.ready`. |
| Body measurements | Pending native comparison against known sizes, including opaque and partial/error results. |
| Text preview / offline paths / export | Pending native verification; confirm bounded text, key presence only, no network probes, and no bodies/previews in export. |
| Navigation / cancellation | Incomplete: reload did not trigger automatic invalidation under temporary `activeTab`. Keep **Refresh after navigation**. Cross-origin navigation, concurrent Inspectors, and cancellation still need native checks. |
| Error and large-data states | Pending native matrix for denied access, missing APIs, null quota, expired snapshots, and large/partial caches. |
| Other Safari versions / Xcode packaging | Not established by this run; compare identical files before drawing conclusions. |

## Repeat a native check

### Toolbar asset check — 2026-10-19

In the installed Safari 27.0 session, reloaded the existing temporary extension from `.output/safari-mv3` through Settings → Extensions → SW Inspector → Reload. With `action.default_icon: "/icons/toolbar.svg"`, the toolbar visibly rendered the transparent inspector glyph without the former opaque square. This checks the native light appearance only; native dark appearance and other Safari versions remain unverified. No new site-access grant or inspected-page mutation was used for this visual check. The existing inspected origin was `https://web-test2.oneme.ru`.

Build manifest SHA-256: `d55f93b04e4896deea6e5f0ecc7bbc369329a22cdad990d1cc7440f5c294b0c7`. `pnpm sync:safari` rebuilt and synchronized the Xcode resources. The Chrome build keeps the separate PNG set. Automated checks after the SVG switch: 55 tests passed; svelte-check 0 errors/0 warnings; Safari and Chrome builds and `check:manifest` passed. This does not close unrelated native matrix rows above.

### Toolbar contour refinement — 2026-10-19

Replaced centered 1.25-unit strokes with filled one-unit contours aligned to the 16-unit grid; the SVG has a 32px intrinsic size. Ran `sync:logo`, `sync:safari`, the 5 icon/entrypoint tests, `check` (0 errors/0 warnings), and `check:manifest`. Rebuilt and ran the existing Xcode scheme; the SVG in the built app matched the source SHA-256 `2f6a180fcf71489f8b780e910426842e6c94b45478bf86571aacfb797cdb9e8e`.

Reloaded the already-enabled temporary SW Inspector through Safari Settings. The [native toolbar crop](../.impeccable/review/toolbar-pixel-aligned.png) shows the installed copy on the left, the reloaded temporary copy in the middle, and Safari's neighboring control on the right. The reloaded glyph has a thinner divider and straighter edges. A rebuilt app bundle alone does not establish that Safari discarded its cached icon. This checks the light toolbar only; dark appearance and the Inspector tab's updated glyph remain unverified. No toolbar access gesture or page inspection was required.

Follow [README installation](../README.md#build-and-run), reload the extension, and reopen Inspector after rebuilding. Grant access on the actual inspected tab. Use **Diagnostics → Run bridge probe** for synchronous/deferred results; the shipped probe deliberately skips Promise-valued inspected expressions.

Record date, exact Safari/macOS build, extension revision or bundle identity, installation route, origin, permission action, expected/actual result, and evidence for each row tested. Mark only those rows passed. Preserve raw errors; separate IPC validation, native access rejection, and evaluated-page failures. For regressions, use the framework-free repro before changing permissions or transport. The [curated IPC log](evidence/2026-10-19-safari-eval-ipc.txt) and [learnings](LEARNINGS.md) preserve the previous investigation.
