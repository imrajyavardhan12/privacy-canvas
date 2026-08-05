# Privacy Policy and Engineering Commitments

Last updated: 2026-08-05

Privacy Canvas is designed to process images locally. This document describes the intended v1 release. The current foundation build does not accept or process images.

## Data the production application will not collect

Privacy Canvas will have no accounts, analytics, advertising, telemetry, remote crash reporting, tracking pixels, cookies, or backend media processing. The application will not intentionally transmit Source Media, decoded pixels, metadata values, Working Documents, or Privacy Exports.

The static host will necessarily receive ordinary requests for application assets during online loading and may retain standard access logs such as IP address, user agent, requested path, and time. The production host and retention policy must be documented before launch. No media is included in those requests by design.

## Local processing

User-selected media will be processed in browser memory. Application code and required assets will be bundled and same-origin. Once required assets are ready, the intended editor workflow performs no network requests. A Network Lock is planned as defense-in-depth.

## Storage

Static application assets may be stored by the browser to support offline use. Privacy Canvas v1 will not store user media, metadata values, previews, Working Documents, or exports in Cache Storage, IndexedDB, local storage, or session storage.

Files are written to disk or handed to an operating-system share target only after explicit user action and successful output verification.

## Cleanup limitations

Privacy Canvas will revoke object URLs, close image bitmaps, overwrite detachable buffers where practical, and terminate workers. This is best-effort cleanup, not guaranteed secure deletion. Browsers, operating systems, GPU drivers, swap, screenshots, extensions, backups, and destination applications may retain copies outside our control.

## Metadata and provenance

Privacy Export removes privacy-sensitive and provenance metadata, including Content Credentials. Removing copyright, creator, or provenance information may be undesirable or legally restricted when the user does not own or control the media. Users should retain Source Media separately when evidentiary authenticity matters.

## No anonymity guarantee

Privacy Canvas reduces disclosure risk but cannot guarantee anonymity. Users must review clothing, tattoos, reflections, shadows, screens, signs, documents, surroundings, and other context in addition to faces.

## Changes

Any change that introduces media persistence, a backend, telemetry, remote models, runtime third-party requests, or automatic redaction approval requires an ADR, threat-model update, privacy review, and prominent policy revision before release.
