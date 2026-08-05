# ADR-0004: Fresh encode, then independently verify

- Status: Accepted
- Date: 2026-08-05

## Context

Selective metadata deletion requires recognizing every possible source segment and can silently miss unknown or malformed data. Browser canvas encoding varies by browser and does not itself prove that the final file satisfies the privacy policy.

## Decision

Render Privacy Export pixels into a fresh buffer and encode a new container without copying Source Media segments. Treat the encoded output as untrusted and pass it through a separate Verifier using a strict format-specific allowlist. Verification failure or uncertainty blocks download and sharing. CI additionally checks fixtures with independent tools.

## Consequences

- Metadata inspection and sanitization remain separate concerns.
- Encoders are judged by final output, not claimed behaviour.
- Output may contain only format-required and explicitly allowed technical data.
- C2PA, source color profiles, thumbnails, comments, EXIF, XMP, and IPTC are removed in Privacy Export.
- Re-encoding costs CPU and may alter image quality; performance budgets must be measured.
