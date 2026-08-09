# Browser privacy evidence

Status: automated Slice 6 evidence complete; real-device release gate blocked

Last updated: 2026-08-09

## Automated evidence

`pnpm run test:e2e` builds on the production bundle produced by `pnpm run check` and exercises:

- Chromium: Network Lock before intake; rejection of direct fetch, subresource, dedicated-worker fetch, XMLHttpRequest, beacon, and WebSocket paths; fail-closed service-worker restart; explicit waiting-update activation; all-client reload; obsolete-cache removal; exact asset-only cache inventory; full offline JPEG → rectangle → verified PNG workflow; CSP/Trusted Types; pointer and keyboard editing; object-URL cleanup; reset; and no user-media persistence or post-selection HTTP(S) egress.
- Playwright WebKit: one narrow JPEG → rectangle → verified PNG → reset path, including Network Lock state and local/session/IndexedDB/asset-cache inventory.

The Playwright WebKit result is compatibility evidence for the automated engine. It is not a Safari, iOS, or supported-browser claim.

## Real-device matrix

| Target release baseline                                       | Result                                                                                           | Evidence | Release status |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------- | -------------- |
| Current iOS Safari on a defined physical iPhone/iPad          | Not run — no target device is available in the current engineering environment                   | None     | Blocked        |
| Current Android Chrome on a defined mid-range physical device | Not run — no target device or ADB connection is available in the current engineering environment | None     | Blocked        |

No device support, memory ceiling, or supported megapixel limit may be published from the desktop automation results. Issue #2's real-device exit gate remains open until both rows contain device model, OS/browser version, repeated measurements, failures, and reviewer/date.

## Provisional guardrails, not support claims

| Guardrail                                       | Current value         | Evidence status                                                                |
| ----------------------------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| Input bytes                                     | 20 MiB                | Engineering bound only; not calibrated on target devices                       |
| Encoded width/height                            | 8,192 pixels per axis | Engineering bound only; not calibrated on target devices                       |
| Normalized pixels                               | 24 megapixels         | Engineering bound only; not calibrated on target devices                       |
| Worker readiness/intake/render/export operation | 20 seconds each       | Fail-closed deadline only; no real-device percentile or safety margin measured |

These values are intentionally described as provisional in code and are not a product capacity promise.

## Required manual measurement protocol

For each physical baseline:

1. Record device model, RAM, OS build, browser version, battery/thermal state, and whether the run is installed/offline or online.
2. Use licensed or generated static JPEGs with representative high-entropy pixels at 4, 8, 12, 16, and 24 megapixels, keeping bytes and each axis within the provisional preflight limits. Record fixture SHA-256, bytes, dimensions, and EXIF orientation.
3. From a cold browser start, perform intake, one rectangle edit, preview replacement, verified PNG export, download, and reset. Repeat at least three times online and three times after installing and reopening offline.
4. Record per-operation wall time, peak browser/tab memory using the platform's device tooling, output bytes, verification result, browser/OS termination or tab reload, visible responsiveness, and cleanup/storage inventory.
5. Repeat the largest successful case after an edit/export cycle to expose retained-buffer growth. Treat crashes, OS tab eviction, deadline failures, verification failures, or user-media storage as failures rather than reducing test coverage silently.
6. Choose published byte/pixel limits below the largest repeatably safe result with explicit memory headroom on both baselines. Calibrate the operation deadline from observed distributions plus reviewed safety margin while retaining a bounded denial-of-service control.
7. Attach raw observations and reviewer sign-off here or in a linked, versioned evidence artifact. Update `src/intake/source-media.ts`, `src/workers/media-worker-client.ts`, the format policy, threat model, README, and privacy policy together if guardrails change.
