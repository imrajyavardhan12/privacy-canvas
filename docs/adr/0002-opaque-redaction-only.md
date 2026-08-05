# ADR-0002: Opaque redaction is the privacy-safe operation

- Status: Accepted
- Date: 2026-08-05

## Context

Blur, pixelation, and translucent markers may preserve recoverable information and are easy to over-trust. The product serves users for whom disclosure can cause physical, legal, employment, or reputational harm.

## Decision

A Confirmed Redaction irreversibly replaces pixels with a fully opaque RGB color. Alpha is fixed at one and is not exposed as configuration. Rectangle, ellipse, brush, and polygon geometry may vary, but opacity does not. Blur and pixelation are classified as Obfuscation and excluded from v1.

## Consequences

- v1 has fewer visual effects but a clearer safety model.
- Types and runtime checks encode opacity as an invariant.
- Export verification checks covered output pixels after encoding.
- Any future Obfuscation must be visually separated, carry explicit warnings, and cannot be described as privacy-safe.
