---
version: 1
slug: "entrypoints-panel-app-svelte"
primary_target: "entrypoints/panel/App.svelte"
related_targets:
  - "entrypoints/panel/Icon.svelte"
---

# SW Inspector panel

Mode: Operate. Approved reference: Safari Web Inspector's Storage and Network.
The governing visual system is [DESIGN.md](../../DESIGN.md); the decision is [ADR 0003](../../docs/adr/0003-inspector-design.md).

The workflow is explicit Refresh → choose a worker/cache → filter and select a request → inspect metadata → optionally load a body preview or measure bodies. Diagnostics remains a secondary destination.

Keep the toolbar, navigation tree, request list, response details, and quiet snapshot footer. Details stack below the table in a compact dock; narrow navigation uses native selects. Extend those patterns and preserve read-only operation, explicit body reads, local errors, and session isolation.

Wide/light and narrow/dark synthetic reference captures, their provenance, and verification scope are indexed in [TESTING.md](../../docs/TESTING.md). Native Safari acceptance is separate from rendering checks.

Design provenance: direction seed `3be942bf`; the user's explicit Safari choice superseded the generated alternatives. The implemented layout was approved on 2026-10-19; it used code-native controls and SVG icons, with no generated raster comp.
