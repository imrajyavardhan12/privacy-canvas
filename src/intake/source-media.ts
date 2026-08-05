import { JpegMetadataCollector } from './jpeg-metadata'

export type SourceMediaIntakeStage = 'intake' | 'resource-limit'

export type SourceMediaIntakeCode =
  | 'dimensions-exceeded'
  | 'input-bytes-exceeded'
  | 'malformed-container'
  | 'pixels-exceeded'
  | 'unsupported-animation'
  | 'unsupported-format'

export class SourceMediaIntakeError extends Error {
  readonly stage: SourceMediaIntakeStage
  readonly code: SourceMediaIntakeCode

  constructor(
    stage: SourceMediaIntakeStage,
    code: SourceMediaIntakeCode,
    message: string,
  ) {
    super(message)
    this.name = 'SourceMediaIntakeError'
    this.stage = stage
    this.code = code
  }
}

export type PixelDimensions = Readonly<{
  width: number
  height: number
}>

export type MetadataRiskCategory =
  | 'creator-contact'
  | 'device-identity'
  | 'editing-history'
  | 'embedded-text'
  | 'embedded-thumbnail'
  | 'location'
  | 'provenance'
  | 'timestamp'
  | 'unclassified-metadata'

export type MetadataFinding = Readonly<{
  source: 'exif' | 'iptc' | 'jumbf' | 'jpeg' | 'xmp'
  label: string
  value: string | null
  truncated: boolean
}>

export type MetadataRiskGroup = Readonly<{
  category: MetadataRiskCategory
  findings: readonly MetadataFinding[]
}>

export type MetadataRiskSummary = Readonly<{
  status: 'inspected' | 'partial'
  groups: readonly MetadataRiskGroup[]
}>

export type SourceMediaInspection = Readonly<{
  format: 'jpeg'
  encodedDimensions: PixelDimensions
  normalizedDimensions: PixelDimensions
  orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  metadataRiskSummary: MetadataRiskSummary
}>

export type SourceMediaIntakeLimits = Readonly<{
  maxInputBytes: number
  maxWidth: number
  maxHeight: number
  maxPixels: number
}>

/**
 * Fail-closed engineering guardrails pending measured iOS and Android budgets.
 * These values are not a published device-support commitment.
 */
export const PROVISIONAL_SOURCE_MEDIA_LIMITS: SourceMediaIntakeLimits =
  Object.freeze({
    maxInputBytes: 20 * 1024 * 1024,
    maxWidth: 8_192,
    maxHeight: 8_192,
    maxPixels: 24_000_000,
  })

const startOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])
const structuralSegmentMarkers = new Set([
  0xc4, // Define Huffman table
  0xcc, // Define arithmetic conditioning
  0xda, // Start of scan
  0xdb, // Define quantization table
  0xdc, // Define number of lines
  0xdd, // Define restart interval
  0xde, // Define hierarchical progression
  0xdf, // Expand reference components
  0xfe, // Comment
])

export function inspectSourceMedia(
  sourceBytes: Uint8Array,
  limits: SourceMediaIntakeLimits = PROVISIONAL_SOURCE_MEDIA_LIMITS,
): SourceMediaInspection {
  if (sourceBytes.byteLength > limits.maxInputBytes) {
    throw new SourceMediaIntakeError(
      'resource-limit',
      'input-bytes-exceeded',
      'Source Media exceeds the provisional byte limit.',
    )
  }

  if (readUint16(sourceBytes, 0) !== 0xffd8) {
    const animated = isAnimatedGif(sourceBytes)
    throw new SourceMediaIntakeError(
      'intake',
      animated ? 'unsupported-animation' : 'unsupported-format',
      animated
        ? 'Animated Source Media is not supported.'
        : 'Only JPEG Source Media is supported.',
    )
  }

  if (readUint16(sourceBytes, sourceBytes.length - 2) !== 0xffd9) {
    malformedContainer('The JPEG container is incomplete.')
  }

  const metadata = new JpegMetadataCollector()
  let dimensions: PixelDimensions | undefined
  let frameComponentCount: number | undefined
  let inEntropyData = false
  let offset = 2
  let orientation: SourceMediaInspection['orientation'] = 1
  let sawScan = false

  while (offset < sourceBytes.length) {
    if (inEntropyData) {
      const nextMarker = findMarkerAfterEntropyData(sourceBytes, offset)
      if (nextMarker === undefined) {
        malformedContainer('The JPEG scan has no terminating marker.')
      }
      offset = nextMarker
      inEntropyData = false
      continue
    }

    if (sourceBytes[offset] !== 0xff) {
      malformedContainer('The JPEG marker sequence is malformed.')
    }
    while (sourceBytes[offset] === 0xff) offset += 1

    const marker = sourceBytes[offset]
    if (marker === undefined || marker === 0) {
      malformedContainer('The JPEG marker is incomplete.')
    }
    offset += 1

    if (marker === 0xd9) {
      if (!dimensions || !sawScan || offset !== sourceBytes.length) {
        malformedContainer('The JPEG image frame is incomplete.')
      }
      const normalizedDimensions =
        orientation >= 5
          ? { width: dimensions.height, height: dimensions.width }
          : dimensions
      return {
        format: 'jpeg',
        encodedDimensions: dimensions,
        normalizedDimensions,
        orientation,
        metadataRiskSummary: metadata.summarize(),
      }
    }

    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      malformedContainer('The JPEG contains an unexpected standalone marker.')
    }
    if (marker === 0x01) continue
    if (
      !startOfFrameMarkers.has(marker) &&
      !structuralSegmentMarkers.has(marker) &&
      !(marker >= 0xe0 && marker <= 0xef)
    ) {
      malformedContainer('The JPEG contains an unsupported marker extension.')
    }

    const length = readUint16(sourceBytes, offset)
    if (
      length === undefined ||
      length < 2 ||
      offset + length > sourceBytes.length
    ) {
      malformedContainer('The JPEG segment length is invalid.')
    }
    const payloadOffset = offset + 2
    const segmentEnd = offset + length

    if (marker === 0xda) {
      const scanComponentCount = sourceBytes[payloadOffset]
      if (
        !dimensions ||
        frameComponentCount === undefined ||
        scanComponentCount === undefined ||
        scanComponentCount === 0 ||
        scanComponentCount > frameComponentCount ||
        length !== 6 + 2 * scanComponentCount
      ) {
        malformedContainer('The JPEG scan header is invalid.')
      }
      sawScan = true
      offset = segmentEnd
      inEntropyData = true
      continue
    }

    if (marker === 0xe1) {
      const parsedOrientation = metadata.inspectApp1(
        sourceBytes.subarray(payloadOffset, segmentEnd),
      )
      if (parsedOrientation !== undefined) orientation = parsedOrientation
    }
    if (marker === 0xeb) {
      metadata.inspectApp11(sourceBytes.subarray(payloadOffset, segmentEnd))
    }
    if (marker === 0xed) {
      metadata.inspectApp13(sourceBytes.subarray(payloadOffset, segmentEnd))
    }
    if (marker === 0xfe) {
      metadata.inspectComment(sourceBytes.subarray(payloadOffset, segmentEnd))
    }

    if (startOfFrameMarkers.has(marker)) {
      const componentCount = sourceBytes[offset + 7]
      if (
        dimensions ||
        componentCount === undefined ||
        componentCount === 0 ||
        length !== 8 + 3 * componentCount
      ) {
        malformedContainer('The JPEG frame header is invalid.')
      }
      const height = readUint16(sourceBytes, offset + 3)
      const width = readUint16(sourceBytes, offset + 5)
      if (
        width === undefined ||
        height === undefined ||
        width === 0 ||
        height === 0
      ) {
        malformedContainer('JPEG dimensions must be greater than zero.')
      }
      enforceDimensionLimits(width, height, limits)
      dimensions = { width, height }
      frameComponentCount = componentCount
    }

    offset = segmentEnd
  }

  malformedContainer(
    'The JPEG container ended before its image frame was complete.',
  )
}

function enforceDimensionLimits(
  width: number,
  height: number,
  limits: SourceMediaIntakeLimits,
): void {
  if (width > limits.maxWidth || height > limits.maxHeight) {
    throw new SourceMediaIntakeError(
      'resource-limit',
      'dimensions-exceeded',
      'JPEG dimensions exceed the provisional resource limits.',
    )
  }
  if (width * height > limits.maxPixels) {
    throw new SourceMediaIntakeError(
      'resource-limit',
      'pixels-exceeded',
      'JPEG pixel count exceeds the provisional resource limits.',
    )
  }
}

function findMarkerAfterEntropyData(
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

function isAnimatedGif(bytes: Uint8Array): boolean {
  const header = String.fromCharCode(...bytes.subarray(0, 6))
  if (header !== 'GIF87a' && header !== 'GIF89a') return false

  let imageDescriptors = 0
  for (const byte of bytes) imageDescriptors += byte === 0x2c ? 1 : 0
  return imageDescriptors > 1
}

function readUint16(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 2 > bytes.length) return undefined
  return (bytes[offset]! << 8) | bytes[offset + 1]!
}

function malformedContainer(message: string): never {
  throw new SourceMediaIntakeError('intake', 'malformed-container', message)
}
