# SW Inspector Privacy Policy

Last updated: October 21, 2026

This policy covers the SW Inspector macOS app and its Safari extension. SW Inspector processes inspection data locally on your Mac. It does not upload diagnostic reports to the developer or a telemetry service. It has no account system, advertising, analytics SDKs, or telemetry service.

## Data used for inspection

With the access you grant through Safari, SW Inspector reads diagnostic information for the page you inspect: Service Worker registrations and controller state, worker URLs and scopes, cache names, cached request metadata, response headers, and origin storage estimates.

Cached response bodies are read only when you explicitly request a text or JSON preview or a body-size measurement. Previews can contain personal or sensitive information stored by the inspected website. These operations take place locally.

## Storage and deletion

Inspection results are held in memory while the panel is open. SW Inspector also uses temporary working records in the inspected page. Those records expire automatically or disappear when that page's execution context ends; closing the Inspector alone does not immediately remove every temporary record. The app does not maintain a persistent database of your inspections.

Reports you choose to export remain in your chosen download location until you delete them. Disabling or uninstalling SW Inspector does not delete exported reports or the website's own stored data. The developer has no server-side copy of your inspection data to delete.

You can explicitly delete a selected Cache Storage namespace or a fixed list of up to 100 namespaces after confirmation. Deleting one selected cache entry acts directly without a confirmation dialog. These actions affect the inspected website’s Cache Storage locally; they do not clear HTTP cache, cookies, IndexedDB, or localStorage. The website may recreate deleted data. If an action’s result is unknown, refresh to inspect the current state before taking another action.

You can explicitly confirm an update check or unregister one selected Service Worker registration. An update check may make the browser download and install the website’s worker script; completion does not guarantee activation. Unregister does not necessarily stop control of existing pages and does not delete Cache Storage. These actions do not send inspection data to the developer.

You can explicitly load the document’s declared Web App Manifest. This makes one browser request to its resolved URL, which may be on another origin and may include ordinary browser credentials/referrer information according to the link’s policy. The response is bounded to 256 KiB and 8 seconds, held in memory and shown locally. Manifest icons and screenshots are not downloaded, and manifest source is excluded from exported reports. Discovery and showing already loaded source do not make requests.

You can explicitly confirm sending a JSON value to the selected website worker. This sends the payload to website code, which may wake the worker, change website state or perform its own network/storage operations. SW Inspector does not send it to the developer. Posting confirms submission, not delivery. An optional supplied-port reply and explicit document message listening remain local, temporary and bounded; the five-second reply timeout does not prove failed delivery. A ten-second session lease bounds page-side cleanup if the panel disappears. Hide, Refresh, navigation and permission failure stop polling and best-effort remove only Inspector-owned listeners/ports; returning does not resume listening. Drafts and message content are not persisted or included in exported reports.

## Reports and sharing

Exporting creates a local JSON file containing diagnostic metadata, including the inspected origin, URLs, cache and Service Worker information, storage estimates, measurements, a timestamp, and the browser's user agent. Reports exclude cached response bodies, previews, response headers, manifest source, message payloads/logs and ephemeral session/worker handles.

SW Inspector does not upload reports automatically. URLs and other metadata may contain sensitive information; review a report before sharing it with anyone.

## Your controls

You can stop using the panel, manage website access where Safari provides that option, or disable the extension in Safari Settings under Extensions. Previewing response content, measuring bodies, and exporting reports are optional actions.

## Support and external websites

For privacy questions, contact the maintainer through [GitHub Issues](https://github.com/dimensi/sw-inspector/issues). Issues are public: do not post personal data, credentials, private URLs, or unredacted diagnostic reports. Information you choose to submit there is handled by GitHub under its own privacy policy and is visible to the maintainer and other readers.

This policy covers SW Inspector's behavior. Websites you inspect, Safari, macOS, and the App Store have their own data practices.

## Changes

This policy will be updated if SW Inspector's data practices change. The date above identifies the latest revision.
