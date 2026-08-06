# Research Summary

Date: 2026-08-05

## Conclusion

The product opportunity is a focused, auditable image privacy workbench—not a general media editor. Existing tools demonstrate demand for local processing and assisted face covering, but few make sanitization independently verifiable or clearly separate opaque redaction from cosmetic obfuscation.

## Prior art

### Image Scrubber

[Image Scrubber](https://github.com/everestpipkin/image-scrubber) proved that a small browser tool can make local image redaction accessible. Its implementation relies on global canvas state, incidental metadata removal through canvas export, incomplete offline caching, and unverified blur. Privacy Canvas is a clean implementation and does not copy its source.

### Redact

[Redact](https://github.com/lolusername/redact) demonstrates a simple workflow combining automatic face suggestions and opaque rectangles. Its current exporter derives output dimensions from the displayed image, and its automated coverage is limited primarily to geometry tests. It does not independently inspect final output bytes.

### W3PN Anonymizer

[W3PN Anonymizer](https://github.com/web3privacy/w3pn-anonymizer) demonstrates that face, object, OCR, image, video, audio, live media, and document processing can run locally. Its breadth also creates a much larger dependency, model, and review surface. Privacy Canvas intentionally starts with one image workflow.

### Signal

[Signal's blur announcement](https://signal.org/blog/blur-tools/) confirms two important design constraints: processing can remain local, and face detection is imperfect and potentially biased. Manual correction is therefore mandatory.

### ObscuraCam and ProofMode

[ObscuraCam](https://github.com/guardianproject/ObscuraCam) is important native privacy prior art. [ProofMode](https://github.com/guardianproject/proofmode) highlights a separate need: retaining evidence and provenance. Privacy sanitization and evidentiary preservation can conflict and must not be silently combined.

## Security and privacy findings

- The [Freedom of the Press Foundation](https://freedom.press/digisec/blog/redacting-photos-on-the-go/) recommends fully opaque shapes when in doubt because some blur algorithms are vulnerable to de-obfuscation.
- Browser canvas export creates a new image representation, but the browser controls format support and encoding details. [MDN documents](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob) that PNG is the fallback and output creation can fail. Canvas export alone is therefore not a verification strategy.
- [`createImageBitmap`](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap) applies EXIF orientation by default and exposes implementation-dependent color conversion. The implemented JPEG worker avoids independent orientation interpretation by neutralizing APP1 metadata in a decode-only copy, checking encoded dimensions, and applying the preflight orientation itself. Color behaviour and non-Chromium decode compatibility still require fixture tests across supported browsers.
- [`OffscreenCanvas`](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) enables rendering and encoding outside the UI thread, but context loss and browser compatibility remain explicit failure modes.
- [Trusted Types](https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API) can enforce that strings are not passed to DOM injection sinks. Privacy Canvas additionally avoids dynamic markup for untrusted values.
- [C2PA security guidance](https://spec.c2pa.org/specifications/specifications/2.4/security/Security_Considerations.html) confirms that manifests can be stripped and that doing so affects provenance. The product must report this explicitly.
- [IPTC guidance](https://iptc.org/std/photometadata/documentation/userguide/) notes that copyright and creator metadata can have legal and professional value. Privacy Canvas defaults to privacy removal but warns users to operate only on media they are authorized to modify.

## Technical candidates

### Encoding

[jSquash](https://github.com/jamsinclair/jSquash) provides browser- and worker-focused WASM encoders for JPEG, PNG, WebP, AVIF, and other formats under Apache-2.0. It remains a candidate for future formats, not an accepted dependency. For the first PNG tracer bullet, ADR-0007 selects a dependency-free opaque RGB8 output profile using platform deflate, an encoder that emits only `IHDR`/`IDAT`/`IEND`, and a separately implemented bounded Verifier. Full-resolution memory, latency, color, and cross-browser behavior still require Slice 4 integration and real-device measurement.

### Face suggestions

Candidates for a post-v1 benchmark:

- MediaPipe Face Detector
- OpenCV YuNet through ONNX Runtime Web

The benchmark must include crowds, masks, profile faces, small faces, varied skin tones, low light, motion blur, model licensing, bundle size, and mid-range mobile performance. No detector is trusted to establish complete coverage.

## Product differentiation

Privacy Canvas should compete on verifiable trust:

1. Opaque redaction is the only privacy-safe visual operation.
2. Automatic results remain visibly unconfirmed.
3. Full-resolution export is independent of preview resolution.
4. Sanitization never depends on successfully parsing every source metadata format.
5. Final bytes are independently inspected before release.
6. The application is small enough for practical manual review.
