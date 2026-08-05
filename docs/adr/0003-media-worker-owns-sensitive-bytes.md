# ADR-0003: The media worker owns sensitive bytes

- Status: Accepted
- Date: 2026-08-05

## Context

Image parsing, decoding, full-resolution rendering, and encoding are expensive and security-sensitive. Keeping Source Media in UI state increases accidental exposure, main-thread stalls, and coupling between presentation and privacy logic.

## Decision

After local file selection, transfer Source Media processing to a dedicated media worker. The worker owns intake, normalized full-resolution pixels, export rendering, encoding, and verification. The UI receives status, plain-text metadata risk categories, typed errors, and reduced preview frames. React is not a dependency of privacy-critical modules.

## Consequences

- Worker messages require runtime validation and stable versioning.
- Cleanup terminates the worker and releases its buffers and bitmaps on a best-effort basis.
- Browser worker and OffscreenCanvas compatibility require real-device tests.
- The seam improves locality but is not a security sandbox against arbitrary same-origin script execution.
