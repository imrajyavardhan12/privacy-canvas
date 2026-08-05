# Synthetic hostile JPEG corpus

These files are deterministic test inputs for tracer-bullet issue #2. They contain no user media and were generated specifically for Privacy Canvas. The fixture pixels, metadata identities, addresses, dates, and coordinates are synthetic. All files are provided under the repository's Apache-2.0 license.

Hostile-looking values such as `<script>` and `<img onerror>` are inert strings. They exist to prove that filenames and metadata are treated as untrusted text; they must never be inserted into an HTML sink.

## Reproduce

The committed corpus was produced on macOS with the tool versions recorded in `manifest.json`. Regeneration requires Python 3.10 or newer plus:

- libjpeg-turbo `cjpeg` for the 64×48 asymmetric source pixels;
- ExifTool for EXIF orientations and the metadata-risk fixture; and
- `c2patool` for a standards-conformant JUMBF/C2PA manifest.

Install those command-line tools, then run the single authoritative generation command from the repository root:

```bash
python3 scripts/generate-jpeg-fixtures.py
npm run fixtures:verify
```

The generator creates its PPM source in a temporary directory, invokes this JPEG encoding recipe, injects every metadata value using explicit ExifTool arguments, creates the C2PA fixture with `--create digitalCapture`, constructs malformed files from the valid control, and rewrites `manifest.json` with SHA-256 digests:

```text
cjpeg -baseline -optimize -quality 95 -sample 1x1 \
  -outfile control-valid.jpg orientation-pattern.ppm
```

The exact ExifTool and c2patool argument lists are intentionally kept in `scripts/generate-jpeg-fixtures.py` so shell quoting cannot change hostile values. `c2patool` uses its built-in development certificate. The credential is valid for structural tests but intentionally untrusted; no private signing key is stored in this repository.

`invalid-animated.gif.jpg` is a fixed 91-byte, two-frame GIF generated from red and blue 2×1 frames. Its original ImageMagick recipe is recorded next to the bytes in the generator. The PNG masquerade and all malformed JPEGs are constructed directly with Python standard-library code.

Regeneration may change JPEG bytes when tool versions change. The C2PA fixture changes on every regeneration because its assertions and ECDSA signature use fresh cryptographic randomness even when the source and tool version are unchanged. Such changes require review of both the binary diff and the updated hashes. Tests remain deterministic by consuming the committed, digest-pinned files; fixture-generation tools are not runtime or npm dependencies.

## Inventory

| Fixture                                   | Intake expectation           | Purpose                                                                                                                            |
| ----------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `control-valid.jpg`                       | Accept                       | Metadata-free asymmetric JPEG control, 64×48                                                                                       |
| `orientation-1.jpg` … `orientation-8.jpg` | Accept                       | Same asymmetric pixels with each EXIF orientation value and normalized dimension/corner expectations                               |
| `metadata-rich.jpg`                       | Accept and report risks      | GPS, camera identity, timestamps, creator/contact, thumbnail, editing history, EXIF, XMP, IPTC, and hostile metadata/filename text |
| `metadata-c2pa.jpg`                       | Accept and report provenance | Metadata-rich control plus a locally signed C2PA manifest in JPEG APP11/JUMBF                                                      |
| `invalid-not-jpeg.jpg`                    | Reject                       | Valid PNG renamed to `.jpg`                                                                                                        |
| `invalid-animated.gif.jpg`                | Reject                       | Valid two-frame GIF renamed to `.jpg`                                                                                              |
| `invalid-truncated.jpg`                   | Reject                       | Entropy data and EOI removed after the JPEG SOS header                                                                             |
| `invalid-zero-dimension.jpg`              | Reject                       | SOF declares zero width                                                                                                            |
| `invalid-oversized-dimensions.jpg`        | Reject before decode         | SOF declares 65,535×65,535 pixels while the file remains tiny                                                                      |
| `invalid-trailing-data.jpg`               | Reject                       | Undeclared hostile bytes follow JPEG EOI                                                                                           |

`manifest.json` is the machine-readable inventory. It records expected magic-byte type, disposition, encoded and orientation-normalized dimensions, displayed corner order, metadata risk classes, rejection reason, provenance, synthetic file-selection name, and SHA-256 digest. Intake tests should construct the metadata-rich `File` with its `sourceName`; the hostile name is data, not the on-disk fixture path.

## Independent inspection

The repository verifier checks corpus completeness, hashes, magic bytes, JPEG dimensions, EXIF orientation values and expected normalized geometry, metadata container signatures, embedded thumbnail presence, hostile payload sentinels, and JUMBF APP11 data without relying on the future Intake module:

```bash
npm run fixtures:verify
```

For manual independent inspection:

```bash
exiftool -G1 -a -s tests/fixtures/jpeg/metadata-rich.jpg
exiftool -G1 -a -s tests/fixtures/jpeg/metadata-c2pa.jpg
c2patool tests/fixtures/jpeg/metadata-c2pa.jpg --info
```

`c2patool --info` should report one manifest and `signingCredential.untrusted`, because the fixture deliberately uses a development certificate rather than a production trust-list identity.
