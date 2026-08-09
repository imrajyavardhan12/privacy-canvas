/// <reference lib="webworker" />

import { PngEncodingError } from '../encoder/png-encoder'
import {
  SourceMediaIntakeError,
  inspectSourceMedia,
  type PixelDimensions,
  type SourceMediaInspection,
} from '../intake/source-media'
import {
  CanonicalRenderError,
  createPreviewRenderPlan,
  renderCanonicalRgba,
  type CanonicalRenderPlan,
  type CanonicalRgbaRaster,
} from '../renderer/canonical-renderer'
import { createVerifiedPng } from '../sanitizer/png-sanitizer'
import { PngVerificationError } from '../verifier/png-verifier'
import {
  MEDIA_WORKER_PROTOCOL_VERSION,
  readMediaWorkerRequest,
  type MediaWorkerFailure,
  type MediaWorkerResponse,
  type OpenSourceResult,
} from './media-worker-protocol'

const maximumPreviewAxis = 512
const workerScope = self as DedicatedWorkerGlobalScope

let normalizedCanvas: OffscreenCanvas | undefined
let normalizedContext: OffscreenCanvasRenderingContext2D | undefined
let canonicalRenderedPixels: CanonicalRgbaRaster | undefined
let currentSourceId: number | undefined
let nextSourceId = 1
let operationQueue: Promise<void> = Promise.resolve()

workerScope.addEventListener('message', (event: MessageEvent<unknown>) => {
  operationQueue = operationQueue.then(() => handleMessage(event.data))
})

post({
  protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
  type: 'ready',
})

async function handleMessage(value: unknown): Promise<void> {
  const request = readMediaWorkerRequest(value)
  if (request === undefined) {
    postFailure(0, {
      stage: 'intake',
      code: 'invalid-worker-message',
      message: 'The media worker received an invalid request.',
    })
    return
  }

  if (request.type === 'reset') {
    resetNormalizedPixels()
    post({
      protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      type: 'reset-complete',
    })
    return
  }

  if (request.type === 'export-document') {
    resetCanonicalRenderedPixels()
    if (
      normalizedCanvas === undefined ||
      normalizedContext === undefined ||
      currentSourceId === undefined
    ) {
      postFailure(request.requestId, {
        stage: 'render',
        code: 'source-unavailable',
        message: 'Canonical Source Media is unavailable for export.',
      })
      return
    }
    if (request.sourceId !== currentSourceId) {
      postFailure(request.requestId, {
        stage: 'render',
        code: 'stale-source',
        message: 'The export request belongs to a stale source.',
      })
      return
    }
    try {
      const canonicalPixels = renderCanonicalDocument(
        normalizedCanvas,
        normalizedContext,
        request.renderPlan,
      )
      try {
        const output = await createVerifiedPng(
          canonicalPixels,
          request.verificationPolicy,
        )
        post({
          protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
          requestId: request.requestId,
          type: 'export-ready',
          sourceId: currentSourceId,
          blob: output.blob,
          verification: output.verification,
        })
      } finally {
        if (canonicalPixels.rgba.byteLength > 0) {
          canonicalPixels.rgba.fill(0)
        }
      }
    } catch (error) {
      postFailure(request.requestId, describeExportFailure(error))
    }
    return
  }

  if (request.type === 'render-document') {
    resetCanonicalRenderedPixels()
    if (
      normalizedCanvas === undefined ||
      normalizedContext === undefined ||
      currentSourceId === undefined
    ) {
      postFailure(request.requestId, {
        stage: 'render',
        code: 'source-unavailable',
        message: 'Canonical Source Media is unavailable for rendering.',
      })
      return
    }
    if (request.sourceId !== currentSourceId) {
      postFailure(request.requestId, {
        stage: 'render',
        code: 'stale-source',
        message: 'The render request belongs to a stale source.',
      })
      return
    }
    try {
      const result = renderDocument(
        normalizedCanvas,
        normalizedContext,
        request.renderPlan,
      )
      canonicalRenderedPixels = result.canonicalPixels
      post(
        {
          protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
          requestId: request.requestId,
          type: 'render-ready',
          sourceId: currentSourceId,
          canonicalDimensions: result.canonicalPixels.dimensions,
          previewDimensions: result.previewDimensions,
          preview: result.preview,
        },
        [result.preview],
      )
    } catch (error) {
      resetCanonicalRenderedPixels()
      postFailure(request.requestId, describeRenderFailure(error))
    }
    return
  }

  resetNormalizedPixels()
  try {
    const inspection = inspectSourceMedia(new Uint8Array(request.sourceBytes))
    const result = await decodeSource(request.sourceBytes, inspection)
    const sourceId = nextSourceId
    nextSourceId += 1
    currentSourceId = sourceId
    post(
      {
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        type: 'source-ready',
        sourceId,
        ...result,
      },
      [result.preview],
    )
  } catch (error) {
    resetNormalizedPixels()
    postFailure(request.requestId, describeFailure(error))
  }
}

async function decodeSource(
  sourceBytes: ArrayBuffer,
  inspection: SourceMediaInspection,
): Promise<OpenSourceResult> {
  let decoded: ImageBitmap
  try {
    const decodeBytes = neutralizeApp1MetadataForDecode(sourceBytes)
    decoded = await createImageBitmap(
      new Blob([decodeBytes], { type: 'image/jpeg' }),
      { imageOrientation: 'from-image' },
    )
  } catch {
    throw new Error('decode-failed')
  }

  const { width, height } = inspection.normalizedDimensions
  const encoded = inspection.encodedDimensions
  try {
    if (decoded.width !== encoded.width || decoded.height !== encoded.height) {
      throw new Error('decode-failed')
    }

    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', {
      alpha: false,
      colorSpace: 'srgb',
    })
    if (context === null) throw new Error('decode-failed')
    applyExifOrientation(
      context,
      inspection.orientation,
      encoded.width,
      encoded.height,
    )
    context.drawImage(decoded, 0, 0)
    normalizedCanvas = canvas
    normalizedContext = context

    const previewDimensions = fitWithinAxis(
      inspection.normalizedDimensions,
      maximumPreviewAxis,
    )
    const previewCanvas = new OffscreenCanvas(
      previewDimensions.width,
      previewDimensions.height,
    )
    const previewContext = previewCanvas.getContext('2d', {
      alpha: false,
      colorSpace: 'srgb',
    })
    if (previewContext === null) throw new Error('decode-failed')
    previewContext.drawImage(
      canvas,
      0,
      0,
      previewDimensions.width,
      previewDimensions.height,
    )

    return {
      inspection,
      previewDimensions,
      preview: previewCanvas.transferToImageBitmap(),
    }
  } finally {
    decoded.close()
  }
}

/**
 * Prevents the browser decoder from independently interpreting orientation or
 * other APP1 metadata after preflight. The transferred Source Media remains
 * untouched; a copy is made lazily only when an APP1 payload exists.
 */
function neutralizeApp1MetadataForDecode(
  sourceBytes: ArrayBuffer,
): ArrayBuffer {
  const source = new Uint8Array(sourceBytes)
  let decodeBytes: Uint8Array<ArrayBuffer> | undefined
  let inEntropyData = false
  let offset = 2

  while (offset < source.length) {
    if (inEntropyData) {
      const markerOffset = findMarkerAfterScan(source, offset)
      if (markerOffset === undefined) return decodeBytes?.buffer ?? sourceBytes
      offset = markerOffset
      inEntropyData = false
    }

    while (source[offset] === 0xff) offset += 1
    const marker = source[offset]
    if (marker === undefined || marker === 0xd9) break
    offset += 1
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue

    const length = readUint16(source, offset)
    if (length === undefined) break
    const payloadOffset = offset + 2
    const segmentEnd = offset + length
    if (marker === 0xe1 && payloadOffset < segmentEnd) {
      decodeBytes ??= source.slice()
      decodeBytes[payloadOffset] = 0
    }
    offset = segmentEnd
    inEntropyData = marker === 0xda
  }
  return decodeBytes?.buffer ?? sourceBytes
}

function findMarkerAfterScan(
  bytes: Uint8Array,
  start: number,
): number | undefined {
  let offset = start
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const markerOffset = offset
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    if (marker === undefined) return undefined
    if (marker === 0 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 1
      continue
    }
    return markerOffset
  }
  return undefined
}

function readUint16(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 2 > bytes.length) return undefined
  return (bytes[offset]! << 8) | bytes[offset + 1]!
}

function applyExifOrientation(
  context: OffscreenCanvasRenderingContext2D,
  orientation: SourceMediaInspection['orientation'],
  width: number,
  height: number,
): void {
  switch (orientation) {
    case 1:
      return
    case 2:
      context.transform(-1, 0, 0, 1, width, 0)
      return
    case 3:
      context.transform(-1, 0, 0, -1, width, height)
      return
    case 4:
      context.transform(1, 0, 0, -1, 0, height)
      return
    case 5:
      context.transform(0, 1, 1, 0, 0, 0)
      return
    case 6:
      context.transform(0, 1, -1, 0, height, 0)
      return
    case 7:
      context.transform(0, -1, -1, 0, height, width)
      return
    case 8:
      context.transform(0, -1, 1, 0, 0, width)
  }
}

function fitWithinAxis(
  dimensions: PixelDimensions,
  maximumAxis: number,
): PixelDimensions {
  const scale = Math.min(
    1,
    maximumAxis / Math.max(dimensions.width, dimensions.height),
  )
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  }
}

function renderDocument(
  sourceCanvas: OffscreenCanvas,
  sourceContext: OffscreenCanvasRenderingContext2D,
  plan: CanonicalRenderPlan,
): Readonly<{
  canonicalPixels: CanonicalRgbaRaster
  previewDimensions: PixelDimensions
  preview: ImageBitmap
}> {
  const canonicalPixels = renderCanonicalDocument(
    sourceCanvas,
    sourceContext,
    plan,
  )
  try {
    return {
      canonicalPixels,
      ...renderDocumentPreview(sourceCanvas, plan),
    }
  } catch (error) {
    canonicalPixels.rgba.fill(0)
    throw error
  }
}

function renderCanonicalDocument(
  sourceCanvas: OffscreenCanvas,
  sourceContext: OffscreenCanvasRenderingContext2D,
  plan: CanonicalRenderPlan,
): CanonicalRgbaRaster {
  if (
    plan.dimensions.width !== sourceCanvas.width ||
    plan.dimensions.height !== sourceCanvas.height
  ) {
    throw new CanonicalRenderError(
      'render-dimensions-mismatch',
      'Working Document dimensions do not match canonical Source Media.',
    )
  }

  const imageData = sourceContext.getImageData(
    0,
    0,
    plan.dimensions.width,
    plan.dimensions.height,
  )
  const sourceRgba =
    imageData.data.buffer instanceof ArrayBuffer &&
    imageData.data.byteOffset === 0 &&
    imageData.data.byteLength === imageData.data.buffer.byteLength
      ? new Uint8Array(imageData.data.buffer)
      : new Uint8Array(imageData.data)
  try {
    return renderCanonicalRgba(
      { dimensions: plan.dimensions, rgba: sourceRgba },
      plan,
    )
  } finally {
    sourceRgba.fill(0)
  }
}

function renderDocumentPreview(
  sourceCanvas: OffscreenCanvas,
  plan: CanonicalRenderPlan,
): Readonly<{
  previewDimensions: PixelDimensions
  preview: ImageBitmap
}> {
  const previewDimensions = fitWithinAxis(plan.dimensions, maximumPreviewAxis)
  const previewCanvas = new OffscreenCanvas(
    previewDimensions.width,
    previewDimensions.height,
  )
  const previewContext = previewCanvas.getContext('2d', {
    alpha: false,
    colorSpace: 'srgb',
  })
  if (previewContext === null) throw new Error('render-failed')
  previewContext.drawImage(
    sourceCanvas,
    0,
    0,
    previewDimensions.width,
    previewDimensions.height,
  )
  const previewPlan = createPreviewRenderPlan(plan, previewDimensions)
  for (const redaction of previewPlan.redactions) {
    previewContext.fillStyle = redaction.color
    previewContext.fillRect(
      redaction.x,
      redaction.y,
      redaction.width,
      redaction.height,
    )
  }

  return {
    previewDimensions,
    preview: previewCanvas.transferToImageBitmap(),
  }
}

function resetCanonicalRenderedPixels(): void {
  canonicalRenderedPixels?.rgba.fill(0)
  canonicalRenderedPixels = undefined
}

function resetNormalizedPixels(): void {
  resetCanonicalRenderedPixels()
  currentSourceId = undefined
  normalizedContext = undefined
  if (normalizedCanvas !== undefined) {
    normalizedCanvas.width = 1
    normalizedCanvas.height = 1
    normalizedCanvas = undefined
  }
}

function describeRenderFailure(error: unknown): MediaWorkerFailure {
  if (error instanceof CanonicalRenderError) {
    return {
      stage: 'render',
      code: error.code,
      message: error.message,
    }
  }
  return {
    stage: 'render',
    code: 'render-failed',
    message: 'Canonical pixels could not be rendered safely.',
  }
}

function describeExportFailure(error: unknown): MediaWorkerFailure {
  if (error instanceof CanonicalRenderError) return describeRenderFailure(error)
  if (error instanceof PngEncodingError) {
    return {
      stage: 'encode',
      code: error.code,
      message: error.message,
    }
  }
  if (error instanceof PngVerificationError) {
    return {
      stage: 'verify',
      code: error.code,
      message: error.message,
    }
  }
  return {
    stage: 'verify',
    code: 'export-failed',
    message: 'Privacy Export could not be encoded and verified safely.',
  }
}

function describeFailure(error: unknown): MediaWorkerFailure {
  if (error instanceof SourceMediaIntakeError) {
    return {
      stage: error.stage,
      code: error.code,
      message: error.message,
    }
  }
  return {
    stage: 'decode',
    code: 'decode-failed',
    message: 'The JPEG could not be decoded safely.',
  }
}

function postFailure(requestId: number, failure: MediaWorkerFailure): void {
  post({
    protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
    requestId,
    type: 'operation-failed',
    failure,
  })
}

function post(
  message: MediaWorkerResponse,
  transfer: Transferable[] = [],
): void {
  workerScope.postMessage(message, transfer)
}
