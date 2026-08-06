# ADR-0007: Use a minimal strict PNG profile

- Status: Accepted
- Date: 2026-08-06

## Context

The first Privacy Export needs a fresh PNG container without Source Media segments. Browser canvas encoding does not provide a stable container profile and cannot independently prove its own output safe. Adding a general-purpose codec or WASM runtime would increase the dependency, CSP, memory, and audit surface before the first tracer bullet is complete.

Slice 4 rendering is not implemented yet, so this decision can establish the encoder/verifier boundary but cannot complete the real export path by itself.

## Decision

The first PNG encoder accepts only an owned, dimension-matched RGBA8 rendered-pixel buffer whose alpha values are all 255. It takes ownership by transferring and detaching the caller's dedicated buffer, strips the redundant alpha bytes, then emits an opaque non-interlaced RGB8 PNG containing exactly one `IHDR`, one `IDAT`, and one `IEND` chunk. Scanlines use filter type 0 and platform `CompressionStream('deflate')`. No Source Media container bytes or metadata are accepted by the interface.

A separate Verifier implementation treats the result as untrusted. It snapshots the encoded bytes and verification policy, independently parses chunk framing and CRCs, permits only the three core chunk types, requires the opaque RGB8 profile and canonical dimensions, performs bounded `DecompressionStream('deflate')` decoding, and checks every required mask pixel for the exact RGB color. Opacity is structural because the accepted PNG profile has no alpha channel.

The Sanitizer releases only an immutable, branded PNG `Blob` after verification succeeds. A verification error releases no output. UI, worker-protocol, download, and real Working Document integration remain blocked until canonical rendering exists.

## Consequences

- No runtime dependency, WASM codec, source-segment copy, or browser canvas encoder is added.
- Browsers without `CompressionStream` and `DecompressionStream` fail closed; compatibility requires browser and real-device evidence before release.
- Valid PNGs outside this deliberately narrow generated profile are rejected by the runtime Verifier.
- Compressed bytes may vary between platform implementations, so tests and verification target decoded pixels and container policy rather than byte-for-byte encoder output.
- The runtime compressor and decompressor are platform facilities; independent command-line inspection of golden outputs remains required in CI.
- RGBA extraction, alpha validation, compression memory, color-space/transparent-input flattening policy, full-resolution limits, and normalized-to-integer mask rasterization remain open Slice 4 integration concerns.
