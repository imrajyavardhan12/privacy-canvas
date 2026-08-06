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

### Slice 5: fresh PNG and verifier

Evaluate a minimal PNG encoder, produce a fresh container, scan its chunks using an independent Verifier, decode the final output, check mask coverage, and gate download.

Foundation implemented ahead of Slice 4: fully opaque synthetic RGBA8 buffers can be freshly encoded into a strict opaque RGB8 core-chunk-only PNG, independently parsed and boundedly decoded, checked for exact dimensions and opaque integer-region coverage, and released as an immutable `Blob` only after verification. This does **not** complete Slice 5: canonical renderer pixels, independent Working Document-to-mask rasterization, worker/UI integration, external-tool golden inspection, and download gating remain blocked on Slice 4.

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
