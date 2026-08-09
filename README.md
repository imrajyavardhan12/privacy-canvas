# Privacy Canvas

Privacy Canvas is a local-first image privacy workbench for irreversible visual redaction and verifiable metadata sanitization.

> [!WARNING]
> Privacy Canvas is in its tracer-bullet phase. The current build accepts one local JPEG, supports one editable opaque rectangle, and gates full-resolution PNG download on fresh encoding and independent final-output verification. Device budgets, cross-browser evidence, transforms, and broader v1 format support remain incomplete. Do not rely on it for safety-critical work until a reviewed release is published.

## Product promise

Privacy Canvas is being designed to:

- process source media locally, without accounts or uploads;
- make opaque redaction the privacy-safe default;
- treat automatic detection as untrusted suggestions;
- render exports from a canonical source rather than the display preview;
- freshly encode output without copying source metadata; and
- verify the final output before allowing it to be saved or shared.

Privacy Canvas reduces disclosure risk; it cannot guarantee anonymity. Clothing, tattoos, reflections, surroundings, browser extensions, the operating system, and the destination platform may still reveal information.

## Status

The current tracer bullet is:

> Open a JPEG containing sensitive metadata, inspect a risk summary, add one opaque rectangle, export a full-resolution PNG, and independently verify the output.

Implemented so far: hostile synthetic fixtures, fail-closed JPEG preflight, bounded metadata risk classification, worker-owned JPEG decoding, EXIF orientation normalization, reduced redacted previews, typed stage failures, best-effort session reset, one canonical opaque rectangle with pointer/keyboard editing and undo/redo, worker-owned full-resolution rendering, fresh strict PNG encoding, independently derived final-mask verification, verification-gated browser download, and committed ExifTool/C2PA golden inspection. Image transforms, PNG/WebP intake, JPEG/WebP output, native sharing, measured device budgets, broad cross-browser evidence, and release review remain incomplete.

See:

- [Product requirements](docs/product-requirements.md)
- [Architecture](docs/architecture.md)
- [Threat model](docs/privacy-canvas-threat-model.md)
- [Tracer-bullet plan](docs/tracer-bullet.md)
- [Privacy policy](PRIVACY.md)
- [Security policy](SECURITY.md)

## Development

Requirements:

- Node.js 24 or newer
- Corepack, included with supported Node.js releases

The repository pins its pnpm version. Enable Corepack once, then install exact dependencies:

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run dev
```

Run all local checks:

```bash
pnpm run check
```

Run browser tests after installing Chromium once:

```bash
pnpm exec playwright install chromium
pnpm run test:e2e
```

## Architecture principles

- A small number of deep modules own privacy-critical invariants.
- The UI does not own source media bytes or export rendering.
- Preview coordinates never determine export resolution.
- Source metadata is inspected as untrusted data and never copied into output.
- Privacy Export fails closed when verification fails.
- User media is not persisted by the application.

## Inspiration and attribution

Privacy Canvas is a clean implementation inspired in part by Everest Pipkin's [Image Scrubber](https://github.com/everestpipkin/image-scrubber) and by digital-safety guidance from the Freedom of the Press Foundation. No Image Scrubber source code is included.

## License

Apache License 2.0. See [LICENSE](LICENSE).
