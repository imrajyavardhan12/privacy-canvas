# Architecture

Status: proposed and partially scaffolded

## Goals

- Concentrate privacy-critical behaviour in a small number of deep modules.
- Keep Source Media bytes and full-resolution pixels out of the UI module.
- Make the same interfaces the caller and test surfaces.
- Add seams only where behaviour actually varies.
- Fail closed when intake, rendering, encoding, or verification is uncertain.

## Runtime model

```mermaid
flowchart LR
    U["User"] --> UI["UI module"]
    UI --> WD["Working Document"]
    UI --> VP["Viewport module"]
    UI --> MW["Media worker"]
    MW --> IN["Intake module"]
    IN --> RD["Renderer module"]
    WD --> RD
    RD --> EN["Encoder module"]
    EN --> VR["Verifier module"]
    VR --> PA["Platform adapter"]
    PA --> U
    DT["Detection worker"] --> WD
```

The initial release excludes the Detection worker. It is shown to preserve its intended relationship: it produces Suggested Regions and cannot produce Confirmed Redactions.

### Network Lock and offline application assets

Before Source Media selection is enabled, `src/security/network-lock.ts` registers the generated same-origin `/sw.js`, waits for an active controller, receives its versioned acknowledgement, and installs direct page guards for HTTP(S) `fetch` and WebSocket creation. The service worker precaches exactly the root document and emitted JavaScript/CSS required by the manual workflow. Once controlling, it serves requests only from its immutable version cache and returns a network error for every non-precache fetch, including subresources, worker requests, XMLHttpRequest, and beacons. This rule applies to every controlled client rather than in-memory client identifiers, so browser termination and restart of the worker remains fail closed. Production `connect-src 'none'` remains an independent boundary.

`vite.config.ts` derives a 16-hex release version from the source document, emitted artifact names and bytes, and the service-worker policy itself. A new version completes `Cache.addAll` before it can become waiting. The UI then disables new media selection and exposes an explicit “Activate update and reload” action. Only that action asks the waiting worker to skip waiting; activation claims clients, removes obsolete versioned asset caches, and causes every controlled application page to reload under the one complete version. There is no runtime cache path and no user-derived URL is eligible for precaching.

The complete JPEG → rectangle → verified PNG workflow is exercised after closing the installed page and reopening it with browser networking disabled. Cache inventory is unchanged by processing and reset. The Vite development server instead serves a cache-clearing pass-through service worker so transformed development modules remain usable; the UI labels Network Lock unavailable and permits synthetic test media only. Production privacy and offline evidence always runs against the built application. Playwright WebKit-like automation covers a narrow workflow and cleanup path as compatibility evidence only; it is not a browser-support claim. Real-device evidence and provisional resource calibration remain a release gate in `docs/browser-privacy-evidence.md`.

## Deep modules

### Intake module

The Intake module owns the entire transition from untrusted local file to normalized media state:

- magic-byte and container validation;
- file-size, dimension, pixel-count, and frame-count limits;
- metadata risk classification;
- EXIF orientation normalization;
- color-space policy;
- decoding and failure handling; and
- transfer of normalized pixels to the renderer.

Metadata inspection is advisory. Intake failure never causes source container segments to be copied into output.

The pre-decode controls are implemented behind the framework-independent `inspectSourceMedia` interface in `src/intake/source-media.ts`. It scans the complete JPEG marker stream, validates magic bytes and a single complete frame, rejects trailing or concatenated data, reads EXIF orientation, and enforces provisional byte, dimension, and pixel budgets. `src/intake/jpeg-metadata.ts` adds bounded advisory classification for selected EXIF/GPS, XMP, IPTC, JPEG comment, embedded-thumbnail, and C2PA/JUMBF risks; recognized parser failures, truncated values, and exceeded metadata budgets produce a `partial` summary without making pixel intake depend on successful metadata interpretation.

The browser intake, render, and export path is implemented through the versioned, runtime-validated protocol in `src/workers/media-worker-protocol.ts`. Protocol version 3 binds render and export requests to worker-issued source identifiers, independently derives render and verification policies for export, and rejects unknown response fields so full-resolution raw pixels cannot accidentally cross the UI boundary. The UI clears the file input; the client checks `File.size` before allocation, reads the selected `File` once, and transfers its `ArrayBuffer` to an inline-bundled dedicated worker without a data URL or HTTP(S) request. The worker runs preflight before `createImageBitmap`, neutralizes APP1 metadata only in a decode-specific copy, verifies that the decoder returns encoded dimensions, and applies the validated orientation itself before retaining normalized full-resolution pixels in an opaque sRGB `OffscreenCanvas`. Inspection facts, previews bounded to 512 pixels per axis, typed failures, and a freshly encoded PNG `Blob` plus immutable Verification Report only after successful final verification may cross back to the UI. Intake, decode, render, encode, and verify failures are typed; unexpected protocol values, stale source identifiers, semantic dimension mismatches, and operation deadlines fail the worker session. Reset clears preview, canonical derivative, verified object URL, and document state, asks an idle worker to clear its canvas, terminates it, and creates a fresh inline worker. If export is pending, reset terminates that worker immediately rather than queueing cleanup behind the operation deadline. Browser tests cover orientations 1–8 and expected corner order, hostile text rendering, malformed input and decoder failure, reduced and redacted preview pixels, stale preview and export replacement, verification-gated full-resolution download, pending-export termination, object-URL revocation, no user-media persistence, no HTTP(S) requests after selection, and startup under the production CSP/Trusted Types policy. Measured device budgets, complete decoder color-conversion evidence, deadline calibration, and non-Chromium real-device evidence remain open.

### Working Document module

The Working Document owns transforms, Confirmed Redactions, operation ordering, and undo/redo. Geometry is represented as normalized canonical document coordinates rather than viewport pixels. `src/document/working-document.ts` now records explicit source dimensions and applies framework-independent add, update, and remove commands to ordered rectangle operations. Undo and redo move through that operation history, a new command discards an abandoned redo branch, and unchanged updates do not create misleading history entries. `src/document/redaction.ts` enforces finite in-bounds coordinates, non-zero area, and a fully opaque RGB color; its move and bottom-right resize operations clamp geometry to the document boundary and a caller-supplied minimum size. The Working Document additionally rejects rectangles smaller than one canonical source pixel per axis. The first UI slice intentionally exposes only one editable rectangle.

### Renderer module

The framework-independent Renderer in `src/renderer/canonical-renderer.ts` runtime-validates a narrow Working Document snapshot and creates a frozen, trusted render plan. ADR-0008 defines conservative half-open coverage: normalized starts are floored and ends are ceiled to canonical integer bounds without an inward epsilon. The Renderer rejects malformed dimensions, geometry, identifiers, status, kind, color, opacity, duplicate identifiers, transparency, partial RGBA views, excessive operations, and excessive rasterization work. It writes exact opaque RGB bytes in Working Document order into a dedicated canonical RGBA buffer without mutating retained normalized Source Media pixels.

The media worker owns preview and export rendering. Preview requests extract a fresh full-resolution derivative from the retained opaque sRGB `OffscreenCanvas`, apply the canonical plan, wipe the temporary extraction, retain the latest canonical RGBA output inside the worker, and independently draw Source Media plus outward-mapped canonical masks into a bounded derivative preview. Export requests discard any older derivative, rerender fresh canonical RGBA for the source-bound Working Document, transfer that dedicated buffer into the encoder, and release no preview. Only bounded `ImageBitmap` previews, dimension facts, and a verified encoded output cross to the UI; canonical RGBA bytes remain worker-owned. Source identifiers, request ordering, client-side stale-result disposal, and dimension checks fail closed on new-source, stale-render, and stale-export races. Reset and replacement operations overwrite or detach retained derivatives on a best-effort basis.

The current application displays worker-rendered rectangle previews and exposes a fixed safe-filename PNG download only after the export operation succeeds. Editing the Working Document removes and revokes any prior download immediately; failures and timeouts expose no output. Native share remains absent. Full-resolution memory/latency calibration, render coalescing, non-Chromium OffscreenCanvas and CompressionStream evidence, future transform ordering, decoder color conversion, and transparent-input flattening remain open. A measured fallback may be added only if a second adapter is required.

### Sanitizer module

The Sanitizer coordinates export rendering and fresh encoding. It does not copy source file segments, metadata, thumbnails, or profiles. Format adapters are introduced only when two encoders are actually supported.

The strict PNG path is implemented in `src/encoder/png-encoder.ts` and `src/sanitizer/png-sanitizer.ts` and is connected only inside the media worker's source-bound `export-document` operation. The encoder accepts a dedicated dimension-matched RGBA8 rendered-pixel buffer with alpha 255 everywhere, transfers ownership away from its caller, and creates a strict opaque RGB8 non-interlaced PNG with exactly one `IHDR`, one `IDAT`, and one `IEND`. Before encoding, the Sanitizer requires rendered dimensions to match the independently derived verification policy. It returns an immutable branded `Blob` only after final-byte verification succeeds; the worker protocol then validates and snapshots the report before the UI can create a download URL.

### Verifier module

The Verifier treats encoded output as untrusted. It checks:

- container structure and declared format;
- dimensions and frame count;
- a strict metadata allowlist;
- absence of EXIF, GPS, XMP, IPTC, comments, thumbnails, source color profiles, and C2PA/JUMBF data; and
- coverage of Confirmed Redactions after final encoding.

`src/verifier/png-verifier.ts` implements this policy for the deliberately narrow PNG profile. It snapshots mutable input, independently validates framing and CRCs, rejects every non-core chunk, bounds decompression to the exact expected RGB8 scanline length, checks canonical dimensions, structurally rejects alpha, and verifies required integer mask regions for exact RGB. `src/verifier/working-document-policy.ts` independently validates normalized Working Document mask state and derives conservative integer required regions without importing Renderer rasterization code. Ordered overlaps are reduced to non-overlapping final-visible regions so exact-color verification matches final compositing; excessive fragmentation fails closed. The media worker derives this policy separately from its canonical render plan and passes both fresh output and policy through the Sanitizer before an `export-ready` response can exist. A committed browser-produced PNG is additionally inspected by ExifTool and `c2patool` in `pnpm run check` and CI.

The Verifier does not claim that every Sensitive Region was found. A failed or inconclusive check blocks Sanitizer output, and editing or reset revokes an earlier verified download. Native share remains absent rather than exposing an unimplemented path.

### Viewport module

The Viewport owns Pointer Events, pointer capture, keyboard input, pan, zoom, brush preview, and coordinate conversion. `src/viewport/coordinates.ts` now converts CSS-scaled pointer positions into bounded normalized document points. The React-edge rectangle editor uses pointer capture for draw, move, and resize, and provides keyboard add, one-source-pixel move/resize, remove, undo, and redo paths. Viewport zoom and pan remain unimplemented; when added, they must not change Working Document or export dimensions without an explicit Transform.

### Detection module

Post-v1 automation runs in a separate worker on a reduced-resolution, metadata-free image. It returns Suggested Regions only. The module stores no embeddings and performs no recognition or identity matching.

### Platform module

The first platform handoff is standard browser file download from a verification-gated object URL under a fixed safe filename. Native file sharing remains a distinct future adapter and is absent where unimplemented. File System Access may become a third progressive adapter. Unsupported capabilities remain absent rather than polyfilled through a backend.

## Data lifecycle

1. The versioned application cache completes and Network Lock controls the page; only then can the user select Source Media.
2. The UI receives a user-selected File.
3. The client checks `File.size`, reads the File once, and transfers its `ArrayBuffer` to the media worker without conversion to a data URL.
4. Intake validates the container and resource budget before full decode.
5. Untrusted metadata is reduced to a plain-text Metadata Risk Summary.
6. The media worker owns normalized full-resolution pixels.
7. The UI receives only preview frames and document state.
8. The user creates Confirmed Redactions through canonical Working Document operations; explicit image transforms remain planned.
9. The media worker renders and retains a fresh full-resolution RGBA derivative while returning only a bounded redacted preview.
10. A source-bound export request rerenders a fresh derivative and transfers its dedicated buffer to the encoder, which creates a new container without source segments.
11. The independently derived Verifier policy checks final bytes, canonical dimensions, strict metadata structure, and final-visible rendered masks.
12. Only after success, a verified PNG `Blob` and immutable Verification Report cross to the UI; direct user activation downloads it under the fixed safe filename `privacy-export.png`.
13. Editing invalidates and revokes the prior download; session cleanup also revokes object URLs, closes bitmaps, detaches or overwrites buffers where practical, and terminates workers.

Cleanup is best effort because browser and operating-system copies cannot be proven erased.

## Dependency direction

- UI depends on Working Document and typed worker messages.
- Viewport depends on Working Document geometry, not on rendering internals.
- Intake, Renderer, Sanitizer, and Verifier live behind the media-worker seam.
- Detection depends only on reduced normalized pixels and returns suggestions.
- Platform adapters receive only a verified output Blob and safe filename.
- Privacy-critical modules never depend on React.

## Error strategy

Errors are typed by stage: intake, resource limit, decode, render, encode, verify, and platform handoff. Unknown errors become terminal failures for the current operation. Privacy Export never falls back to an unverified path.

## Persistence

Only versioned application assets required by the manual workflow are precached for offline execution. One complete active cache and, during explicit update review, one complete waiting-version cache may exist. Source Media, decoded pixels, previews, Working Documents, metadata values, and Privacy Exports are not written to Cache Storage, IndexedDB, local storage, or session storage by v1.

## Deployment

The production application is a static build hosted over HTTPS on infrastructure capable of custom response headers. Production headers are represented by `public/_headers`. Runtime assets are same-origin and bundled. The inline media worker uses a same-origin blob URL under `worker-src 'self' blob:`; `src/security/trusted-types.ts` installs a default Trusted Types policy that can create only exact same-origin `/sw.js` or same-origin blob script URLs and cannot create HTML or script text. A browser test loads the application under the production policy and proves other worker URL shapes and string-based HTML sinks are rejected. `connect-src 'none'` remains in force; any future requirement to relax it requires an ADR and explicit threat-model review.
