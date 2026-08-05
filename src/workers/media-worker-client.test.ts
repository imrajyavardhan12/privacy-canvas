import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MediaWorkerClient,
  MediaWorkerOperationError,
} from './media-worker-client'
import { PROVISIONAL_SOURCE_MEDIA_LIMITS } from '../intake/source-media'
import { MEDIA_WORKER_PROTOCOL_VERSION } from './media-worker-protocol'

class SilentWorker extends EventTarget {
  terminated = false

  postMessage(_message: unknown, transfer: Transferable[] = []): void {
    structuredClone(null, { transfer })
  }

  terminate(): void {
    this.terminated = true
  }

  signalReady(): void {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: {
          protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
          type: 'ready',
        },
      }),
    )
  }
}

describe('MediaWorkerClient', () => {
  afterEach(() => vi.useRealTimers())

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
