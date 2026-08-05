import { PROVISIONAL_SOURCE_MEDIA_LIMITS } from '../intake/source-media'
import { boundUntrustedText } from '../security/untrusted-text'
import MediaWorker from './media-worker?worker&inline'
import {
  MEDIA_WORKER_PROTOCOL_VERSION,
  readMediaWorkerResponse,
  type MediaWorkerFailure,
  type MediaWorkerRequest,
  type MediaWorkerResponse,
  type OpenSourceResult,
} from './media-worker-protocol'

export class MediaWorkerOperationError extends Error {
  readonly failure: MediaWorkerFailure

  constructor(failure: MediaWorkerFailure) {
    super(failure.message)
    this.name = 'MediaWorkerOperationError'
    this.failure = failure
  }
}

type PendingOperation = Readonly<{
  resolve: (response: MediaWorkerResponse) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}>

type SourceFile = Pick<File, 'arrayBuffer' | 'name' | 'size'>

export type OpenFileResult = OpenSourceResult &
  Readonly<{
    sourceName: string
  }>

type MediaWorkerClientOptions = Readonly<{
  operationTimeoutMilliseconds?: number
  worker?: Worker
}>

const provisionalOperationTimeoutMilliseconds = 20_000

export class MediaWorkerClient {
  private readonly worker: Worker
  private readonly operationTimeoutMilliseconds: number
  private readonly pending = new Map<number, PendingOperation>()
  private nextRequestId = 1
  private readyTimeout: ReturnType<typeof setTimeout> | undefined
  private readyResolve: (() => void) | undefined
  private readyReject: ((error: Error) => void) | undefined
  private terminated = false

  readonly ready: Promise<void>

  constructor(options: MediaWorkerClientOptions = {}) {
    const operationTimeoutMilliseconds =
      options.operationTimeoutMilliseconds ??
      provisionalOperationTimeoutMilliseconds
    if (
      !Number.isSafeInteger(operationTimeoutMilliseconds) ||
      operationTimeoutMilliseconds <= 0 ||
      operationTimeoutMilliseconds > 120_000
    ) {
      throw new TypeError('The media worker operation timeout is invalid.')
    }
    this.operationTimeoutMilliseconds = operationTimeoutMilliseconds
    this.worker =
      options.worker ?? new MediaWorker({ name: 'privacy-canvas-media' })
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    this.readyTimeout = setTimeout(
      () => this.fail(operationTimeoutError()),
      this.operationTimeoutMilliseconds,
    )
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleWorkerError)
    this.worker.addEventListener('messageerror', this.handleWorkerError)
  }

  async openFile(file: SourceFile): Promise<OpenFileResult> {
    if (file.size > PROVISIONAL_SOURCE_MEDIA_LIMITS.maxInputBytes) {
      throw new MediaWorkerOperationError({
        stage: 'resource-limit',
        code: 'input-bytes-exceeded',
        message: 'Source Media exceeds the provisional byte limit.',
      })
    }
    const sourceName = boundUntrustedText(file.name, 512).value
    const sourceBytes = await file.arrayBuffer()
    return { sourceName, ...(await this.openSource(sourceBytes)) }
  }

  private async openSource(
    sourceBytes: ArrayBuffer,
  ): Promise<OpenSourceResult> {
    await this.ready
    const response = await this.request(
      {
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: this.nextRequestId,
        type: 'open-source',
        sourceBytes,
      },
      [sourceBytes],
    )
    if (response.type === 'source-ready') {
      return {
        inspection: response.inspection,
        previewDimensions: response.previewDimensions,
        preview: response.preview,
      }
    }
    throw response.type === 'operation-failed'
      ? new MediaWorkerOperationError(response.failure)
      : new Error('The media worker returned an unexpected response.')
  }

  async reset(): Promise<void> {
    await this.ready
    const response = await this.request({
      protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
      requestId: this.nextRequestId,
      type: 'reset',
    })
    if (response.type === 'reset-complete') return
    throw response.type === 'operation-failed'
      ? new MediaWorkerOperationError(response.failure)
      : new Error('The media worker returned an unexpected response.')
  }

  terminate(): void {
    if (this.terminated) return
    this.terminated = true
    this.worker.terminate()
    clearTimeout(this.readyTimeout)
    this.readyTimeout = undefined
    const error = new Error('The media worker was terminated.')
    this.readyReject?.(error)
    for (const operation of this.pending.values()) {
      clearTimeout(operation.timeout)
      operation.reject(error)
    }
    this.pending.clear()
  }

  private request(
    request: MediaWorkerRequest,
    transfer: Transferable[] = [],
  ): Promise<MediaWorkerResponse> {
    if (this.terminated) {
      return Promise.reject(new Error('The media worker was terminated.'))
    }
    this.nextRequestId += 1
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const operation = this.pending.get(request.requestId)
        if (operation === undefined) return
        this.pending.delete(request.requestId)
        const error = operationTimeoutError()
        operation.reject(error)
        this.fail(error)
      }, this.operationTimeoutMilliseconds)
      this.pending.set(request.requestId, { resolve, reject, timeout })
      try {
        this.worker.postMessage(request, transfer)
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(request.requestId)
        reject(
          error instanceof Error
            ? error
            : new Error('The media worker request could not be transferred.'),
        )
      }
    })
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    const response = readMediaWorkerResponse(event.data)
    if (response === undefined) {
      this.fail(new Error('The media worker returned an invalid response.'))
      return
    }
    if (response.type === 'ready') {
      clearTimeout(this.readyTimeout)
      this.readyTimeout = undefined
      this.readyResolve?.()
      this.readyResolve = undefined
      this.readyReject = undefined
      return
    }

    const operation = this.pending.get(response.requestId)
    if (operation === undefined) return
    this.pending.delete(response.requestId)
    clearTimeout(operation.timeout)
    operation.resolve(response)
  }

  private readonly handleWorkerError = (): void => {
    this.fail(new Error('The media worker stopped unexpectedly.'))
  }

  private fail(error: Error): void {
    this.readyReject?.(error)
    for (const operation of this.pending.values()) {
      clearTimeout(operation.timeout)
      operation.reject(error)
    }
    this.pending.clear()
    this.terminate()
  }
}

function operationTimeoutError(): MediaWorkerOperationError {
  return new MediaWorkerOperationError({
    stage: 'decode',
    code: 'operation-timeout',
    message: 'The media worker exceeded its safe operation deadline.',
  })
}
