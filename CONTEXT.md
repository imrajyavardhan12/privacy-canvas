# Domain Context

Privacy Canvas reduces the risk of disclosing sensitive information when sharing an image. It does not promise anonymity.

## Users

- **At-risk publisher** — a journalist, activist, researcher, community organizer, or other person preparing an image for distribution.
- **Reviewer** — the person who checks suggestions, confirms redactions, and approves a Privacy Export. The publisher and reviewer may be the same person.

## Domain terms

### Source Media

The original bytes selected by the user. Source Media is read-only, may contain hostile input, and may include pixels, metadata, embedded thumbnails, color profiles, multiple frames, and provenance records. Privacy Canvas does not persist Source Media.

### Working Document

The canonical image dimensions, transforms, and ordered edit operations for the current session. A Working Document refers to decoded pixels owned by the media worker; it does not contain the original container metadata.

### Sensitive Region

An area that may disclose a face, identifier, tattoo, screen, document, reflection, location, or other private information.

### Suggested Region

An untrusted region proposed by local automation. A Suggested Region is never exported as a redaction until a Reviewer confirms it.

### Confirmed Redaction

A Reviewer-approved operation that irreversibly replaces pixels in a region with an opaque color. A Confirmed Redaction has no configurable alpha channel.

### Obfuscation

A visual effect such as blur or pixelation that may preserve recoverable information. Obfuscation is not a privacy-safe redaction and is outside the initial release.

### Transform

A crop, rotation, flip, or resize applied to the Working Document. Viewport zoom and pan are not Transforms and never alter export pixels.

### Privacy Export

A new image rendered from the Working Document, freshly encoded without copying Source Media container segments, and accepted only after verification.

### Verification Report

A local, non-persistent result describing the output format, dimensions, confirmed-redaction checks, metadata classes checked, and any failure. It does not claim that every Sensitive Region was found.

### Metadata Risk Summary

A bounded, plain-text classification of privacy-relevant source metadata, including location, device identity, timestamps, creator/contact information, embedded thumbnails, editing history, provenance, other embedded text, and unclassified metadata structures. Source values are untrusted. An `inspected` status means the supported advisory parsers completed; it does not prove that metadata is absent or fully understood.

### Network Lock

A one-way, per-session defense that rejects runtime network requests after required application assets are ready and before Source Media can be selected. Network Lock is defense-in-depth, not a substitute for safe code or an uncompromised browser.

## Invariants

1. A Suggested Region never becomes a Confirmed Redaction without an explicit reviewer action.
2. A Confirmed Redaction is fully opaque.
3. Viewport dimensions never determine Privacy Export dimensions.
4. Source Media container segments are never copied into a Privacy Export.
5. A Privacy Export cannot be saved or shared when verification fails.
6. Source Media and decoded pixels are not stored in application persistence.
7. Untrusted filenames and metadata are rendered as text, never interpreted as markup or code.
8. Cleanup is described as best effort; secure memory erasure is not promised.
9. Privacy Canvas reduces disclosure risk and never claims to guarantee anonymity.
