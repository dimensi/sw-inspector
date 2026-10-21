---
name: SW Inspector
description: Compact Safari inspection workspace with explicit worker/cache actions and declared Web App Manifest inspection
colors:
  background: "#fff"
  chrome: "#f2f2f2"
  sidebar: "#f6f6f6"
  stripe: "#f7f7f7"
  border: "#d0d0d0"
  subtle-border: "#e6e6e6"
  foreground: "#242424"
  secondary: "#626262"
  selection: "#0a62c9"
  selected-text: "#fff"
  hover: "#e5e5e5"
  button: "#fff"
  success: "#24723c"
  error: "#b42327"
  error-bg: "#fff1f0"
  warning: "#7b5900"
  warning-bg: "#fff7db"
  background-dark: "#1e1e1e"
  chrome-dark: "#2b2b2b"
  sidebar-dark: "#252525"
  stripe-dark: "#242424"
  border-dark: "#424242"
  subtle-border-dark: "#333"
  foreground-dark: "#e2e2e2"
  secondary-dark: "#ababab"
  selection-dark: "#145caa"
  hover-dark: "#373737"
  button-dark: "#383838"
  success-dark: "#87c99b"
  error-dark: "#ffaaa7"
  error-bg-dark: "#3b2424"
  warning-dark: "#e4c36b"
  warning-bg-dark: "#373020"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
  footer:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  square: "0"
  control: "3px"
spacing:
  step-2: "2px"
  step-4: "4px"
  step-6: "6px"
  step-8: "8px"
  step-10: "10px"
  step-12: "12px"
  step-16: "16px"
components:
  button:
    backgroundColor: "{colors.button}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "2px 8px"
  button-hover:
    backgroundColor: "{colors.hover}"
  button-active:
    backgroundColor: "{colors.border}"
  toolbar-button:
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "2px 6px"
  filter-input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "2px 6px"
    height: "23px"
  navigation-row:
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "3px 10px 3px 22px"
  navigation-row-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.selected-text}"
  property-section-heading:
    backgroundColor: "{colors.stripe}"
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
    padding: "5px 12px"
  table-header:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    padding: "3px 8px"
    height: "24px"
  table-cell:
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    padding: "2px 8px"
    height: "23px"
  table-row-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.selected-text}"
  notice-error:
    backgroundColor: "{colors.error-bg}"
    textColor: "{colors.error}"
    typography: "{typography.label}"
    padding: "7px 10px"
  notice-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
    typography: "{typography.label}"
    padding: "7px 10px"
---

# Design System: SW Inspector

## Overview

**Status: approved on 2026-10-19.** This is the visual contract for future panel work, recorded by [ADR 0003](docs/adr/0003-inspector-design.md). Frontmatter owns exact tokens; the component rules below explain their use. Keep the [component previews](.impeccable/design.json) in sync when changing the system.

**Creative North Star: "Safari inspection workspace"**

SW Inspector follows the Storage and Network workspace language explicitly selected by the user: persistent navigation, dense request rows, and a response inspector. Its character is quiet and technical. The hierarchy comes from pane boundaries, selection, and aligned data rather than a dashboard status hero.

The panel follows the system light or dark appearance. System typography belongs to the host tooling; monospace preserves the identity of URLs, headers, previews, and diagnostics. Data stays in a bounded inspection workspace, with explicit controls for refresh, measurement, and body preview.

**Key Characteristics:**

- System-following neutral surfaces with blue row selection.
- Compact controls, sticky table headers, and single-pixel separators.
- Persistent navigation and independent list/detail scrolling.
- Text labels distinguish absence, unknown values, warnings, and errors.

## Colors

The palette is neutral inspection chrome with a single selection accent; success, warning, and error colors carry runtime meaning. The frontmatter records the light values and their actual dark overrides. `prefers-color-scheme: dark` selects the overrides; selected text remains white in both themes.

### Primary

- **Inspector Blue** (`selection`, `selection-dark`): current navigation, selected request rows, and visible keyboard focus. Text selection uses the light Inspector Blue in both themes.

### Secondary

- **Runtime Green** (`success`, `success-dark`): confirmed active/controller state and present cache matches.
- **Error Red** (`error`, `error-dark`) on **Error Wash** (`error-bg`, `error-bg-dark`): failed inspection or local operation messages.
- **Warning Ochre** (`warning`, `warning-dark`) on **Warning Wash** (`warning-bg`, `warning-bg-dark`): partial inventories and inspection warnings.

### Neutral

- **Content Canvas** (`background`): main panes and fields.
- **Toolbar Chrome** (`chrome`), **Sidebar Surface** (`sidebar`), and **Row Stripe** (`stripe`): functional regions and alternating table rows.
- **Pane Border** (`border`) and **Subtle Divider** (`subtle-border`): structural and internal separators.
- **Primary Ink** (`foreground`) and **Secondary Ink** (`secondary`): values and supporting labels.
- **Control Surface** (`button`), **Hover Surface** (`hover`), and **Selected Text** (`selected-text`): control and selection states.

**The Selection Rule.** Use the selection color for the current navigation row, selected request row, and keyboard focus. Keep routine action buttons neutral.

## Typography

**Interface Font:** the system stack recorded in `typography.body`.
**Technical Font:** the monospace stack recorded in `typography.mono`.
There is no display face or oversized heading role.

### Hierarchy

- **Title:** pane and property-section headings use the title token; the size matches body copy and the weight supplies emphasis.
- **Body:** navigation, property labels and values, buttons, and ordinary copy.
- **Label:** table text, supporting metadata, notice copy, filters, and most footnotes.
- **Footer:** snapshot status and request-table footer.
- **Mono:** code, technical paths, request methods, diagnostic output, and previews. Response headers and the multiline path field use the shorter `ui-monospace, SFMono-Regular, Menlo, monospace` stack with the same size and leading.

Numbers use tabular figures throughout the inspector. No letter-spacing or uppercase presentation rule is applied.

**The Data Type Rule.** Use the system face for interface language and monospace for technical strings. Titles stay at the body size and gain hierarchy through weight.

## Layout

- The inspector fills the available viewport (`100dvh`) with a minimum height of 260px. Outer overflow is hidden; content regions own scrolling.
- The top toolbar and pane toolbars have a 33px minimum height. The bottom status bar has a 24px minimum height.
- The sidebar is 196px wide. Its view rows are at least 26px tall; cache children indent farther and use label-size text.
- Cache inspection divides into a flexible request list and a response pane occupying 32%, bounded between 255px and 440px. The request table retains a 420px minimum width and scrolls inside its own region.
- Property lists use a 138px label column and a flexible value column with a 12px gap. Response properties use a 76px label column and an 8px gap.
- Compact spacing is based on small control insets and 8–12px pane gutters. Section separation uses 16px; page-like outer margins are absent.

At widths of 950px or less, the sidebar narrows to 174px and the response pane moves below the request list. The two areas use 55%/45% flex bases with minimum heights of 150px/120px. At widths of 600px or less, selects replace the sidebar; the top toolbar grows to a 35px minimum, property labels shrink to 108px, cache toolbar actions wrap, and the inspection label and snapshot time hide. Request tables continue to scroll rather than changing into cards.

## Elevation & Depth

The system is flat. Surface tones and one-pixel borders delineate toolbars, the navigation tree, tables, and the response inspector. No box shadows or animated elevation appear in the source. Focus uses a two-pixel selection-colored outline inset by two pixels; selected request buttons use a white outline.

**The Pane Boundary Rule.** Separate adjacent work areas with one-pixel borders and neutral surface changes. The implemented workspace uses no shadows.

## Shapes

Controls and fields have restrained control-radius corners. Navigation and table rows remain square and span their full region. Borders are one pixel. Panel icons are inline outline SVGs with round caps and joins, a 16-unit view box, and a 1.25-unit stroke; the ordinary rendered size is 14px, with smaller cache and disclosure variants. No raster imagery is used inside the panel.

### Application and extension icon

The Web Inspector tab uses the transparent `public/icons/toolbar.svg` glyph through the `iconPath` argument of `devtools.panels.create`. Keep this separate from `manifest.icons`: the opaque application tile does not belong beside native Inspector tabs.

The identity asset is [logo.png](logo.png): a flat graphite inspector window with a sidebar divider and one blue selected row on an opaque neutral canvas. Preserve its simple silhouette and small-size legibility; avoid layered objects, gears, glass, gradients, and decorative lighting. This raster identity asset is separate from the panel's SVG control icons.

Safari's toolbar has a separate source, [public/icons/toolbar.svg](public/icons/toolbar.svg): the same inspector-window silhouette reduced to a black outline and two rows on a transparent canvas. Keep it monochrome, without the app icon's opaque tile or blue accent. Safari's `action.default_icon` points directly to this SVG; the Chrome build selects dedicated 16/19px PNGs and their 32/38px Retina counterparts. `action.default_title` names the button, with no popup. The extension identity still uses the opaque `manifest.icons` renditions. Direct SVG rendering was checked in the installed Safari 27.0 light toolbar; do not infer support in every browser/version from that result.

The toolbar glyph uses filled contours with one-unit thickness and straight edges on integer coordinates in a 16-unit view box. Its intrinsic size is 32px. Preserve these edges when refining it: the former 1.25-unit centered strokes spread straight lines across partial pixels at 16/32px. SVG alone does not guarantee native sharpness at every size; compare the installed Safari button with neighboring controls.

Generate both sets with `pnpm sync:logo`, then update extension bundles with `pnpm sync:safari`. The script uses macOS `sips` for the identity logo's extension icons, macOS AppIcon sizes, and wrapper welcome-window icon; ImageMagick renders the toolbar SVG directly to transparent PNGs. Check actual 16/32px toolbar renditions and native Safari appearance in both themes after replacements. Identity checks still include 16/32/128px sizes. The [asset provenance](.impeccable/assets/logo.json) records the identity asset's generation prompt and selected source.

## Components

### Buttons

Small neutral controls belong to the host toolbar. Standard buttons have a 24px minimum height, the control radius, and the button token padding. Hover adopts the hover surface; pressed state adopts the border tone; disabled state uses 45% opacity. Toolbar actions use transparent backgrounds and borders at rest with tighter horizontal padding. Labels and SVG icons share a 5px gap. There is no filled primary-action variant.

### Inputs / Fields

Fields use the content canvas, one-pixel pane border, and control radius. The URL filter has a 23px height and label typography; its adjacent search icon and result count sit in a 32px-minimum filter bar. The multiline offline path field is monospace, vertically resizable, and capped at 220px. Fields share the selection-colored keyboard focus outline. Placeholder text uses secondary ink at full opacity.

### Navigation

The sidebar is a compact tree. Current rows use selection blue and white text; counts inherit selected text. Cache namespaces nest under a separate disclosure control, whose chevron rotates when expanded. Diagnostics sits after a 16px gap at the bottom. At the narrow breakpoint, native selects provide view and cache choice.

### Request table and response inspector

Sticky neutral headers and alternating rows support scanning. Data cells use the table-cell token; numeric columns align right. Request rows become blue when selected, and a full-cell button keeps the URL area keyboard accessible. Arrow keys, Home, and End move focus and selection. The selected response remains in the neighboring pane, or the pane below at compact widths. Header details use native disclosure, while text/JSON preview requires its own button.

### Property lists

A muted label column aligns against a primary-value column. Technical strings wrap anywhere where needed. Registration, page, and storage groups have shallow striped section headings separated by rules, without card containers.

### Notices and empty states

Warnings and errors are full-width local strips with semantic color and plain text. Blank panes explain the next action in ordinary body copy. Partial inventory and measurement states remain explicit. The status bar reports the inspection state and the manual-refresh limitation without becoming a hero surface. For the recognized Safari tab-access denial, lead with **Allow access to this tab** and the toolbar/Refresh instruction; retain the original error under **Technical details**. Evaluation API, relay and other ambiguous failures keep their actual error and do not imply a permission diagnosis.

### Manifest inspection

The Manifest destination reuses the neutral toolbar, property rows, dense tables and local notices. Discover manifest, Load manifest and Show source are explicit separate controls; no request runs on mount, destination change, Refresh, discovery or source expansion. Label declarations and Inspector URL reconstructions separately, retain the Safari-processing disclaimer, and render source as escaped text in a named keyboard-scrollable region. Icon rows are metadata only, never images. Keep manifest errors inside its pane and reset/abort local operations on page/Refresh/unmount. No new tokens are introduced.

### Worker actions

The Service Workers toolbar uses a native registration select and neutral **Check for update** / **Unregister** buttons. Select by retained ID; a new registrations array clears selection. Use the common confirmation and compact local result with the actual update/unregister message. A snapshot-read error stays separate from the action outcome; disable stale management controls until a successful Refresh. Preserve dense property sections and wrap controls in the narrow dock. No new tokens are introduced.

### Cache action results

**Delete entry** acts directly on the selected response, without an ellipsis or confirmation dialog. Namespace and batch deletion keep their existing confirmation dialogs. Move focus to Refresh when the direct action starts so disabling its opener never strands keyboard focus; later results do not steal focus. Retain the same compact receipt and explicit Refresh for unknown outcomes.

Cache deletion results sit directly below the relevant Cache Storage toolbar. A confirmed success uses one neutral line, such as “Deleted 2 caches.”, a native **Details** disclosure collapsed by default, and a small close control with an accessible label. Omit zero counts and transport outcome terminology from the summary. Details retain every full target name and its individual outcome/message, with bounded local scrolling and the reminder that the site may recreate caches.

Already absent, failed and not-attempted targets remain distinct in plain language. Partial/error results use the existing semantic notice colors and offer Refresh; an unknown outcome keeps its warning and explicit Refresh until dismissed or the existing action context resets. Results render in the current inspection content and survive a separate overview refresh failure; existing action-context resets still clear them when changing panes. Do not use a global top banner, toast, timer or automatic dismissal.

### Motion

The build has no CSS transitions or animations. Disclosure rotation is immediate. Reduced-motion preference explicitly forces automatic scrolling.

## Do's and Don'ts

### Do:

- Do retain the current origin, manual refresh action, and inspection state in the surrounding chrome.
- Do use blue selection with readable selected text in navigation and request rows.
- Do preserve the compact type hierarchy and aligned property labels.
- Do allow long technical values to wrap in detail panes and scroll horizontally in the request table.
- Do keep empty, loading, partial, and error states beside the data they describe.
- Do keep response-body preview behind its explicit action.

### Don't:

- Don't restore the discarded status hero or rounded dashboard cards.
- Don't use color as the only description of a runtime state.
- Don't replace request rows with decorative cards at narrow widths.
- Don't add ornamental imagery, shadows, or motion to this inspection workspace.

### Extending the panel

| Addition | Use the existing pattern |
| --- | --- |
| Another worker/storage fact | A property row in the relevant section; preserve unknown and absent values. |
| Another collection of records | Sidebar destination and a dense table, with filtering near that table. |
| Details of a selected item | The response/detail pane; keep the list and its selection in place. |
| A diagnostic action | A neutral toolbar control beside the data it affects, with local progress/error state. |
| A warning or limitation | A short local notice or status line; include plain text, not color alone. |
| A debugging-only capability | The secondary Diagnostics view. |

Before finishing a UI addition, compare it with the [wide cache baseline](.impeccable/review/cache.png) and [compact dark baseline](.impeccable/review/mobile.png). Verify density, both themes, keyboard focus/selection, long values, empty/loading/error states, and scrolling confined to the appropriate pane. Use the [test procedure](docs/TESTING.md#ui-fixture-and-visual-baseline). Change a token deliberately across its uses; do not introduce a one-off visual theme for a feature.

This system was extracted from `entrypoints/panel/App.svelte` and `Icon.svelte` after the approved visual replacement. Browser fixtures and screenshots establish visual behavior only; they do not verify native Safari DevTools integration.
