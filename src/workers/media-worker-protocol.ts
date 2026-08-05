import type {
  PixelDimensions,
  SourceMediaInspection,
  SourceMediaIntakeCode,
  SourceMediaIntakeStage,
} from '../intake/source-media'

export const MEDIA_WORKER_PROTOCOL_VERSION = 1 as const

export type MediaWorkerRequest = Readonly<
  | {
      protocolVersion: typeof MEDIA_WORKER_PROTOCOL_VERSION
      requestId: number
      type: 'open-source'
      sourceBytes: ArrayBuffer
    }
  | {
      protocolVersion: typeof MEDIA_WORKER_PROTOCOL_VERSION
      requestId: number
      type: 'reset'
    }
>

export type MediaWorkerFailure = Readonly<{
  stage: SourceMediaIntakeStage | 'decode'
  code:
    | SourceMediaIntakeCode
    | 'decode-failed'
    | 'invalid-worker-message'
    | 'operation-timeout'
  message: string
}>

export type OpenSourceResult = Readonly<{
  inspection: SourceMediaInspection
  previewDimensions: PixelDimensions
  preview: ImageBitmap
}>

export type MediaWorkerResponse = Readonly<
  | {
      protocolVersion: typeof MEDIA_WORKER_PROTOCOL_VERSION
      type: 'ready'
    }
  | ({
      protocolVersion: typeof MEDIA_WORKER_PROTOCOL_VERSION
      requestId: number
    } & (
      | ({ type: 'source-ready' } & OpenSourceResult)
      | { type: 'reset-complete' }
      | { type: 'operation-failed'; failure: MediaWorkerFailure }
    ))
>

const riskCategories = new Set([
  'creator-contact',
  'device-identity',
  'editing-history',
  'embedded-text',
  'embedded-thumbnail',
  'location',
  'provenance',
  'timestamp',
  'unclassified-metadata',
])
const findingSources = new Set(['exif', 'iptc', 'jumbf', 'jpeg', 'xmp'])
const failureStages = new Set(['intake', 'resource-limit', 'decode'])
const failureCodes = new Set([
  'dimensions-exceeded',
  'input-bytes-exceeded',
  'malformed-container',
  'pixels-exceeded',
  'unsupported-animation',
  'unsupported-format',
  'decode-failed',
  'invalid-worker-message',
  'operation-timeout',
])

export function readMediaWorkerRequest(
  value: unknown,
): MediaWorkerRequest | undefined {
  if (!isRecord(value) || !hasValidEnvelope(value)) return undefined
  if (value.type === 'reset') return value as MediaWorkerRequest
  if (
    value.type === 'open-source' &&
    value.sourceBytes instanceof ArrayBuffer
  ) {
    return value as MediaWorkerRequest
  }
  return undefined
}

export function readMediaWorkerResponse(
  value: unknown,
): MediaWorkerResponse | undefined {
  if (
    !isRecord(value) ||
    value.protocolVersion !== MEDIA_WORKER_PROTOCOL_VERSION
  ) {
    return undefined
  }
  if (value.type === 'ready') return value as MediaWorkerResponse
  if (!hasValidRequestId(value.requestId)) return undefined
  if (value.type === 'reset-complete') return value as MediaWorkerResponse
  if (value.type === 'operation-failed') {
    return isFailure(value.failure) ? (value as MediaWorkerResponse) : undefined
  }
  if (
    value.type === 'source-ready' &&
    isInspection(value.inspection) &&
    isDimensions(value.previewDimensions) &&
    value.previewDimensions.width <= 512 &&
    value.previewDimensions.height <= 512 &&
    isImageBitmap(value.preview) &&
    value.preview.width === value.previewDimensions.width &&
    value.preview.height === value.previewDimensions.height
  ) {
    return value as MediaWorkerResponse
  }
  return undefined
}

function isInspection(value: unknown): value is SourceMediaInspection {
  if (
    !isRecord(value) ||
    value.format !== 'jpeg' ||
    !isDimensions(value.encodedDimensions) ||
    !isDimensions(value.normalizedDimensions) ||
    !Number.isInteger(value.orientation) ||
    (value.orientation as number) < 1 ||
    (value.orientation as number) > 8 ||
    !isMetadataSummary(value.metadataRiskSummary)
  ) {
    return false
  }
  const swapsAxes = (value.orientation as number) >= 5
  return (
    value.normalizedDimensions.width ===
      (swapsAxes
        ? value.encodedDimensions.height
        : value.encodedDimensions.width) &&
    value.normalizedDimensions.height ===
      (swapsAxes
        ? value.encodedDimensions.width
        : value.encodedDimensions.height)
  )
}

function isMetadataSummary(value: unknown): boolean {
  if (
    !isRecord(value) ||
    (value.status !== 'inspected' && value.status !== 'partial') ||
    !Array.isArray(value.groups) ||
    value.groups.length > riskCategories.size
  ) {
    return false
  }

  let findingCount = 0
  const categories = new Set<string>()
  for (const group of value.groups) {
    if (
      !isRecord(group) ||
      typeof group.category !== 'string' ||
      !riskCategories.has(group.category) ||
      categories.has(group.category) ||
      !Array.isArray(group.findings)
    ) {
      return false
    }
    categories.add(group.category)
    findingCount += group.findings.length
    if (findingCount > 64) return false
    for (const finding of group.findings) {
      if (!isFinding(finding)) return false
    }
  }
  return true
}

function isFinding(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.source === 'string' &&
    findingSources.has(value.source) &&
    typeof value.label === 'string' &&
    value.label.length <= 128 &&
    (value.value === null ||
      (typeof value.value === 'string' && value.value.length <= 512)) &&
    typeof value.truncated === 'boolean'
  )
}

function isFailure(value: unknown): value is MediaWorkerFailure {
  return (
    isRecord(value) &&
    typeof value.stage === 'string' &&
    failureStages.has(value.stage) &&
    typeof value.code === 'string' &&
    failureCodes.has(value.code) &&
    typeof value.message === 'string' &&
    value.message.length > 0 &&
    value.message.length <= 256
  )
}

function isDimensions(value: unknown): value is PixelDimensions {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.width) &&
    (value.width as number) > 0 &&
    Number.isSafeInteger(value.height) &&
    (value.height as number) > 0
  )
}

function hasValidEnvelope(value: Record<string, unknown>): value is Record<
  string,
  unknown
> & {
  protocolVersion: typeof MEDIA_WORKER_PROTOCOL_VERSION
  requestId: number
} {
  return (
    value.protocolVersion === MEDIA_WORKER_PROTOCOL_VERSION &&
    hasValidRequestId(value.requestId)
  )
}

function hasValidRequestId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isImageBitmap(value: unknown): value is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
