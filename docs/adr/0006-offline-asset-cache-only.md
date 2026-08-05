# ADR-0006: Offline cache contains application assets only

- Status: Accepted
- Date: 2026-08-05

## Context

At-risk users may need to work with unreliable connectivity or deliberately disable networking. A service worker can provide offline execution, but stale or mixed-version caches can preserve vulnerabilities and accidental runtime caching can retain user media.

## Decision

Generate a versioned precache manifest from the production build. Cache only immutable application assets required for the supported manual workflow. Never runtime-cache user-selected files, object URLs, previews, exports, external URLs, or navigation data containing user content. Activate versions atomically, expose update state, and remove obsolete caches.

## Consequences

- Offline completeness is tested from a cold installed state.
- Cache contents are asserted in browser tests.
- Updates require explicit lifecycle handling rather than unconditional `skipWaiting`.
- Optional future models must be bundled and included deliberately before media selection is enabled.
- Service-worker changes require threat-model review.
