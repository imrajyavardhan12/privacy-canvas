# ADR-0001: Browser/PWA first

- Status: Accepted
- Date: 2026-08-05

## Context

Target users need an accessible tool on desktop and mobile without creating an account or installing through an application store. A backend would introduce an unnecessary media-exfiltration path. Native shells would expand the release and audit surface before the privacy core is proven.

## Decision

Build v1 as a static TypeScript browser application and offline-capable PWA. Production has no backend, authentication, analytics, or media upload path. Publish a downloadable, checksummed offline artifact alongside the hosted release. Native wrappers may be considered after v1 based on measured browser limitations.

## Consequences

- Browser and OS limitations must be documented honestly.
- A static host with custom security headers is required.
- First load requires HTTPS connectivity; installed assets can later run offline.
- Secure memory erasure and protection from extensions/OS compromise cannot be guaranteed.
- Native-only capabilities use progressive platform adapters or remain unavailable.
