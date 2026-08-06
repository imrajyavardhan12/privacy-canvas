# Contributing

Privacy Canvas welcomes careful contributions. Privacy guarantees take precedence over feature velocity.

## Before proposing code

1. Read `CONTEXT.md`, the architecture document, threat model, and relevant ADRs.
2. Open an issue for changes to privacy semantics, persistence, formats, dependencies, networking, workers, encoding, verification, or deployment.
3. Do not add remote assets, analytics, runtime third-party requests, media persistence, blur-as-redaction, or automatic confirmation.
4. Use only synthetic or properly licensed test media.

## Development

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run check
pnpm exec playwright install chromium
pnpm run test:e2e
```

The committed `pnpm-workspace.yaml` is supply-chain policy, not a convenience configuration. Do not bypass its release-age, peer, engine, exotic-source, or dependency-build checks. A dependency that requires an install script must receive explicit review and an exact `allowBuilds` decision; never enable all dependency builds.

## Tests

Tests should cross the same module interface used by callers and verify observable behaviour. Privacy-critical changes require negative tests proving unsafe output is rejected. Do not test private helper structure solely to increase coverage.

A contribution affecting input or output formats should add fixtures, document fixture provenance, and include independent output-tool verification where applicable.

## Pull requests

- Keep changes focused and explain the user risk being addressed.
- Link the relevant issue and ADR.
- State which privacy invariants are affected.
- Include tests and documentation.
- Identify new dependencies, licenses, WASM, models, workers, network access, or storage use.
- Do not weaken a failing check to make CI green.

## Architecture language

Use the project terms in `CONTEXT.md`. For architecture, prefer module, interface, implementation, seam, adapter, locality, and leverage. Avoid adding pass-through modules that merely move complexity.

## Commit and release hygiene

Never commit secrets or sensitive media. Dependencies use exact versions and lockfile review. Workflow actions are pinned by commit SHA. Public releases require security review and generated provenance/SBOM checks.
