# ADR-0008: Round confirmed masks outward to canonical pixels

- Status: Accepted
- Date: 2026-08-06

## Context

Confirmed Redactions use normalized continuous coordinates, while a Privacy Export contains discrete canonical pixels. Fractional Canvas `fillRect` edges can be antialiased, and independently scaling geometry for a preview can make the preview and full-resolution result disagree. Floating-point arithmetic can also place an intended boundary fractionally to either side of an integer edge.

For this product, covering an extra edge pixel is safer than leaving any intersected edge pixel unchanged. Viewport and preview dimensions must not influence canonical coverage.

## Decision

A normalized rectangle is interpreted as the half-open area `[x, x + width) × [y, y + height)`. Canonical pixel coverage is derived by:

- `left = floor(x × canonical width)`;
- `top = floor(y × canonical height)`;
- `right = ceil((x + width) × canonical width)`;
- `bottom = ceil((y + height) × canonical height)`; and
- clamping all edges to canonical bounds.

No epsilon is used to move rasterized edges inward. Floating-point uncertainty can therefore over-redact an adjacent pixel, but cannot intentionally under-redact one. The existing `1e-9` tolerance applies only when validating the Working Document's one-source-pixel minimum; it does not shrink final mask coverage.

The canonical renderer replaces RGBA bytes through integer loops in Working Document order; it does not use fractional Canvas mask fills. A reduced preview maps those already-integer canonical mask bounds outward again to preview pixels. Canonical dimensions come only from validated normalized Source Media and the dimension-matched Working Document.

The Verifier derives required integer regions independently from normalized Working Document state and does not import renderer rasterization code. Where ordered masks overlap, it removes portions hidden by later masks so verification checks the final visible color.

JPEG normalization and preview canvases request opaque sRGB Canvas 2D storage. Confirmed mask colors are written as exact RGB bytes. Browser decoder color conversion, profile handling across supported devices, and future transparent PNG/WebP flattening still require explicit compatibility evidence; this decision does not claim those questions are fully resolved.

## Consequences

- Every canonical pixel intersected by a Confirmed Redaction is replaced by an exact opaque color.
- Boundary uncertainty fails toward extra coverage rather than disclosure.
- Preview masks can appear up to one preview pixel larger at an edge, but cannot determine or reduce canonical coverage.
- Renderer and Verifier code intentionally duplicate the load-bearing coordinate derivation, so tests must keep both implementations aligned with this ADR without extracting a shared production helper.
- Ordered overlap can fragment Verifier regions. Excessive operation, rasterization, or final-region work fails closed under existing limits.
- Image transforms remain unsupported; adding them requires defining their order relative to this canonical rasterization policy and adding golden tests.
