# ADR 0003: Follow Safari Storage and Network conventions

- Status: Accepted
- Date: 2026-10-19

## Context

SW Inspector lives inside Web Inspector and serves developers examining concrete registrations, cache keys, and response details. The original large cards and prominent status banner consumed space needed for inspection. The user explicitly chose **Safari Web Inspector, especially Storage and Network**, as the redesign reference and approved the resulting layout.

## Decision

- Use a compact, full-viewport inspector: toolbar, navigation tree, dense data table, adjacent response details, and a quiet status bar.
- Keep Service Workers, Cache Storage, Offline Resources, and Diagnostics as clear destinations. Keep routine inspection separate from the secondary bridge probe.
- Use system typography, neutral light/dark surfaces, restrained borders, small controls, and semantic selection/error colors. Use monospace for technical values.
- Preserve information density and readable data hierarchy. Avoid decorative cards, oversized metrics, gradients, promotional copy, and repeated explanatory banners.
- Keep response metadata lazy and body preview explicit. The design must preserve the diagnostic and privacy boundaries in [ADR 0001](0001-read-only-diagnostics.md).
- Adapt the same workflow to narrow panels using stacked details and compact navigation controls. Preserve keyboard navigation, visible focus, and explicit selected/empty/loading/error states.
- Treat [DESIGN.md](../../DESIGN.md) as the normative style and component contract. Extend its existing tokens and patterns before introducing another visual language.

## Consequences

New features must fit the inspector's existing information architecture and visual density. A new summary metric does not automatically justify a card or another global banner. Technical warnings belong beside the affected operation or state.

Review meaningful UI changes in light and dark themes, wide and narrow panels, with long URLs and representative error/empty/selected states. Synthetic fixtures prove rendering and interactions; they do not prove native Safari API behavior.

## Revisit when

A concrete workflow cannot fit the existing layout, accessibility evidence requires a change, or the user selects a new design direction. Update DESIGN.md with the accepted change and preserve product semantics.

## Evidence

- User-selected Safari Storage/Network direction and approval of the implemented redesign on 2026-10-19.
- [`App.svelte`](../../entrypoints/panel/App.svelte), [`Icon.svelte`](../../entrypoints/panel/Icon.svelte), and [product scope](../../PRODUCT.md).
- [Verification guidance and runtime boundaries](../TESTING.md).
