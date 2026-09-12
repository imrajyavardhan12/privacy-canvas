# Privacy Policy and Engineering Commitments

Last updated: 2026-08-09

Privacy Canvas processes the current JPEG intake, opaque rectangle editing, and verification-gated PNG download path locally. The implemented export path freshly renders and encodes a strict PNG inside the media worker, independently verifies its final bytes and confirmed masks, and exposes a download only after those checks succeed. Narrow WebKit-like automation is compatibility evidence only; real-device Safari and Android results and supported-browser claims are not available. Native sharing, image transforms, and broader input/output formats also remain unavailable.

## Data the production application will not collect

Privacy Canvas will have no accounts, analytics, advertising, telemetry, remote crash reporting, tracking pixels, cookies, or backend media processing. The application will not intentionally transmit Source Media, decoded pixels, metadata values, Working Documents, or Privacy Exports.

The static host will necessarily receive ordinary requests for application assets during online loading and may retain standard access logs such as IP address, user agent, requested path, and time. The production host and retention policy must be documented before launch. No media is included in those requests by design.

## Local processing

User-selected JPEG media is processed in browser memory by a dedicated media worker. Full-resolution source and rendered pixels remain worker-owned; only bounded previews and a verified encoded PNG may cross to the UI. Application code and required runtime assets are bundled and same-origin.

Media selection remains disabled until the one-way Network Lock has installed its complete application-asset cache, controls the page, and acknowledges activation. The active service worker serves only its precached application version and rejects every other fetch from controlled clients, including browser subresources, workers, XMLHttpRequest, and beacons; page guards additionally reject direct HTTP(S) `fetch` and WebSocket creation. The application-page CSP keeps `connect-src 'none'`. The `/sw.js` response has a narrower path-specific CSP exception of `connect-src 'self'`, required only for its same-origin `Cache.addAll` during installation; the worker has no cross-origin URL or runtime network path. Browser tests cover activation, service-worker restart, update/reload, offline execution, storage inventory, and no network egress through the tested mechanisms. Network Lock is defense-in-depth for the reviewed application, not a sandbox against a compromised browser, operating system, extension, or malicious release.

## Storage

The browser stores one active, versioned cache containing only the root document and built JavaScript/CSS required for the manual workflow. A fully installed update may wait in a second asset-only cache until the user explicitly activates it; activation switches controllers, reloads every controlled application page, and removes obsolete versioned caches. Privacy Canvas does not store user media, metadata values, previews, Working Documents, or exports in Cache Storage, IndexedDB, local storage, or session storage.

The current application offers a browser download under a fixed filename only after explicit user action and successful output verification. Native operating-system sharing is not implemented.

## Cleanup limitations

Privacy Canvas will revoke object URLs, close image bitmaps, overwrite detachable buffers where practical, and terminate workers. This is best-effort cleanup, not guaranteed secure deletion. Browsers, operating systems, GPU drivers, swap, screenshots, extensions, backups, and destination applications may retain copies outside our control.

## Metadata and provenance

Privacy Export removes privacy-sensitive and provenance metadata, including Content Credentials. Removing copyright, creator, or provenance information may be undesirable or legally restricted when the user does not own or control the media. Users should retain Source Media separately when evidentiary authenticity matters.

## No anonymity guarantee

Privacy Canvas reduces disclosure risk but cannot guarantee anonymity. Users must review clothing, tattoos, reflections, shadows, screens, signs, documents, surroundings, and other context in addition to faces.

## Changes

Any change that introduces media persistence, a backend, telemetry, remote models, runtime third-party requests, or automatic redaction approval requires an ADR, threat-model update, privacy review, and prominent policy revision before release.
