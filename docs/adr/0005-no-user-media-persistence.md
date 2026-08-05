# ADR-0005: Do not persist user media

- Status: Accepted
- Date: 2026-08-05

## Context

Automatic recovery and project storage are convenient but leave highly sensitive images and metadata available after the editing session. Browser persistence has platform-specific eviction, backup, and inspection behaviour.

## Decision

v1 does not store Source Media, decoded pixels, previews, metadata values, Working Documents, or Privacy Exports in Cache Storage, IndexedDB, local storage, or session storage. Only static application assets may be cached. Output reaches disk or a share target only after explicit user action and successful verification.

## Consequences

- Refreshing or closing the page loses unsaved work.
- There is no automatic crash recovery in v1.
- Session reset revokes object URLs, closes bitmaps, overwrites detachable buffers where practical, and terminates workers.
- Documentation must call cleanup best effort, never secure erasure.
- Persistence tests inspect browser storage after editing and reset workflows.
