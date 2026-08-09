# Verified PNG golden

`verified-redaction.png` is a committed Privacy Export generated through the production browser interface from the synthetic `../jpeg/control-valid.jpg` fixture. The default confirmed rectangle covers normalized `[0.25, 0.75) × [0.25, 0.75)` with opaque black at the source's canonical 64 × 48 dimensions.

Generate it from a production build with:

```bash
node scripts/generate-png-golden.mjs
```

Generation selects the synthetic JPEG through the browser UI, creates the default rectangle, requests worker-owned rendering/encoding/verification, and saves the verification-gated download. `manifest.json` pins the source and output SHA-256 digests and expected strict PNG facts. Compression output is platform-provided, so regeneration is an explicit reviewed fixture update rather than a routine test step.

Verify the committed artifact with independent command-line tools using:

```bash
node scripts/verify-png-golden.mjs
```

The verification script requires ExifTool and `c2patool`. It checks the pinned digest, the minimal RGB PNG structure, the absence of EXIF/XMP/IPTC/ICC/extra PNG metadata reported by ExifTool, and the absence of a C2PA claim reported by `c2patool`.

All source pixels are synthetic and generated for this repository. This artifact is test evidence for the narrow PNG profile; it is not a claim of anonymity or broad device compatibility.
