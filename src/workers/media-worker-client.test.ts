import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MediaWorkerClient,
  MediaWorkerOperationError,
} from './media-worker-client'
import { PROVISIONAL_SOURCE_MEDIA_LIMITS } from '../intake/source-media'
import { MEDIA_WORKER_PROTOCOL_VERSION } from './media-worker-protocol'

class FakeImageBitmap {
  readonly width: number
  readonly height: number
  closed = false

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  close(): void {
    this.closed = true
  }
}

class SilentWorker extends EventTarget {
  terminated = false
  readonly messages: unknown[] = []

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.messages.push(structuredClone(message, { transfer }))
  }

  terminate(): void {
    this.terminated = true
  }

  signalReady(): void {
    this.signal({
      protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
      type: 'ready',
    })
  }

  signal(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

describe('MediaWorkerClient', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rejects an oversized File before reading its bytes', async () => {
    const worker = new SilentWorker()
    const client = new MediaWorkerClient({
      worker: worker as unknown as Worker,
    })
    worker.signalReady()
    await client.ready
    let readBytes = false

    await expect(
      client.openFile({
        name: 'oversized.jpg',
        size: PROVISIONAL_SOURCE_MEDIA_LIMITS.maxInputBytes + 1,
        arrayBuffer: async () => {
          readBytes = true
          return new ArrayBuffer(0)
        },
      }),
    ).rejects.toMatchObject({
      failure: {
        stage: 'resource-limit',
        code: 'input-bytes-exceeded',
      },
    })
    expect(readBytes).toBe(false)
    client.terminate()
  })

  it('transfers ownership of Source Media bytes to the worker', async () => {
    const worker = new SilentWorker()
    const client = new MediaWorkerClient({
      worker: worker as unknown as Worker,
    })
    worker.signalReady()
    await client.ready
    const sourceBytes = new ArrayBuffer(1)

    const operation = client
      .openFile({
        name: 'transfer.jpg',
        size: 1,
        arrayBuffer: async () => sourceBytes,
      })
      .catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sourceBytes.byteLength).toBe(0)
    client.terminate()
    await operation
  })

  it('requests a rendered preview without receiving canonical pixels', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)
    const worker = new SilentWorker()
    const client = new MediaWorkerClient({
      worker: worker as unknown as Worker,
    })
    worker.signalReady()
    await client.ready

    await openRenderableSource(client, worker)

    const rendering = client.renderWorkingDocument({
      dimensions: { width: 64, height: 48 },
      redactions: [],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(worker.messages.at(-1)).toMatchObject({
      type: 'render-document',
      sourceId: 7,
      document: {
        dimensions: { width: 64, height: 48 },
        redactions: [],
      },
    })
    worker.signal({
      protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
      requestId: 2,
      type: 'render-ready',
      sourceId: 7,
      canonicalDimensions: { width: 64, height: 48 },
      previewDimensions: { width: 64, height: 48 },
      preview: new FakeImageBitmap(64, 48),
    })

    const result = await rendering
    expect(result.canonicalDimensions).toEqual({ width: 64, height: 48 })
    expect(result).not.toHaveProperty('rgba')
    client.terminate()
  })

  it('terminates on rendered dimensions that differ from the Working Document', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)
    const worker = new SilentWorker()
    const client = new MediaWorkerClient({
      worker: worker as unknown as Worker,
    })
    worker.signalReady()
    await client.ready
    await openRenderableSource(client, worker)

    const rendering = client.renderWorkingDocument({
      dimensions: { width: 64, height: 48 },
      redactions: [],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const preview = new FakeImageBitmap(32, 24)
    worker.signal({
      protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
      requestId: 2,
      type: 'render-ready',
      sourceId: 7,
      canonicalDimensions: { width: 32, height: 24 },
      previewDimensions: { width: 32, height: 24 },
      preview,
    })

    await expect(rendering).rejects.toThrow('unexpected dimensions')
    expect(preview.closed).toBe(true)
    expect(worker.terminated).toBe(true)
  })

  it('closes pixels and terminates on a response for the wrong operation', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)
    const worker = new SilentWorker()
    const client = new MediaWorkerClient({
      worker: worker as unknown as Worker,
    })
    worker.signalReady()
    await client.ready
    await openRenderableSource(client, worker)

    const rendering = client.renderWorkingDocument({
      dimensions: { width: 64, height: 48 },
      redactions: [],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const unexpectedPreview = new FakeImageBitmap(64, 48)
    worker.signal({
      protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
      requestId: 2,
      type: 'source-ready',
      sourceId: 8,
      inspection: {
        format: 'jpeg',
        encodedDimensions: { width: 64, height: 48 },
        normalizedDimensions: { width: 64, height: 48 },
        orientation: 1,
        metadataRiskSummary: { status: 'inspected', groups: [] },
      },
      previewDimensions: { width: 64, height: 48 },
      preview: unexpectedPreview,
    })

    await expect(rendering).rejects.toThrow('unexpected response')
    expect(unexpectedPreview.closed).toBe(true)
    expect(worker.terminated).toBe(true)
  })

  it('closes a preview and terminates on an unknown response request', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)
    const worker = new SilentWorker()
    const client = new MediaWorkerClient({
      worker: worker as unknown as Worker,
    })
    worker.signalReady()
    await client.ready
    await openRenderableSource(client, worker)

    const rendering = client.renderWorkingDocument({
      dimensions: { width: 64, height: 48 },
      redactions: [],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const unexpectedPreview = new FakeImageBitmap(64, 48)
    try {
      worker.signal({
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: 999,
        type: 'render-ready',
        sourceId: 7,
        canonicalDimensions: { width: 64, height: 48 },
        previewDimensions: { width: 64, height: 48 },
        preview: unexpectedPreview,
      })

      expect(unexpectedPreview.closed).toBe(true)
      expect(worker.terminated).toBe(true)
      await expect(rendering).rejects.toThrow('unexpected response')
    } finally {
      client.terminate()
      await rendering.catch(() => undefined)
    }
  })

  it('closes a preview before terminating on a malformed response', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)
    const worker = new SilentWorker()
    const client = new MediaWorkerClient({
      worker: worker as unknown as Worker,
    })
    worker.signalReady()
    await client.ready
    await openRenderableSource(client, worker)

    const rendering = client.renderWorkingDocument({
      dimensions: { width: 64, height: 48 },
      redactions: [],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const malformedPreview = new FakeImageBitmap(64, 48)
    worker.signal({
      protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
      requestId: 2,
      type: 'render-ready',
      sourceId: 7,
      canonicalDimensions: { width: 64, height: 48 },
      previewDimensions: { width: 64, height: 48 },
      preview: malformedPreview,
      rgba: new Uint8Array(64 * 48 * 4),
    })

    await expect(rendering).rejects.toThrow('invalid response')
    expect(malformedPreview.closed).toBe(true)
    expect(worker.terminated).toBe(true)
  })

  it('reports a render-stage timeout and terminates stale work', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)
    const worker = new SilentWorker()
    const client = new MediaWorkerClient({
      operationTimeoutMilliseconds: 25,
      worker: worker as unknown as Worker,
    })
    worker.signalReady()
    await client.ready
    await openRenderableSource(client, worker)
    vi.useFakeTimers()

    let failure: unknown
    void client
      .renderWorkingDocument({
        dimensions: { width: 64, height: 48 },
        redactions: [],
      })
      .catch((error: unknown) => {
        failure = error
      })
    await vi.advanceTimersByTimeAsync(25)

    expect(failure).toBeInstanceOf(MediaWorkerOperationError)
    expect((failure as MediaWorkerOperationError).failure).toMatchObject({
      stage: 'render',
      code: 'operation-timeout',
    })
    expect(worker.terminated).toBe(true)
  })

  it('terminates a worker that does not become ready by its deadline', async () => {
    vi.useFakeTimers()
    const worker = new SilentWorker()
    const client = new MediaWorkerClient({
      operationTimeoutMilliseconds: 25,
      worker: worker as unknown as Worker,
    })

    let failure: unknown
    void client.ready.catch((error: unknown) => {
      failure = error
    })
    await vi.advanceTimersByTimeAsync(25)

    expect(failure).toBeInstanceOf(MediaWorkerOperationError)
    expect((failure as MediaWorkerOperationError).failure.code).toBe(
      'operation-timeout',
    )
    expect(worker.terminated).toBe(true)
  })

  it('terminates a worker that does not complete an operation deadline', async () => {
    vi.useFakeTimers()
    const worker = new SilentWorker()
    const client = new MediaWorkerClient({
      operationTimeoutMilliseconds: 25,
      worker: worker as unknown as Worker,
    })
    worker.signalReady()
    await client.ready

    let failure: unknown
    void client
      .openFile({
        name: 'deadline.jpg',
        size: 1,
        arrayBuffer: async () => new ArrayBuffer(1),
      })
      .catch((error: unknown) => {
        failure = error
      })
    await vi.advanceTimersByTimeAsync(25)

    expect(failure).toBeInstanceOf(MediaWorkerOperationError)
    expect((failure as MediaWorkerOperationError).failure).toMatchObject({
      stage: 'decode',
      code: 'operation-timeout',
    })
    expect(worker.terminated).toBe(true)
  })
})

async function openRenderableSource(
  client: MediaWorkerClient,
  worker: SilentWorker,
): Promise<void> {
  const opening = client.openFile({
    name: 'source.jpg',
    size: 1,
    arrayBuffer: async () => new ArrayBuffer(1),
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  worker.signal({
    protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
    requestId: 1,
    type: 'source-ready',
    sourceId: 7,
    inspection: {
      format: 'jpeg',
      encodedDimensions: { width: 64, height: 48 },
      normalizedDimensions: { width: 64, height: 48 },
      orientation: 1,
      metadataRiskSummary: { status: 'inspected', groups: [] },
    },
    previewDimensions: { width: 64, height: 48 },
    preview: new FakeImageBitmap(64, 48),
  })
  await opening
}
