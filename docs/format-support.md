# Format Support Policy

Status: proposed for v1

| Format             | v1 input | v1 output | Policy                                                                                                                            |
| ------------------ | -------: | --------: | --------------------------------------------------------------------------------------------------------------------------------- |
| JPEG               |      Yes |       Yes | Single image only; normalize orientation; fresh encode; reject unexpected trailing/embedded structures according to intake policy |
| PNG                |      Yes |       Yes | Static PNG only; reject APNG; strip textual and ancillary metadata except an explicit technical allowlist                         |
| WebP               |      Yes |       Yes | Static WebP only; reject animation; exclude EXIF and XMP chunks                                                                   |
| AVIF               | Research |        No | Add only after cross-browser decode, frame, metadata, and resource tests pass                                                     |
| HEIC/HEIF          | Research |        No | Important mobile input, but browser and licensing behaviour require a dedicated decoder spike                                     |
| GIF                |       No |        No | Animated/multi-frame semantics are undefined for v1                                                                               |
| APNG               |       No |        No | Multi-frame input is rejected rather than silently processing one frame                                                           |
| Animated WebP      |       No |        No | Multi-frame input is rejected rather than silently processing one frame                                                           |
| SVG                |       No |        No | Active content, external references, and vector semantics are outside v1                                                          |
| RAW camera formats |       No |        No | Decoder, resource, color, and metadata surface is too broad for v1                                                                |

## Input rules

- Inspect magic bytes and container structure; never trust extension or MIME type alone.
- Determine declared dimensions and frame count before expensive decode where the format permits.
- Reject unsupported frames, excessive dimensions, excessive pixel count, and excessive input bytes with a clear error.
- Treat metadata and profiles as untrusted input.
- Never fetch external references.

## Output rules

- Render into a fresh pixel buffer.
- Do not copy source segments or metadata.
- Convert to the documented output color policy.
- Apply a strict per-format structural allowlist.
- Verify final dimensions, frame count, metadata, and Confirmed Redaction coverage.
- Fail closed on unknown or inconclusive structures.

Provisional resource limits must not be published as supported limits until measured on the defined mid-range Android and iOS device baselines.
