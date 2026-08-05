/// <reference lib="webworker" />

import {
  SourceMediaIntakeError,
  inspectSourceMedia,
  type PixelDimensions,
  type SourceMediaInspection,
} from '../intake/source-media'
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

  resetNormalizedPixels()
  try {
    const inspection = inspectSourceMedia(new Uint8Array(request.sourceBytes))
    const result = await decodeSource(request.sourceBytes, inspection)
    post(
      {
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        type: 'source-ready',
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
    const context = canvas.getContext('2d', { alpha: false })
    if (context === null) throw new Error('decode-failed')
    applyExifOrientation(
      context,
      inspection.orientation,
      encoded.width,
      encoded.height,
    )
    context.drawImage(decoded, 0, 0)
    normalizedCanvas = canvas

    const previewDimensions = fitWithinAxis(
      inspection.normalizedDimensions,
      maximumPreviewAxis,
    )
    const previewCanvas = new OffscreenCanvas(
      previewDimensions.width,
      previewDimensions.height,
    )
    const previewContext = previewCanvas.getContext('2d', { alpha: false })
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

function resetNormalizedPixels(): void {
  if (normalizedCanvas !== undefined) {
    normalizedCanvas.width = 1
    normalizedCanvas.height = 1
    normalizedCanvas = undefined
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
