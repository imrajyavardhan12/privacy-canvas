# Security Policy

## Project status

Privacy Canvas is in foundation development. No release is currently approved for safety-critical image processing.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose Source Media, preserve redacted pixels or metadata, bypass export verification, compromise release integrity, or cause code execution.

Use [GitHub private vulnerability reporting](https://github.com/imrajyavardhan12/privacy-canvas/security/advisories/new). Do not include sensitive media in the report; use synthetic fixtures. Coordinate before attaching a weaponized proof of concept.

A dedicated security email must be published before public alpha.

## What to include

- A concise description and affected revision.
- The privacy or security invariant that fails.
- Reproduction steps using synthetic, non-sensitive fixtures.
- Browser, operating system, and device details.
- Expected and actual result.
- Whether network access, persistence, or a crafted image is required.
- Suggested mitigation, if known.

## Response targets

These targets begin when a public alpha is announced:

- Acknowledge critical/high reports within 3 business days.
- Provide an initial assessment within 7 business days.
- Coordinate disclosure based on user risk and patch availability.

## Supported versions

No version is currently supported. The policy will list maintained release lines before public alpha.

## Security-sensitive areas

The highest-review areas are file intake, metadata rendering, worker messages, coordinate transforms, full-resolution rendering, encoders, output verification, browser persistence, service-worker updates, dependencies, and release workflows. See the [threat model](docs/privacy-canvas-threat-model.md).

## Safe research

Use synthetic images and local builds. Do not test with images of people who have not consented, attack production users, exfiltrate media, degrade third-party systems, or publish a bypass before maintainers have had a reasonable opportunity to respond.
