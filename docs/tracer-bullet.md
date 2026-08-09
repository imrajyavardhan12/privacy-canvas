# First Tracer Bullet

Tracking issue: [#2](https://github.com/imrajyavardhan12/privacy-canvas/issues/2)

## Goal

Prove one complete privacy path before expanding the editor:

> Open a JPEG containing sensitive metadata, inspect a risk summary, add one opaque rectangle, export a full-resolution PNG, and independently verify the output.

## User-visible acceptance criteria

1. The file picker accepts one local JPEG only.
2. Intake rejects a renamed non-JPEG, malformed dimensions, unsupported animation, and files above provisional resource limits.
3. EXIF orientation is normalized correctly for fixtures 1–8.
4. Metadata values are shown as inert text and grouped by privacy risk.
5. A pointer or keyboard user can add, move, resize, and remove one opaque rectangle.
6. Preview zoom does not change output dimensions.
7. Export renders from canonical pixels at normalized source dimensions.
8. The PNG encoder receives only rendered pixels, not source segments.
9. Runtime verification rejects any PNG containing forbidden textual or metadata chunks.
10. Runtime verification confirms the rectangle interior is opaque in the encoded result.
11. Download remains disabled until verification succeeds.
12. Reset releases file references, previews, and worker state without writing user media to browser storage.
13. Browser tests fail on any network request after file selection.
14. ExifTool and C2PA tooling confirm the golden output contains no forbidden source metadata.

## Delivery slices

### Slice 1: hostile fixture corpus

Create small, licensed or generated JPEG fixtures containing GPS, camera identity, timestamps, thumbnail, XMP, IPTC, C2PA/JUMBF, HTML-like values, all EXIF orientations, truncation, oversized dimensions, and valid control files. Document how every fixture was produced.

### Slice 2: intake to normalized pixels

Implement file sniffing, provisional byte/pixel limits, metadata risk classification, orientation normalization, worker ownership, typed stage errors, and deterministic cleanup. Do not build the editor yet.

### Slice 3: rectangle Working Document

Connect the existing opaque rectangle invariant to pointer and keyboard editing in canonical coordinates. Add operation history for add, update, and remove.

Implemented evidence: the framework-independent Working Document records bounded opaque rectangle add/update/remove operations with undo/redo, while the UI exposes one pointer- and keyboard-editable rectangle over the reduced preview. Browser tests cover both input paths and prove editing adds no HTTP(S) requests. Full-resolution rendering and export remain later slices.

### Slice 4: preview and full-resolution render

Render reduced previews and a canonical PNG pixel buffer from the same Working Document semantics. Add golden pixel and transform tests.

Implemented rectangle-only evidence: a framework-independent Renderer validates and snapshots hostile render state, conservatively maps normalized half-open rectangles to integer canonical pixels under ADR-0008, applies exact opaque colors in operation order to a dedicated canonical RGBA buffer, and maps the same canonical masks outward onto bounded previews. The current version 3 worker protocol binds render and export requests to source identifiers, rejects unknown response data, retains raw full-resolution derivatives only in the worker, and returns bounded redacted `ImageBitmap` previews or verification-gated encoded output; stale UI results are discarded and dimension mismatches terminate the session. A separate Verifier-side module independently derives final-visible integer regions, including ordered overlaps. Golden tests cover colors, overlap order, fractional and 0/1 edges, one-pixel/tiny output, preview scaling, canonical dimensions, malformed plans, resource bounds, stale preview replacement, cleanup, and absence of full-resolution raw response fields. Image transforms are still unsupported, so transform-order goldens, full-resolution device budgets, and non-Chromium evidence remain open rather than being claimed complete.

### Slice 5: fresh PNG and verifier

Evaluate a minimal PNG encoder, produce a fresh container, scan its chunks using an independent Verifier, decode the final output, check mask coverage, and gate download.

Implemented rectangle-only evidence: one source-bound worker operation independently derives a canonical render plan and final-visible verification policy from the Working Document, rerenders fresh full-resolution RGBA, transfers that dedicated buffer into the strict core-chunk-only RGB8 PNG encoder, and releases an `export-ready` Blob only after bounded final-byte verification succeeds. The client validates and freezes the report; React creates a fixed safe-filename download URL only for that result and revokes it on edit or reset. Unit tests cover dimension-policy mismatch, mutable inputs, encoding and verification failures, malformed protocol output, stale dimensions, and timeouts. Chromium downloads the 64 × 48 result, independently parses its three chunks and pixels, checks canonical mask color, and proves no HTTP(S) request. A committed browser-produced golden is also checked by ExifTool and `c2patool` in CI. Native share, full-resolution device calibration, and non-Chromium CompressionStream evidence remain open.

### Slice 6: browser privacy proof

Exercise the complete workflow under Chromium and WebKit-like automation where practical; inspect storage, object URL cleanup, CSP, requests, keyboard flow, and offline behaviour. Complete real-device Safari and Android checks before release.

## Exit gate

The tracer bullet is complete only when:

- every acceptance criterion has an automated test where automation is reliable;
- real-device results and resource budgets are recorded;
- the threat model is updated with implemented evidence;
- output is independently inspected in CI;
- a manual security review finds no path around verification gating; and
- no v1.1 automation feature has been added.
