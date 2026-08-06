import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MEDIA_WORKER_PROTOCOL_VERSION,
  readMediaWorkerRequest,
  readMediaWorkerResponse,
} from './media-worker-protocol'

describe('media worker protocol', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('runtime-validates a canonical render request at the worker boundary', () => {
    expect(
      readMediaWorkerRequest({
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: 2,
        type: 'render-document',
        sourceId: 1,
        document: {
          dimensions: { width: 4, height: 2 },
          redactions: [
            {
              id: 'redaction-1',
              kind: 'rectangle',
              status: 'confirmed',
              x: 0.25,
              y: 0,
              width: 0.5,
              height: 1,
              color: '#000000',
              opacity: 1,
            },
          ],
        },
      }),
    ).toEqual({
      protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
      requestId: 2,
      type: 'render-document',
      sourceId: 1,
      renderPlan: {
        dimensions: { width: 4, height: 2 },
        redactions: [
          {
            id: 'redaction-1',
            x: 1,
            y: 0,
            width: 2,
            height: 2,
            color: '#000000',
          },
        ],
      },
    })
  })

  it('rejects hidden pixel data attached to render-request arrays', () => {
    const redactions = Object.assign([], { rgba: new Uint8Array(32) })

    expect(
      readMediaWorkerRequest({
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: 2,
        type: 'render-document',
        sourceId: 1,
        document: {
          dimensions: { width: 4, height: 2 },
          redactions,
        },
      }),
    ).toBeUndefined()
  })

  it('accepts a bounded rendered preview without exposing canonical pixels', () => {
    class FakeImageBitmap {
      readonly width = 512
      readonly height = 256
    }
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)
    const preview = new FakeImageBitmap()
    const response = {
      protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
      requestId: 2,
      type: 'render-ready',
      sourceId: 1,
      canonicalDimensions: { width: 1_024, height: 512 },
      previewDimensions: { width: 512, height: 256 },
      preview,
    }

    expect(readMediaWorkerResponse(response)).toBe(response)
    expect(response).not.toHaveProperty('rgba')
  })

  it('rejects a source response that attempts to expose extra pixel data', () => {
    class FakeImageBitmap {
      readonly width = 4
      readonly height = 2
    }
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)

    expect(
      readMediaWorkerResponse({
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: 1,
        type: 'source-ready',
        sourceId: 1,
        inspection: {
          format: 'jpeg',
          encodedDimensions: { width: 4, height: 2 },
          normalizedDimensions: { width: 4, height: 2 },
          orientation: 1,
          metadataRiskSummary: { status: 'inspected', groups: [] },
        },
        previewDimensions: { width: 4, height: 2 },
        preview: new FakeImageBitmap(),
        rgba: new Uint8Array(32),
      }),
    ).toBeUndefined()
  })

  it('rejects hidden pixel data nested inside an inspection response', () => {
    class FakeImageBitmap {
      readonly width = 4
      readonly height = 2
    }
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)

    expect(
      readMediaWorkerResponse({
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: 1,
        type: 'source-ready',
        sourceId: 1,
        inspection: {
          format: 'jpeg',
          encodedDimensions: { width: 4, height: 2 },
          normalizedDimensions: { width: 4, height: 2 },
          orientation: 1,
          metadataRiskSummary: { status: 'inspected', groups: [] },
          rgba: new Uint8Array(32),
        },
        previewDimensions: { width: 4, height: 2 },
        preview: new FakeImageBitmap(),
      }),
    ).toBeUndefined()
  })

  it('rejects hidden pixel data attached to metadata arrays', () => {
    class FakeImageBitmap {
      readonly width = 4
      readonly height = 2
    }
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)
    const groups = Object.assign([], { rgba: new Uint8Array(32) })

    expect(
      readMediaWorkerResponse({
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: 1,
        type: 'source-ready',
        sourceId: 1,
        inspection: {
          format: 'jpeg',
          encodedDimensions: { width: 4, height: 2 },
          normalizedDimensions: { width: 4, height: 2 },
          orientation: 1,
          metadataRiskSummary: { status: 'inspected', groups },
        },
        previewDimensions: { width: 4, height: 2 },
        preview: new FakeImageBitmap(),
      }),
    ).toBeUndefined()
  })

  it('rejects hidden pixel data attached to metadata finding arrays', () => {
    class FakeImageBitmap {
      readonly width = 4
      readonly height = 2
    }
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)
    const findings = Object.assign([], { rgba: new Uint8Array(32) })

    expect(
      readMediaWorkerResponse({
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: 1,
        type: 'source-ready',
        sourceId: 1,
        inspection: {
          format: 'jpeg',
          encodedDimensions: { width: 4, height: 2 },
          normalizedDimensions: { width: 4, height: 2 },
          orientation: 1,
          metadataRiskSummary: {
            status: 'inspected',
            groups: [{ category: 'location', findings }],
          },
        },
        previewDimensions: { width: 4, height: 2 },
        preview: new FakeImageBitmap(),
      }),
    ).toBeUndefined()
  })

  it('rejects preview dimensions that do not match canonical source scaling', () => {
    class FakeImageBitmap {
      readonly width = 1
      readonly height = 1
    }
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)

    expect(
      readMediaWorkerResponse({
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: 1,
        type: 'source-ready',
        sourceId: 1,
        inspection: {
          format: 'jpeg',
          encodedDimensions: { width: 64, height: 48 },
          normalizedDimensions: { width: 64, height: 48 },
          orientation: 1,
          metadataRiskSummary: { status: 'inspected', groups: [] },
        },
        previewDimensions: { width: 1, height: 1 },
        preview: new FakeImageBitmap(),
      }),
    ).toBeUndefined()
  })

  it('rejects source dimensions outside canonical rendering limits', () => {
    class FakeImageBitmap {
      readonly width = 1
      readonly height = 1
    }
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)

    expect(
      readMediaWorkerResponse({
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: 1,
        type: 'source-ready',
        sourceId: 1,
        inspection: {
          format: 'jpeg',
          encodedDimensions: { width: 8_193, height: 1 },
          normalizedDimensions: { width: 8_193, height: 1 },
          orientation: 1,
          metadataRiskSummary: { status: 'inspected', groups: [] },
        },
        previewDimensions: { width: 1, height: 1 },
        preview: new FakeImageBitmap(),
      }),
    ).toBeUndefined()
  })

  it('rejects malformed messages at both sides of the worker boundary', () => {
    expect(
      readMediaWorkerRequest({
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: 1,
        type: 'open-source',
        sourceBytes: 'not transferable bytes',
      }),
    ).toBeUndefined()

    expect(
      readMediaWorkerResponse({
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: 1,
        type: 'source-ready',
        inspection: {},
      }),
    ).toBeUndefined()
  })
})
