# SW Inspector Privacy Policy

Last updated: October 19, 2026

This policy covers the SW Inspector macOS app and its Safari extension. SW Inspector processes inspection data locally on your Mac. It does not send that data to the developer or to an external service. It has no account system, advertising, analytics SDKs, or telemetry service.

## Data used for inspection

With the access you grant through Safari, SW Inspector reads diagnostic information for the page you inspect: Service Worker registrations and controller state, worker URLs and scopes, cache names, cached request metadata, response headers, and origin storage estimates.

Cached response bodies are read only when you explicitly request a text or JSON preview or a body-size measurement. Previews can contain personal or sensitive information stored by the inspected website. These operations take place locally.

## Storage and deletion

Inspection results are held in memory while the panel is open. SW Inspector also uses temporary working records in the inspected page. Those records expire automatically or disappear when that page's execution context ends; closing the Inspector alone does not immediately remove every temporary record. The app does not maintain a persistent database of your inspections.

Reports you choose to export remain in your chosen download location until you delete them. Disabling or uninstalling SW Inspector does not delete exported reports or the website's own stored data. The developer has no server-side copy of your inspection data to delete.

## Reports and sharing

Exporting creates a local JSON file containing diagnostic metadata, including the inspected origin, URLs, cache and Service Worker information, storage estimates, measurements, a timestamp, and the browser's user agent. Reports exclude cached response bodies, previews, and response headers.

SW Inspector does not upload reports automatically. URLs and other metadata may contain sensitive information; review a report before sharing it with anyone.

## Your controls

You can stop using the panel, manage website access where Safari provides that option, or disable the extension in Safari Settings under Extensions. Previewing response content, measuring bodies, and exporting reports are optional actions.

## Support and external websites

For privacy questions, contact the maintainer through [GitHub Issues](https://github.com/dimensi/sw-inspector/issues). Issues are public: do not post personal data, credentials, private URLs, or unredacted diagnostic reports. Information you choose to submit there is handled by GitHub under its own privacy policy and is visible to the maintainer and other readers.

This policy covers SW Inspector's behavior. Websites you inspect, Safari, macOS, and the App Store have their own data practices.

## Changes

This policy will be updated if SW Inspector's data practices change. The date above identifies the latest revision.
