import { PROVISIONAL_SOURCE_MEDIA_LIMITS } from '../intake/source-media'
import {
  createCanonicalRenderPlan,
  type CanonicalRenderDocument,
} from '../renderer/canonical-renderer'
import { boundUntrustedText } from '../security/untrusted-text'
import MediaWorker from './media-worker?worker&inline'
import {
  MEDIA_WORKER_PROTOCOL_VERSION,
  readMediaWorkerResponse,
  type MediaWorkerFailure,
  type MediaWorkerRequest,
  type ExportDocumentResult,
  type MediaWorkerResponse,
  type OpenSourceResult,
  type RenderDocumentResult,
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
  private currentSourceId: number | undefined
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
    this.currentSourceId = undefined
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
      this.currentSourceId = response.sourceId
      return {
        inspection: response.inspection,
        previewDimensions: response.previewDimensions,
        preview: response.preview,
      }
    }
    if (response.type === 'operation-failed') {
      throw new MediaWorkerOperationError(response.failure)
    }
    return this.rejectUnexpectedResponse(response)
  }

  async renderWorkingDocument(
    document: CanonicalRenderDocument,
  ): Promise<RenderDocumentResult> {
    const documentSnapshot = snapshotRenderDocument(document)
    createCanonicalRenderPlan(documentSnapshot)
    await this.ready
    const sourceId = this.currentSourceId
    if (sourceId === undefined) {
      throw new MediaWorkerOperationError({
        stage: 'render',
        code: 'source-unavailable',
        message: 'Canonical Source Media is unavailable for rendering.',
      })
    }
    const response = await this.request(
      {
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: this.nextRequestId,
        type: 'render-document',
        sourceId,
        document: documentSnapshot,
      },
      [],
      'render',
    )
    if (response.type === 'render-ready') {
      const expectedPreviewDimensions = fitWithinAxis(
        documentSnapshot.dimensions,
        512,
      )
      if (
        response.sourceId !== sourceId ||
        response.canonicalDimensions.width !==
          documentSnapshot.dimensions.width ||
        response.canonicalDimensions.height !==
          documentSnapshot.dimensions.height ||
        response.previewDimensions.width !== expectedPreviewDimensions.width ||
        response.previewDimensions.height !== expectedPreviewDimensions.height
      ) {
        response.preview.close()
        const error = new Error(
          'The media worker returned unexpected dimensions or stale pixels.',
        )
        this.fail(error)
        throw error
      }
      return {
        sourceId: response.sourceId,
        canonicalDimensions: response.canonicalDimensions,
        previewDimensions: response.previewDimensions,
        preview: response.preview,
      }
    }
    if (response.type === 'operation-failed') {
      throw new MediaWorkerOperationError(response.failure)
    }
    return this.rejectUnexpectedResponse(response)
  }

  async exportWorkingDocument(
    document: CanonicalRenderDocument,
  ): Promise<ExportDocumentResult> {
    const documentSnapshot = snapshotRenderDocument(document)
    createCanonicalRenderPlan(documentSnapshot)
    await this.ready
    const sourceId = this.currentSourceId
    if (sourceId === undefined) {
      throw new MediaWorkerOperationError({
        stage: 'render',
        code: 'source-unavailable',
        message: 'Canonical Source Media is unavailable for export.',
      })
    }
    const response = await this.request(
      {
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: this.nextRequestId,
        type: 'export-document',
        sourceId,
        document: documentSnapshot,
      },
      [],
      'encode',
    )
    if (response.type === 'export-ready') {
      if (
        response.sourceId !== sourceId ||
        response.verification.dimensions.width !==
          documentSnapshot.dimensions.width ||
        response.verification.dimensions.height !==
          documentSnapshot.dimensions.height
      ) {
        const error = new Error(
          'The media worker returned an unexpected export or stale output.',
        )
        this.fail(error)
        throw error
      }
      return Object.freeze({
        sourceId: response.sourceId,
        blob: response.blob,
        verification: snapshotVerificationReport(response.verification),
      })
    }
    if (response.type === 'operation-failed') {
      throw new MediaWorkerOperationError(response.failure)
    }
    return this.rejectUnexpectedResponse(response)
  }

  async reset(): Promise<void> {
    await this.ready
    this.currentSourceId = undefined
    const response = await this.request({
      protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
      requestId: this.nextRequestId,
      type: 'reset',
    })
    if (response.type === 'reset-complete') return
    if (response.type === 'operation-failed') {
      throw new MediaWorkerOperationError(response.failure)
    }
    return this.rejectUnexpectedResponse(response)
  }

  terminate(): void {
    if (this.terminated) return
    this.terminated = true
    this.worker.terminate()
    this.currentSourceId = undefined
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
    timeoutStage: MediaWorkerFailure['stage'] = 'decode',
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
        const error = operationTimeoutError(timeoutStage)
        operation.reject(error)
        this.fail(error)
      }, this.operationTimeoutMilliseconds)
      this.pending.set(request.requestId, { resolve, reject, timeout })
      try {
        this.worker.postMessage(request, transfer)
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(request.requestId)
        const transferError =
          error instanceof Error
            ? error
            : new Error('The media worker request could not be transferred.')
        reject(transferError)
        this.fail(transferError)
      }
    })
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    const response = readMediaWorkerResponse(event.data)
    if (response === undefined) {
      closeUnknownResponsePreview(event.data)
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
    if (operation === undefined) {
      closeResponsePreview(response)
      this.fail(
        new Error('The media worker returned an unexpected response request.'),
      )
      return
    }
    this.pending.delete(response.requestId)
    clearTimeout(operation.timeout)
    operation.resolve(response)
  }

  private readonly handleWorkerError = (): void => {
    this.fail(new Error('The media worker stopped unexpectedly.'))
  }

  private rejectUnexpectedResponse(response: MediaWorkerResponse): never {
    closeResponsePreview(response)
    const error = new Error('The media worker returned an unexpected response.')
    this.fail(error)
    throw error
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

function closeUnknownResponsePreview(value: unknown): void {
  try {
    if (typeof value !== 'object' || value === null) return
    const preview = (value as { readonly preview?: unknown }).preview
    if (typeof ImageBitmap !== 'undefined' && preview instanceof ImageBitmap) {
      preview.close()
    }
  } catch {
    // Invalid worker data still terminates the session below.
  }
}

function closeResponsePreview(response: MediaWorkerResponse): void {
  if (response.type === 'source-ready' || response.type === 'render-ready') {
    response.preview.close()
  }
}

function fitWithinAxis(
  dimensions: Readonly<{ width: number; height: number }>,
  maximumAxis: number,
): Readonly<{ width: number; height: number }> {
  const scale = Math.min(
    1,
    maximumAxis / Math.max(dimensions.width, dimensions.height),
  )
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  }
}

function snapshotRenderDocument(
  document: CanonicalRenderDocument,
): CanonicalRenderDocument {
  return Object.freeze({
    dimensions: Object.freeze({
      width: document.dimensions.width,
      height: document.dimensions.height,
    }),
    redactions: Object.freeze(
      document.redactions.map((redaction) =>
        Object.freeze({
          id: redaction.id,
          kind: redaction.kind,
          status: redaction.status,
          x: redaction.x,
          y: redaction.y,
          width: redaction.width,
          height: redaction.height,
          color: redaction.color,
          opacity: redaction.opacity,
        }),
      ),
    ),
  })
}

function snapshotVerificationReport(
  report: ExportDocumentResult['verification'],
): ExportDocumentResult['verification'] {
  return Object.freeze({
    status: report.status,
    format: report.format,
    dimensions: Object.freeze({
      width: report.dimensions.width,
      height: report.dimensions.height,
    }),
    frameCount: report.frameCount,
    pixelProfile: report.pixelProfile,
    metadataPolicy: report.metadataPolicy,
    metadataClassesChecked: Object.freeze([...report.metadataClassesChecked]),
    opaqueRegionsChecked: report.opaqueRegionsChecked,
  })
}

function operationTimeoutError(
  stage: MediaWorkerFailure['stage'] = 'decode',
): MediaWorkerOperationError {
  return new MediaWorkerOperationError({
    stage,
    code: 'operation-timeout',
    message: 'The media worker exceeded its safe operation deadline.',
  })
}
