# Privacy Canvas v1 Product Requirements

Status: accepted for foundation work  
Tracking issue: [#1](https://github.com/imrajyavardhan12/privacy-canvas/issues/1)  
Date: 2026-08-05

## Problem Statement

People who document protests, investigations, workplaces, communities, or personal events often need to share an image without disclosing the identity or location of people in it. Existing workflows are fragmented: visual editors may preserve metadata, metadata cleaners may not cover visual identifiers, blur may preserve recoverable information, automatic face detection may miss people, and browser tools often make privacy claims without checking their final output.

Users need a workflow that remains local, makes the safe operation obvious, preserves useful image quality, and provides evidence that the file being shared is a freshly sanitized derivative. The product must reduce disclosure risk without claiming to guarantee anonymity.

## Solution

Privacy Canvas will provide an open-source, browser-first image privacy workflow with no account or backend. A user selects local Source Media, reviews a plain-language Metadata Risk Summary, applies explicit opaque Confirmed Redactions, performs basic transforms, and requests a Privacy Export. The export is rendered at canonical resolution, encoded into a fresh container without copying source segments, and independently verified before download or sharing.

The initial release prioritizes trustworthy manual redaction. Automatic face, text, and license-plate detection will follow only after the manual export path has passed security and real-device review.

## User Stories

1. As an at-risk publisher, I want to open a local JPEG, PNG, or WebP image without uploading it, so that a server never receives my Source Media.
2. As an at-risk publisher, I want the product to reject files whose content does not match their claimed type, so that misleading extensions cannot bypass intake rules.
3. As an at-risk publisher, I want clear size and format errors before expensive decoding, so that a malicious or accidental file cannot silently freeze my device.
4. As an at-risk publisher, I want EXIF orientation applied consistently, so that the image is not rotated or mirrored unexpectedly.
5. As an at-risk publisher, I want the original pixel dimensions shown, so that I understand the quality of the source and export.
6. As an at-risk publisher, I want a categorized metadata risk summary, so that I can understand whether the file contains location, device, timestamp, identity, thumbnail, editing-history, provenance, other embedded text, or unclassified metadata structures.
7. As an at-risk publisher, I want metadata values displayed only as inert text, so that a malicious filename or metadata field cannot execute code.
8. As an at-risk publisher, I want metadata inspection failure to be visible but not cause metadata to be copied into output, so that sanitization remains safe.
9. As an at-risk publisher, I want opaque rectangle redaction, so that I can permanently cover faces, names, screens, and identifiers.
10. As an at-risk publisher, I want opaque ellipse redaction, so that I can cover compact visual regions efficiently.
11. As an at-risk publisher, I want an opaque brush, so that I can cover irregular regions on touch and pointer devices.
12. As an at-risk publisher, I want polygon redaction, so that I can cover angled signs, documents, and reflections precisely.
13. As an at-risk publisher, I want confirmed redactions to have no transparency control, so that I cannot accidentally create a partially visible privacy mask.
14. As an at-risk publisher, I want a configurable safety margin around selected regions, so that mask edges do not leave identifying details exposed.
15. As an at-risk publisher, I want to move, resize, and delete redactions before export, so that I can correct mistakes.
16. As an at-risk publisher, I want conventional undo and redo, so that experimentation does not require restarting.
17. As an at-risk publisher, I want zoom and pan that never change export dimensions, so that I can review details without degrading output.
18. As an at-risk publisher, I want a 100% pixel review mode, so that I can inspect small identifying regions before sharing.
19. As an at-risk publisher, I want crop, rotate, flip, and resize transforms, so that I can remove unnecessary context and prepare an appropriately sized image.
20. As an at-risk publisher, I want transforms and redactions to stay correctly aligned regardless of editing order, so that covered information cannot reappear.
21. As an at-risk publisher, I want the export to preserve source resolution by default within explicit device limits, so that preview sizing does not reduce quality.
22. As an at-risk publisher, I want PNG, JPEG, and WebP output choices, so that I can balance compatibility, size, and quality.
23. As an at-risk publisher, I want a safe filename that does not copy the original path or unsafe characters, so that export does not disclose or execute unintended information.
24. As an at-risk publisher, I want final output dimensions and estimated size shown before saving, so that I can make an informed export choice.
25. As an at-risk publisher, I want Source Media container segments excluded from output, so that unknown metadata does not survive by accident.
26. As an at-risk publisher, I want the output checked for EXIF, GPS, XMP, IPTC, thumbnails, comments, source profiles, and C2PA data, so that sanitization is verified rather than assumed.
27. As an at-risk publisher, I want confirmed masks checked after final encoding, so that an encoder or coordinate error cannot expose covered pixels.
28. As an at-risk publisher, I want save and share disabled when verification fails or is inconclusive, so that the application fails closed.
29. As an at-risk publisher, I want a plain-language Verification Report, so that I know what was checked and what the product cannot guarantee.
30. As an at-risk publisher, I want to download a verified file using standard browser functionality, so that the workflow works broadly.
31. As a mobile publisher, I want to invoke the operating-system share sheet when supported, so that I can send the verified file without first locating it in downloads.
32. As a mobile publisher, I want reliable pointer capture and large touch targets, so that drawing remains coherent when my finger leaves the image.
33. As a keyboard user, I want all editing and export actions reachable without a pointer, so that the workflow is accessible.
34. As a screen-reader user, I want meaningful labels, status announcements, and focus management, so that I can understand each stage.
35. As a user with motion sensitivity, I want reduced-motion preferences respected, so that the editor does not cause discomfort.
36. As a user on a slow or disconnected network, I want an installed release to start offline, so that image processing does not depend on connectivity.
37. As an at-risk publisher, I want required assets ready before Source Media selection is enabled, so that the editor never downloads models or code after seeing my image.
38. As an at-risk publisher, I want a visible Network Lock state, so that I understand when runtime requests are being rejected.
39. As an at-risk publisher, I want user media excluded from browser application storage, so that reopening the application does not reveal previous work.
40. As an at-risk publisher, I want a clear session-reset action, so that references, previews, and worker state are released promptly.
41. As an at-risk publisher, I want cleanup described honestly as best effort, so that I do not mistake JavaScript memory handling for secure erasure.
42. As a journalist, I want a warning when Content Credentials or rights metadata will be removed, so that I can preserve the original separately when provenance matters.
43. As a copyright holder, I want to understand that I must be authorized to remove embedded rights metadata, so that the product does not conceal legal consequences.
44. As a reviewer, I want a final checklist covering faces, tattoos, clothing, reflections, screens, signs, documents, and surroundings, so that I do not focus only on faces.
45. As a reviewer, I want the product to state that it cannot guarantee anonymity, so that I retain responsibility for contextual review.
46. As a contributor, I want privacy invariants and architectural decisions documented, so that future changes do not weaken the product silently.
47. As a security reviewer, I want deterministic fixtures containing hostile metadata and malformed files, so that input handling can be evaluated repeatedly.
48. As a security reviewer, I want output checked with independent command-line tooling in CI, so that browser logic does not validate itself.
49. As a maintainer, I want exact dependencies, an SBOM, and reviewable release artifacts, so that supply-chain changes are visible.
50. As a maintainer, I want privacy-critical changes to require tests and review, so that guarantees do not regress under feature pressure.

## Implementation Decisions

- The product will be a static browser/PWA application with no authentication, account, backend, or remote media processing.
- TypeScript is used throughout. React is limited to the UI module; privacy-critical modules remain framework-independent.
- Source bytes and full-resolution pixels are owned by a dedicated media worker after intake.
- Intake validates magic bytes, supported container structure, resource budgets, and frame count before full processing.
- SVG, RAW, and animated formats are rejected by v1.
- Source metadata is treated as untrusted and rendered only as text.
- Working Document geometry uses canonical document coordinates independent of viewport pixels.
- Confirmed Redactions are opaque by construction and cannot carry alpha below one.
- Blur and pixelation are Obfuscation and are excluded from v1.
- Preview and export share document semantics but use distinct rendering paths; preview output is never exportable.
- Privacy Export uses a fresh encoder and never copies Source Media container segments.
- Output verification is independent of metadata inspection and uses a strict format-specific allowlist.
- Save and share require a successful Verification Report and direct user activation.
- File download and native sharing are separate platform adapters.
- Application storage may cache code and static assets only; it does not persist user media or Working Documents.
- Production runtime sources are same-origin, bundled, and protected by restrictive response headers.
- A future detector may return Suggested Regions only and cannot directly modify the Working Document.
- The first release is hosted publicly and also distributed as a downloadable, checksummed offline artifact.
- Apache-2.0 is the project license.

## Testing Decisions

Good tests exercise module interfaces and observable privacy behaviour rather than private helper structure.

- Intake tests cover supported formats, magic-byte mismatches, malformed containers, orientation values, animation, dimension limits, pixel budgets, and hostile metadata.
- Working Document tests cover transform/redaction alignment, normalized geometry, opacity invariants, operation ordering, undo, and redo.
- Renderer tests compare deterministic output pixels against golden fixtures at preview and canonical resolutions.
- Sanitizer tests prove source segments are not copied and every supported encoder produces a valid file.
- Verifier tests include positive fixtures and intentionally contaminated outputs for every forbidden metadata class.
- Browser tests cover file selection, pointer capture, keyboard editing, export gating, save/share activation, session reset, offline startup, and zero unexpected runtime requests.
- Accessibility tests combine automated checks with keyboard and screen-reader review.
- CI validates output using independent tools such as ExifTool and C2PA tooling rather than only the runtime parser.
- Real-device testing covers current iOS Safari and Android Chrome on a defined mid-range device baseline.
- Resource tests establish supported megapixel and memory limits empirically before those limits are promised.
- Dependency and workflow scanning cover the build and release supply chain.

Prior art comes from Image Scrubber's historic issue set, Freedom of the Press Foundation guidance, browser specification fixtures, ExifTool sample files, C2PA conformance assets, and image-codec upstream test corpora.

## Out of Scope

- Guaranteeing anonymity or complete removal of contextual identifiers.
- Blur, pixelation, translucent markers, or claims of reversible-effect safety.
- Automatic face, text, object, or license-plate suggestions in v1.
- Face recognition, identity matching, or biometric embeddings.
- Video, audio, documents, live camera, or microphone processing.
- Accounts, cloud sync, collaboration, analytics, telemetry, and remote crash reporting.
- Persistent project files or automatic recovery of user media.
- SVG, RAW, animated image editing, or arbitrary remote URLs.
- Native mobile and desktop wrappers for v1.
- Preserving or generating C2PA Content Credentials.
- Protecting against a compromised browser, operating system, extension, firmware, or destination platform.
- Guaranteed secure deletion from browser, GPU, swap, filesystem, or operating-system memory.

## Further Notes

Privacy and provenance have competing goals. Privacy Export removes metadata and provenance by default; users who require evidentiary chain of custody should retain Source Media separately and use purpose-built tools such as ProofMode.

The first implementation slice must remain narrow: local JPEG intake, risk summary, one opaque rectangle, full-resolution PNG export, and independent verification. No feature expansion should precede proof of that end-to-end path.
