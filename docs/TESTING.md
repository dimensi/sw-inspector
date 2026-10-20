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

00/A1 is code-complete and passed independent code and design reviews. It adds document identity and exhaustive command routing inside the existing relay; A2–A3 are now code-complete (see below); A4 is now code-complete (see below); feature action handlers/UI remain unimplemented. The read-only scope and Proposed status of ADR 0004 are unchanged. No UI source, copy, or tokens changed, so a visual sweep was not applicable.

Red/green evidence: before implementation, the new unknown-command assertion failed because the runner fell through to `checkUrls`, and the new context suite failed because its module did not exist. Tests now cover same-document identity reuse, fresh-realm and Inspector-key isolation, URL/hash invalidation, one-time pagehide disposal, new BFCache identity, context injection into overview/start-poll, explicit rejection without an injected context, and omission of page identity from the metadata report. Review found two additional lifecycle cases; each received a failing regression before its fix: a reused snapshot Map survived the second BFCache/pagehide cycle, and a pending inventory could retain Requests after pagehide. Both now pass, including rejection of the previous snapshot through the restored context.

Independent verification: targeted `pnpm exec vitest run tests/bridge/page-context.test.ts tests/bridge/expressions.test.ts tests/diagnostics/page-runner.test.ts` passed (3 files, 21 tests); full `pnpm test` passed (15 files, 68 tests); `pnpm check` reported 0 errors/0 warnings; `pnpm build:safari`, `pnpm check:manifest`, and `pnpm sync:safari` passed. Manual generated-manifest inspection confirmed MV3, `devtools_page: devtools.html`, only `devtools`/`activeTab`, and no host permissions, background, or content scripts. `diff -qr .output/safari-mv3 'apple/SW Inspector/SW Inspector Extension/Resources'` returned exit 0: wrapper resources match the Safari output. The signed Debug wrapper then built successfully with `xcodebuild -project 'apple/SW Inspector/SW Inspector.xcodeproj' -scheme 'SW Inspector' -configuration Debug -derivedDataPath /tmp/sw-inspector-a1-signed build`, using existing signing without configuration, account, or certificate edits. The resulting `/tmp/sw-inspector-a1-signed/Build/Products/Debug/SW Inspector.app` passed `codesign --verify --deep --strict` (exit 0); comparison of the Safari output with its embedded extension Resources returned exit 0. Opening the local app returned exit 0. App launch does not establish that Safari reloaded the extension or discarded its cached bundle.

Pending native Safari acceptance: record Safari/macOS versions, installation route, bundle identity, disposable origin, permission gesture, and actual results for Refresh/context/relay; same-origin reload at the same URL without a navigation event; SPA path/hash changes; BFCache restore through repeated pagehide/pageshow cycles; and concurrent Inspectors. A browser fixture run and native Safari run were not performed for A1. Safari extension reload and cache acceptance remain pending despite the successful local signed build and app launch. Source-factory fresh-realm tests do not establish generated-bundle fresh-realm acceptance from A3. **Refresh after navigation remains necessary** for the recorded temporary-access case.

User smoke evidence after the A1 checks: after restarting Safari with one enabled 0.1.1 extension copy, the user reported “ну вроде рефрешит” (“seems to refresh”). This is limited confirmation of Refresh only. Safari/macOS versions, origin, and extension reload route were not confirmed for that smoke check; preview behavior and the complete navigation/lifecycle matrix remain pending.

Follow-up on the stale cache list: the user clarified that the cache list retained old values after their own cache deletion, worker unregistration, and page reload; on repeating the case, manual Refresh “вроде помог” (“seemed to help”). This is limited user evidence for explicit cache-list refresh, not native acceptance of A1 or automatic navigation invalidation. Safari/macOS versions, origin, and installed bundle SHA were not recorded. No production App, bridge, or UI change was made for this report.

The investigation found a separate synthetic-fixture regression: its mock page scope lacked `addEventListener`/`removeEventListener`, and its location lacked `href`. A faithful test executing the existing fixture and real source start/poll expressions returned a failed job before the fix and a completed overview afterward. [Two permanent regressions](../tests/bridge/fixture-diagnostic.test.ts) now cover that fixture and explicit source-transport refresh from populated to externally emptied caches/registrations, followed by a same-URL replacement realm without a navigation event. Independent review found no issues and independently passed both tests. These are synthetic/source checks, not native Safari results.

Independent synthetic browser smoke passed in an isolated Playwright session: Refresh showed three cache namespaces; clearing the fixture's backing API left the displayed snapshot unchanged until explicit Refresh, which showed zero caches, Not controlled, and removed the old `app-cache-20122` row. A denied Refresh showed the access error while retaining the empty snapshot. At 390×844 there was no document overflow; the only console error was a favicon 404. The session was closed and fixture server stopped. This checks the built panel with synthetic data, not native Safari or the complete theme/layout matrix.

Follow-up verification: independent QA passed `pnpm test` (17 files, 84 tests), `pnpm check` (0 errors/0 warnings), `pnpm build:safari`, `pnpm check:manifest`, and `pnpm sync:safari`. Manual generated-manifest inspection confirmed unchanged MV3, `devtools_page`, only `devtools`/`activeTab`, and no host permissions, background, or content scripts. Safari output and wrapper Resources were identical. No new native app build, registration, or installation was performed for this follow-up; the pending native matrix above remains open.

## A2 prepare/commit and bounded ledger — 2026-10-20

00/A2 is code-complete and passed independent code and design reviews. It adds action contracts and a self-contained control runner with shared document-scoped state, prepare/commit tickets, single-execution locking, and a bounded result ledger. No production handlers, control-expression routing, UI, permissions, or shipped read-only scope changed. ADR 0004 remains Proposed. No UI source or tokens changed, so screenshot and visual sweeps were not applicable.

Red/green evidence: the initial action suite failed before implementation because the runner module did not exist. Independent review then identified a concrete stale-confirmation bug: a newer unsupported prepare left the previous ticket executable. A new regression failed with an unexpected successful commit before the fix. Every newer prepare now invalidates prior prepared tickets and pending prepare revisions, including when intent validation or handler selection rejects the new request; a running commit retains its lock.

The 14 action tests cover prepare without effects, single execute and stable duplicate result, pending duplicates and shared locks across runner instances, supported-intent validation, frozen intent/page and copied ticket data, competing prepare completion, document changes, disposal with late prepare/execute completion, typed rejection allowlisting, unexpected execution exceptions, partial receipts preserving per-target outcomes, the handler current-page callback after an await, and bounded completed records. A deferred execution survives 300,001 ms and ledger cleanup while both duplicate commit and prepare remain busy, then settles once. Fake-clock disposal leaves no timers; the runner itself schedules none.

Independent verification: targeted action/page-context/expression/transport/devtools-relay tests passed (5 files, 51 tests); full `pnpm test` passed (16 files, 82 tests); `pnpm check` reported 0 errors/0 warnings; `pnpm build:safari`, `pnpm check:manifest`, and `pnpm sync:safari` passed. Manual generated-manifest inspection confirmed MV3, `devtools_page: devtools.html`, only `devtools`/`activeTab`, and no host permissions, background, or content scripts. Exact comparison of `.output/safari-mv3` with the Xcode extension Resources returned exit 0.

Additional independent source-factory fresh-realm checks passed: a prepared ticket is accepted at 29,999 ms and expired at 30,000 ms; a completed receipt is reused at 299,999 ms and expired at 300,000 ms; duplicate consumption of an unknown execution result calls execute only once. These checks validate the source factory without imported runtime closures. They do not establish compiled-bundle serialization or real start/poll control integration: both were subsequently verified by A3 below. Native Safari actions, control transport, and feature/UI acceptance were not run; no new app build, installation, or extension registration was used for A2. A1 native lifecycle acceptance remains pending with the limited user Refresh smoke evidence above.

## A3 control serialization and uncertain outcomes — 2026-10-20

00/A3 is code-complete and passed independent code/design review and QA. The generated start expression explicitly serializes the page context, diagnostic runner, and control runner, with an empty production handler map. The shipped panel remains read-only; no controller, confirmation UI, feature handler, permissions, or relay routing changed. ADR 0004 remains Proposed.

Red/green evidence: ten new transport cases failed before implementation, covering lost acknowledgements, exceptions, malformed acknowledgements/results, failed/missing polls, timeout, abort, and stale completion. The new expression regression executed against the baseline and failed because control prepare returned invalid-command instead of unsupported. After implementation, the targeted expression/transport command passed all 30 tests. A pre-aborted commit performs no eval; prepare timeout remains timeout; uncertain commits use exactly “The action may have completed. Refresh to inspect the current state.” No automatic retry or replacement ticket is issued. Validated pre-effect refusals remain typed errors; ticket/receipt/error schemas are checked before publication.

The transport checks current page identity after a valid control success. A fresh-realm transport regression replaces the inspected document at the same URL after the completed commit poll, without a navigation notification: the old receipt is suppressed as outcome-unknown, the fixture effect ran once, and no new ticket/commit was submitted. This is a final identity snapshot check, not an atomic guarantee against navigation after that check or a rollback mechanism.

Independent verification on the frozen source: `pnpm test` passed 119 tests in 17 files; `pnpm check` reported 0 errors/0 warnings; `pnpm build:safari` and `pnpm check:manifest` passed. Manual manifest inspection confirmed MV3, `devtools_page: devtools.html`, only devtools/activeTab permissions, and no host permissions, background, or content scripts.

Run `rtk proxy node scripts/verify-built-expressions.mjs` after `rtk proxy pnpm build:safari` to reproduce the generated-artifact proof. It uses the installed TypeScript parser to extract exact compiled emitter/factory/registry declarations from the actual Safari panel artifact, then executes emitted start/poll expressions in a fresh VM realm without source module closures. Independent QA passed this against `panel-CQxz610A.js` (SHA-256 `70edb125630be5e0dc3b9f60f42427f924cdf55e5f75424d0cf44c01a45a6dd1`): page context/overview, unknown command rejection, empty production handler map returning unsupported, hostile `</script>`/U+2028/U+2029 data, and test-only fixture prepare/commit with duplicate consumption executing once. Fixture handlers are inserted only at the test expression boundary, never through a production hook or wire command.

Independent browser smoke of the final built panel and committed synthetic fixture passed: one initial overview, one manual Refresh, one hidden-epoch return refresh, no duplicate from repeated focus/sidebar selection, cache inventory and selected metadata without body preview, read-only controls, and no document overflow at wide or 390px dark widths. The only initial console error was a favicon 404. The QA browser session and fixture server were closed.

Final packaging verification: `pnpm sync:safari` passed with the same compiled panel hash above; manifest checks and the compiled-artifact proof passed again. Exact comparisons of Safari output with repository wrapper Resources and the signed application's embedded extension Resources both returned exit 0. The existing Debug Xcode scheme built successfully at the same `/tmp/sw-inspector-a1-signed` location using unchanged signing configuration. `codesign --verify --deep --strict` passed outside the sandbox with access to the local trust store. Xcode performed its standard LaunchServices registration at that existing path; no new application location, account, or certificate changes were introduced. The app and Safari were not launched.

Native Safari control/relay acceptance was not performed for A3. A1 lifecycle acceptance and feature-specific action acceptance remain pending; no real mutation was tested and no new application location or extension registration was created. **Refresh after navigation remains necessary** for the recorded temporary-access case. No UI source or design tokens changed, so a full visual acceptance sweep was not applicable.

## A4 controller and confirmation — 2026-10-20

00/A4 adds one action controller and a mounted native confirmation dialog. `App.svelte` publishes fresh controller snapshots into `$state`; Refresh, navigation, disposal, and selection changes reset pending confirmation/results. Reset suppresses late UI publication and does not cancel an already submitted browser operation. The production handler map remains empty and no action trigger is exposed. The shipped panel remains read-only; ADR 0004 remains Proposed.

Red/green evidence: the initial missing-module run failed, then a no-op controller produced 8 failing assertions and 2 passing cases. The implemented controller passes 11 tests covering cancel without commit, copied ticket/page despite source or published-state mutation, one invoke for double confirmation, late prepare after reset, receipt retention after failed settled refresh, reset during running without unlocking a second action, ignored Cancel during running, changed-page rejection/suppression, no-page prepare, and unknown settlement with a null receipt. A changed-page late completion also clears its obsolete running state.

The settled reread first queries the actual `page-context`, including document ID, origin, and full URL. It rereads overview only for that same document, and checks the returned overview identity before publication. A selection/context generation rejects a settled context reply after a new selection. Inspection refresh errors remain separate from the action receipt or unknown-outcome message. No site reload or automatic commit retry is issued.

The test-only fixture imports the production App, controller, and dialog; aliases replace only browser/bridge/transport dependencies and capture the controller outside production sources. Run from the repository root:

```sh
rtk proxy node .impeccable/preview/a4/server.mjs
```

Open `http://127.0.0.1:5194`, then use **Prepare fixture action**. The fixture has no real effects. `window.a4finish()` completes the held commit; `a4unknown`, `a4refreshError`, `a4page`, `a4holdContext`/`a4releaseContext()`, and `a4receiptItems` select bounded test scenarios. `a4calls` records commands; `a4navigate()`/`a4return()` simulate callbacks. These hooks live only under `.impeccable/preview/a4`, outside extension entrypoints and the shipped bundle. Stop the server after use. Existing installed Vite/Svelte dependencies are reused; no dependency was added.

Independent browser acceptance passed light/dark at 1280px and 540px: Cancel receives initial focus, Escape cancels before commit, focus returns to the trigger, Tab/Shift+Tab stay in the busy dialog, busy Escape does not close or resubmit, full long URL/summary remain readable without document overflow, hostile URL text creates no HTML nodes, long receipts scroll locally, and Dismiss remains reachable. Mounted App checks passed selection/Refresh/navigation reset; a held settled context response after selection caused no reread; unknown outcome reread once for the same actual document and zero times for a different document; a known receipt remained visible alongside a refresh failure. Browser fixture evidence is synthetic, not native Safari mutation acceptance.

Implementation verification: full `rtk proxy pnpm test` passed 130 tests in 18 files; the controller suite passed all 11. Official Svelte MCP autofixer reported no issues after fixes; its remaining suggestions concern existing class directives and optional ref patterns. The Impeccable detector returned `[]`. Independent final-candidate QA passed all 130 tests, `pnpm check` with 0 errors/0 warnings, Safari build, `sync:safari`, and manifest checks. A fresh-realm generated-bundle proof passed against `panel-D_uY-_yM.js` (SHA-256 `3396d8864ebe1030427896c7365cfa44847d0c00efde4904f13539d466bbad47`); manifest SHA-256 was `eba5ad630d52ba2a0fce4a367b938466ddf017ad43c21c003eb9cc5a76f65074`. Manual manifest review confirmed MV3, `devtools_page`, only `devtools`/`activeTab`, and no host patterns, background, or content scripts. The compiled baseline fixture verified initial overview count 1, return count 2, duplicate return still 2, manual Refresh count 3, zero automatic body reads, and successful synchronous/deferred probes.

QA synchronized the wrapper resources and built the existing signed Debug scheme at `/tmp/sw-inspector-a1-signed` without launching it. `codesign --verify --deep --strict` passed; all 17 generated files matched the embedded extension resources byte for byte. This preparation does not prove that Safari reloaded the bundle. Fixture captures are retained at `/tmp/sw-inspector-a4-qa/dialog-{light,dark}-{1280,540,390}.png`, `/tmp/sw-inspector-a4-qa/long-result-dark-540.png`, and `/tmp/sw-inspector-a4-qa/compiled-baseline.png`. A separate mounted-App browser assertion supplied a partial receipt through the test-only fixture: the partial title and applied/failed/skipped targets rendered, the 103-item result scrolled locally (251px client height / 1863px scroll height), and the receipt persisted beside a failed refresh. Capture: `/tmp/sw-inspector-a4-qa/partial-result.png`. No feature-specific partial effect was executed.

Pending native acceptance:

- [ ] Record Safari/macOS versions, installation route, disposable origin, permission gesture, Refresh/context/relay result, and same-URL document change without effects.
- [ ] Retain the A1 same-origin reload/SPA/BFCache/concurrent-Inspector cases; A4 synthetic results do not close them.
- [ ] Test real mutation confirmation/outcomes only with the corresponding feature handler and feature plan. No mutation was exposed or executed by A4.

**Refresh after navigation remains necessary** for the recorded temporary-access case.

## UI fixture and visual baseline

### Sequential response previews — 2026-10-20

Added a regression test that reads metadata and previews for the first entry, the second entry, and the first entry again using one inventory. Before the fix it failed with `Cache inventory expired; refresh the cache list`; retaining the snapshot after preview makes it pass. The existing five-minute expiry test still passes. Full suite: 56 tests passed; `check` reported 0 errors/0 warnings; `sync:safari` (including `build:safari`) and `check:manifest` passed. Inspected the generated manifest: MV3, `devtools_page`, only `devtools`/`activeTab`, no host permissions, background, or content scripts. Xcode resources were synchronized. After rebuilding and launching the Xcode application, the user confirmed in Safari that the reported cache browsing issue was resolved. Safari/macOS versions and origin were not re-recorded for this check; this confirmation does not close other native acceptance cases.

Build Safari, then run `python3 .impeccable/preview/server.py` and open `http://127.0.0.1:4186/preview.html?session=preview`. Stop the server after use. The fixture provides synthetic in-memory browser data and exercises the built panel; it is not included in the extension bundle and does not inspect a real website.

Inspect both themes, wide and narrow dock widths, long values, empty/error/partial states, keyboard selection, local filtering, explicit preview, measurement, and duplicate offline inputs. Verify exactly one initial overview, no refresh on hide or sidebar view changes, one fresh overview on actual panel return, and a working manual retry after an inspection failure. Keep body reads explicit and verify no document-wide horizontal overflow. Preserve [DESIGN.md](../DESIGN.md).

Historical baseline before the approved automatic snapshot change, recorded on 2026-10-19: wide light and compact dark layouts, manual refresh/cache inventory, filter, arrow-key selection, preview retaining selection, measurement, duplicate/missing offline paths, permission error, and zero initial eval calls passed in the synthetic fixture. These checks do not replace the native matrix below.

- [Worker properties, 1440×900 light](../.impeccable/review/desktop.png)
- [Cache and response, 1440×900 light](../.impeccable/review/cache.png)
- [Compact dock, 390×844 dark](../.impeccable/review/mobile.png)
- [Dated verification record](../.impeccable/review/result.json)

## Automatic initial and panel-return snapshots — 2026-10-20

The panel now reads one overview on mount and after a real hidden-to-shown return to the SW Inspector DevTools tab. The devtools entrypoint owns native `onShown`/`onHidden` listeners; the first show and duplicate show events do not add snapshots. Returns use the existing authenticated session relay. Manual Refresh remains available, response-body reads remain explicit, and sidebar view changes do not trigger a snapshot. Every refresh invalidates earlier pending overview and secondary results and clears stale snapshot data; disposal removes subscriptions.

Red/green evidence: the new lifecycle regression failed before implementation because its relay helper did not exist, then passed. Lifecycle tests cover first/duplicate show, hide, return, session isolation, forged senders, listener cleanup, queued notification disposal, and panel creation resolving after devtools disposal. All 87 tests in 17 files, `check` (0 errors/0 warnings), `build:safari`, and `check:manifest` passed. Generated manifest inspection confirmed MV3, `devtools_page`, only `devtools`/`activeTab`, no host permissions, background, or content scripts. The official Svelte autofixer reported no issues; its unrelated suggestions concern existing class directives.

Independent built-panel browser QA confirmed exactly one initial overview and two subscriptions, no refresh from sidebar changes, and no automatic body preview when selecting response metadata. Arrow-key request navigation worked. Wrong-session and wrong-sender return messages caused no refresh; an authenticated return caused exactly one overview. A denied return cleared the old snapshot and displayed the inspection error, then manual Refresh recovered. A cache-list request held across a return to an empty overview was released afterward and did not restore stale requests or caches. Empty caches and no controller rendered correctly.

Light and dark fixtures at 1440px and 390px widths had no document overflow; wide light and narrow dark screenshots were visually inspected. The only console error was a favicon 404. Six screenshots are retained in `/tmp/sw-inspector-panel-refresh-qa`; the independent fixture server and browser session were stopped. These checks use synthetic data and authenticated message simulation, not native DevTools tab switching.

Independent verification also passed all 87 tests in 17 files, `check` (0 errors/0 warnings), Safari build, and manifest checks. `sync:safari` produced an exact generated-resource match. A signed Xcode build succeeded using the existing `/tmp/sw-inspector-a1-signed` build location; all embedded generated files matched the current Safari output. The build performed its standard LaunchServices registration at that same path; no new app location was created and the app was not manually launched.

Native first-open and actual tab-return feedback is recorded below. Denied-access/manual retry and lifecycle cleanup still need native acceptance. Automatic open/return reads do not close the recorded navigation-event limitation: keep **Refresh after navigation** when necessary under temporary access.

## Native panel return and final cleanup — 2026-10-20

The user reported that revision `92109e9` loaded data on first opening after a Safari restart, but never refreshed on repeated returns from Network. A minimal lifecycle regression reproduced a separate missed-initial-show sequence: attach listeners, receive hide, then show. That return had been ignored. Fixing it alone did not explain the reported repeated failure.

Temporary local counters in diagnostic build `panel-return-diagnostics-v1` established: host attached with 0 attachment failures, 0 shown callbacks, 6 hidden callbacks, and 0 notification send attempts/resolutions/rejections; the panel received 0 return notifications and recorded no authentication rejections. Document counters showed 2 visibility changes, 10 focus events, and 9 blur events; it was visible and focused at capture. Ordinary synchronous/deferred probes succeeded on `https://web-test.oneme.ru`. This localizes the observed failure to missing native `onShown` callbacks before notification dispatch, without establishing the installed WebKit binary's internal cause. Exact Safari/macOS versions, installed bundle hash, and installation route were not recaptured.

The replacement uses native hides as session-scoped epochs. Visible, focused document activation queries the authenticated devtools relay; only a newer epoch permits one overview. Native show notifications share its deduplication. Mount/remount baselining and late-reply activity checks preserve one initial read and reject refresh after blur, hiding, or disposal. A failed baseline can recover on a later active event without polling. The instrumented v2 build passed all 100 tests, type checking, Safari build/manifest checks, and independent built-browser tests for initial focus, hide-only returns, repeated-focus/native-show deduplication, and delayed replies. Its signed build used the existing `/tmp/sw-inspector-a1-signed` path with matching embedded resources.

The user then restarted Safari, opened SW Inspector, switched to Network for several seconds, and returned. They confirmed: “Да, обновляется сразу при возврате” (“Yes, it updates immediately on return”), before clicking inside the panel content. This is native confirmation of that interaction in the instrumented v2 build. It does not close unrelated navigation, cross-origin, concurrency, access-denied, or Safari-version acceptance cases.

Final cleanup removes only temporary counters, markers, the diagnostic read message, and lifecycle probe rows. The native hide epoch, authenticated activation query, deduplication, async guards, and normal explicit synchronous/deferred bridge probe remain. All 100 final tests in 17 files, `check` (0 errors/0 warnings), `build:safari`, and `check:manifest` passed; the official Svelte autofixer reported no issues. The stripped bundle has not been rerun natively; its final independent synthetic/build verification is separate from the instrumented native confirmation above. The committed synthetic fixture now answers the production activation query with a session/epoch reply before evaluating page expressions. Its test-only `previewControl.hiddenEpoch` models a native hide. A regression using the actual fixture and production relay failed before that fixture fix, then verified initial epoch 0, one return refresh per new epoch, duplicate suppression, and no page evaluation for activation messages.

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
| Automatic panel opening / return | User confirmed initial loading and, in the instrumented epoch-query build, immediate refresh on Network-to-SW Inspector return before a content click. Exact versions were not recaptured; final diagnostics removal has automated/synthetic evidence, not another native run. |
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
