# Working on SW Inspector

@/Users/n.nafranets/.codex/RTK.md

## Read first

Read [PRODUCT.md](PRODUCT.md) for scope and [DESIGN.md](DESIGN.md) before changing UI. Read the relevant [ADRs](docs/adr/) and [LEARNINGS.md](docs/LEARNINGS.md) before touching the bridge, permissions, diagnostics, or state handling. [TESTING.md](docs/TESTING.md) owns verification evidence and outstanding Safari checks.

## Keep the approved interface

- Follow Safari Web Inspector's Storage/Network conventions: compact neutral toolbars, sidebar, dense tables, property rows, and an adjacent response inspector.
- Reuse the tokens and native controls in `entrypoints/panel/App.svelte` and the SVG vocabulary in `Icon.svelte`. Follow system light/dark appearance.
- Extend an existing pattern before introducing another. New visual-world changes need an explicit user request; routine additions should fit the current system.
- Keep diagnostics secondary. No dashboard cards, status hero, oversized numbers, gradients, ornamental animation, or decorative imagery in the panel.
- Preserve keyboard focus, table selection, local scrolling, long-value handling, empty/loading/error/partial states, and the narrow dock layout. Preview bodies only on explicit action.

## Architecture and data rules

- Native `inspectedWindow.eval` belongs to the existing `devtools_page`. The panel uses `src/bridge/eval-window.ts` and its session-scoped relay. Never add a direct-panel eval retry.
- Preserve sender identity, extension URL, session validation, timeouts, and stale-result checks. Panel `tabId` is not the routing key.
- Keep synchronous JSON start/poll for async page work. Awaiting the API call does not imply that Safari awaits an evaluated Promise.
- Declare `devtools` and `activeTab`; create the panel unconditionally. Background workers, content scripts, or host patterns require a demonstrated need and an updated ADR.
- Do not mutate worker lifecycle, write cache contents, issue network probes, or transmit diagnostics. The sole mutation exception is explicit confirmed deletion of one selected cache namespace or a fixed list of at most 100 namespace names under ADR 0004; no entry deletion. Temporary in-page job/snapshot state is allowed only for the bounded transport.
- Keep request identity as snapshot/index plus the retained Request, not URL alone. Render preview as text, never HTML. Export only explicit metadata fields.
- Never present unknown bytes as zero, origin usage as cache size, cache presence as offline success, or registration as control. Do not await `serviceWorker.ready`.
- Keep inspection failures separate from cache/details/measurement/offline failures. Preserve selected-row identity when loading a preview and reject results from a superseded page/selection.

## Source and generated output

Edit `entrypoints/`, `src/`, `public/`, and build scripts. `.output/` and `apple/SW Inspector/SW Inspector Extension/Resources/` are generated bundles; use the commands in README to rebuild/sync. `logo.png` owns app/extension identity; `public/icons/toolbar.svg` owns the transparent toolbar symbol. Do not overwrite unrelated changes in this shared workspace or stage/commit them without instruction.

## Verification

- Code changes: run relevant tests, `pnpm check`, `pnpm build:safari`, and `pnpm check:manifest`. Check the generated manifest as well: the current checker is not a complete permission/MV3 audit.
- UI changes: inspect both themes at wide and narrow dock widths, populated/empty/error states, keyboard navigation, and long URLs/cache names. The synthetic fixture is documented in TESTING.md.
- Bridge/permission changes: reproduce in the actual Safari version and record installation route, origin, action, and result. Unit tests, Chrome, and fixture screenshots do not prove native Safari behavior.
- Documentation-only changes: verify local links and source accuracy; do not rerun the entire build without a reason.
- Report only checks actually run. Keep pending native acceptance explicit; **Refresh after navigation** remains necessary for the recorded temporary-access case.

## Documentation maintenance

Future feature work starts with [docs/plans/README.md](docs/plans/README.md), its common design and the assigned task only. Those plans are not shipped capabilities. The first exposed action/network feature must activate its scoped exception to ADR 0001 and update product copy; do not remove read-only safeguards merely because a plan exists. Keep task dependencies and shared interfaces exact. Prefer GPT-6.1-Sol with low reasoning for bounded implementation/document tasks when model selection is available; use fewer, narrowly scoped subagents. Do not silently inherit a more expensive model for routine work.

Keep one owner per fact: PRODUCT for scope, DESIGN for style, ADRs for decisions, TESTING for evidence, LEARNINGS for prevention. Update these documents in place. Add/supersede an ADR when the architecture changes; do not leave completed task plans or contradictory investigation snapshots as current instructions. Preserve the minimal repro and curated evidence when removing superseded prose. If tokens change, update DESIGN.md and its `.impeccable/design.json` companion together.

## Local tooling

Prefix shell commands with `rtk`. For library/API-specific questions, use Context7 outside the default sandbox: first `npx ctx7@latest library <name> "<specific question>"`, then `npx ctx7@latest docs <returned-id> "<single concept>"` (at most three commands per question). Skip this for ordinary refactoring, business logic, or documentation consolidation. Never include secrets in queries. On quota failure, report it and suggest `npx ctx7@latest login` or `CONTEXT7_API_KEY`; do not silently substitute remembered API details. Use the official Svelte tools when available for component changes.
