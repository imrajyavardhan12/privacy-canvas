import {
  PROVISIONAL_SOURCE_MEDIA_LIMITS,
  type PixelDimensions,
  type SourceMediaInspection,
  type SourceMediaIntakeCode,
  type SourceMediaIntakeStage,
} from '../intake/source-media'
import {
  createCanonicalRenderPlan,
  type CanonicalRenderCode,
  type CanonicalRenderDocument,
  type CanonicalRenderPlan,
} from '../renderer/canonical-renderer'
import type { PngEncodingCode } from '../encoder/png-encoder'
import type {
  PngVerificationCode,
  PngVerificationPolicy,
  PngVerificationReport,
} from '../verifier/png-verifier'
import { createPngVerificationPolicyFromWorkingDocument } from '../verifier/working-document-policy'

export const MEDIA_WORKER_PROTOCOL_VERSION = 3 as const

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
      type: 'render-document' | 'export-document'
      sourceId: number
      document: CanonicalRenderDocument
    }
  | {
      protocolVersion: typeof MEDIA_WORKER_PROTOCOL_VERSION
      requestId: number
      type: 'reset'
    }
>

export type ValidatedMediaWorkerRequest = Readonly<
  | Exclude<MediaWorkerRequest, { type: 'render-document' | 'export-document' }>
  | {
      protocolVersion: typeof MEDIA_WORKER_PROTOCOL_VERSION
      requestId: number
      type: 'render-document'
      sourceId: number
      renderPlan: CanonicalRenderPlan
    }
  | {
      protocolVersion: typeof MEDIA_WORKER_PROTOCOL_VERSION
      requestId: number
      type: 'export-document'
      sourceId: number
      renderPlan: CanonicalRenderPlan
      verificationPolicy: PngVerificationPolicy
    }
>

export type MediaWorkerFailure = Readonly<{
  stage: SourceMediaIntakeStage | 'decode' | 'render' | 'encode' | 'verify'
  code:
    | SourceMediaIntakeCode
    | CanonicalRenderCode
    | PngEncodingCode
    | PngVerificationCode
    | 'decode-failed'
    | 'render-failed'
    | 'export-failed'
    | 'source-unavailable'
    | 'stale-source'
    | 'invalid-worker-message'
    | 'operation-timeout'
  message: string
}>

export type OpenSourceResult = Readonly<{
  inspection: SourceMediaInspection
  previewDimensions: PixelDimensions
  preview: ImageBitmap
}>

export type RenderDocumentResult = Readonly<{
  sourceId: number
  canonicalDimensions: PixelDimensions
  previewDimensions: PixelDimensions
  preview: ImageBitmap
}>

export type ExportDocumentResult = Readonly<{
  sourceId: number
  blob: Blob
  verification: PngVerificationReport
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
      | ({ type: 'source-ready'; sourceId: number } & OpenSourceResult)
      | ({ type: 'render-ready' } & RenderDocumentResult)
      | ({ type: 'export-ready' } & ExportDocumentResult)
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
const pngMetadataClasses = [
  'exif',
  'gps',
  'xmp',
  'iptc',
  'comments',
  'thumbnails',
  'color-profiles',
  'c2pa',
  'other-ancillary-chunks',
] as const
const maximumEncodedPngBytes = 128 * 1024 * 1024
const failureCodesByStage: Record<
  MediaWorkerFailure['stage'],
  ReadonlySet<string>
> = {
  intake: new Set([
    'malformed-container',
    'unsupported-animation',
    'unsupported-format',
    'invalid-worker-message',
  ]),
  'resource-limit': new Set([
    'dimensions-exceeded',
    'input-bytes-exceeded',
    'pixels-exceeded',
  ]),
  decode: new Set(['decode-failed', 'operation-timeout']),
  render: new Set([
    'invalid-render-plan',
    'render-resource-limit',
    'render-dimensions-mismatch',
    'invalid-source-pixels',
    'render-failed',
    'source-unavailable',
    'stale-source',
    'operation-timeout',
  ]),
  encode: new Set([
    'invalid-rendered-pixels',
    'transparent-rendered-pixels',
    'encoding-unavailable',
    'compression-failed',
    'encoded-bytes-exceeded',
    'operation-timeout',
  ]),
  verify: new Set([
    'invalid-policy',
    'malformed-png',
    'dimensions-mismatch',
    'forbidden-chunk',
    'decode-failed',
    'opaque-coverage-failed',
    'export-failed',
  ]),
}

export function readMediaWorkerRequest(
  value: unknown,
): ValidatedMediaWorkerRequest | undefined {
  if (!isRecord(value) || !hasValidEnvelope(value)) return undefined
  if (
    value.type === 'reset' &&
    hasOnlyKeys(value, ['protocolVersion', 'requestId', 'type'])
  ) {
    return value as ValidatedMediaWorkerRequest
  }
  if (
    value.type === 'open-source' &&
    hasOnlyKeys(value, [
      'protocolVersion',
      'requestId',
      'type',
      'sourceBytes',
    ]) &&
    value.sourceBytes instanceof ArrayBuffer
  ) {
    return value as ValidatedMediaWorkerRequest
  }
  if (
    (value.type === 'render-document' || value.type === 'export-document') &&
    hasValidSourceId(value.sourceId) &&
    hasOnlyKeys(value, [
      'protocolVersion',
      'requestId',
      'type',
      'sourceId',
      'document',
    ])
  ) {
    try {
      const renderPlan = createCanonicalRenderPlan(value.document)
      return value.type === 'render-document'
        ? {
            protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
            requestId: value.requestId,
            type: 'render-document',
            sourceId: value.sourceId,
            renderPlan,
          }
        : {
            protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
            requestId: value.requestId,
            type: 'export-document',
            sourceId: value.sourceId,
            renderPlan,
            verificationPolicy: createPngVerificationPolicyFromWorkingDocument(
              value.document,
            ),
          }
    } catch {
      return undefined
    }
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
  if (value.type === 'ready') {
    return hasOnlyKeys(value, ['protocolVersion', 'type'])
      ? (value as MediaWorkerResponse)
      : undefined
  }
  if (!hasValidRequestId(value.requestId)) return undefined
  if (value.type === 'reset-complete') {
    return hasOnlyKeys(value, ['protocolVersion', 'requestId', 'type'])
      ? (value as MediaWorkerResponse)
      : undefined
  }
  if (value.type === 'operation-failed') {
    return hasOnlyKeys(value, [
      'protocolVersion',
      'requestId',
      'type',
      'failure',
    ]) && isFailure(value.failure)
      ? (value as MediaWorkerResponse)
      : undefined
  }
  if (
    value.type === 'render-ready' &&
    hasOnlyKeys(value, [
      'protocolVersion',
      'requestId',
      'type',
      'sourceId',
      'canonicalDimensions',
      'previewDimensions',
      'preview',
    ]) &&
    hasValidSourceId(value.sourceId) &&
    isDimensions(value.canonicalDimensions) &&
    (value.canonicalDimensions.width as number) <=
      PROVISIONAL_SOURCE_MEDIA_LIMITS.maxWidth &&
    (value.canonicalDimensions.height as number) <=
      PROVISIONAL_SOURCE_MEDIA_LIMITS.maxHeight &&
    (value.canonicalDimensions.width as number) *
      (value.canonicalDimensions.height as number) <=
      PROVISIONAL_SOURCE_MEDIA_LIMITS.maxPixels &&
    isDimensions(value.previewDimensions) &&
    value.previewDimensions.width <= 512 &&
    value.previewDimensions.height <= 512 &&
    hasExpectedPreviewDimensions(
      value.previewDimensions,
      value.canonicalDimensions,
    ) &&
    isImageBitmap(value.preview) &&
    value.preview.width === value.previewDimensions.width &&
    value.preview.height === value.previewDimensions.height
  ) {
    return value as MediaWorkerResponse
  }
  if (
    value.type === 'export-ready' &&
    hasOnlyKeys(value, [
      'protocolVersion',
      'requestId',
      'type',
      'sourceId',
      'blob',
      'verification',
    ]) &&
    hasValidSourceId(value.sourceId) &&
    isPngBlob(value.blob) &&
    isPngVerificationReport(value.verification)
  ) {
    return value as MediaWorkerResponse
  }
  if (
    value.type === 'source-ready' &&
    hasOnlyKeys(value, [
      'protocolVersion',
      'requestId',
      'type',
      'sourceId',
      'inspection',
      'previewDimensions',
      'preview',
    ]) &&
    hasValidSourceId(value.sourceId) &&
    isInspection(value.inspection) &&
    isDimensions(value.previewDimensions) &&
    value.previewDimensions.width <= 512 &&
    value.previewDimensions.height <= 512 &&
    hasExpectedPreviewDimensions(
      value.previewDimensions,
      value.inspection.normalizedDimensions,
    ) &&
    isImageBitmap(value.preview) &&
    value.preview.width === value.previewDimensions.width &&
    value.preview.height === value.previewDimensions.height
  ) {
    return value as MediaWorkerResponse
  }
  return undefined
}

function isPngBlob(value: unknown): value is Blob {
  return (
    typeof Blob !== 'undefined' &&
    value instanceof Blob &&
    value.type === 'image/png' &&
    value.size > 0 &&
    value.size <= maximumEncodedPngBytes
  )
}

function isPngVerificationReport(
  value: unknown,
): value is PngVerificationReport {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'status',
      'format',
      'dimensions',
      'frameCount',
      'pixelProfile',
      'metadataPolicy',
      'metadataClassesChecked',
      'opaqueRegionsChecked',
    ]) &&
    value.status === 'verified' &&
    value.format === 'png' &&
    isSourceDimensions(value.dimensions) &&
    value.frameCount === 1 &&
    value.pixelProfile === 'opaque-rgb8' &&
    value.metadataPolicy === 'core-chunks-only' &&
    Array.isArray(value.metadataClassesChecked) &&
    value.metadataClassesChecked.length === pngMetadataClasses.length &&
    hasOnlyArrayElements(value.metadataClassesChecked) &&
    value.metadataClassesChecked.every(
      (metadataClass, index) => metadataClass === pngMetadataClasses[index],
    ) &&
    Number.isSafeInteger(value.opaqueRegionsChecked) &&
    (value.opaqueRegionsChecked as number) >= 0 &&
    (value.opaqueRegionsChecked as number) <= 1_024
  )
}

function isInspection(value: unknown): value is SourceMediaInspection {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'format',
      'encodedDimensions',
      'normalizedDimensions',
      'orientation',
      'metadataRiskSummary',
    ]) ||
    value.format !== 'jpeg' ||
    !isSourceDimensions(value.encodedDimensions) ||
    !isSourceDimensions(value.normalizedDimensions) ||
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
    !hasOnlyKeys(value, ['status', 'groups']) ||
    (value.status !== 'inspected' && value.status !== 'partial') ||
    !Array.isArray(value.groups) ||
    value.groups.length > riskCategories.size ||
    !hasOnlyArrayElements(value.groups)
  ) {
    return false
  }

  let findingCount = 0
  const categories = new Set<string>()
  for (const group of value.groups) {
    if (
      !isRecord(group) ||
      !hasOnlyKeys(group, ['category', 'findings']) ||
      typeof group.category !== 'string' ||
      !riskCategories.has(group.category) ||
      categories.has(group.category) ||
      !Array.isArray(group.findings) ||
      group.findings.length > 64 - findingCount ||
      !hasOnlyArrayElements(group.findings)
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
    hasOnlyKeys(value, ['source', 'label', 'value', 'truncated']) &&
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
    hasOnlyKeys(value, ['stage', 'code', 'message']) &&
    typeof value.stage === 'string' &&
    Object.hasOwn(failureCodesByStage, value.stage) &&
    typeof value.code === 'string' &&
    failureCodesByStage[value.stage as MediaWorkerFailure['stage']].has(
      value.code,
    ) &&
    typeof value.message === 'string' &&
    value.message.length > 0 &&
    value.message.length <= 256
  )
}

function isDimensions(value: unknown): value is PixelDimensions {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['width', 'height']) &&
    Number.isSafeInteger(value.width) &&
    (value.width as number) > 0 &&
    Number.isSafeInteger(value.height) &&
    (value.height as number) > 0
  )
}

function hasExpectedPreviewDimensions(
  preview: PixelDimensions,
  canonical: PixelDimensions,
): boolean {
  const scale = Math.min(1, 512 / Math.max(canonical.width, canonical.height))
  return (
    preview.width === Math.max(1, Math.round(canonical.width * scale)) &&
    preview.height === Math.max(1, Math.round(canonical.height * scale))
  )
}

function isSourceDimensions(value: unknown): value is PixelDimensions {
  return (
    isDimensions(value) &&
    value.width <= PROVISIONAL_SOURCE_MEDIA_LIMITS.maxWidth &&
    value.height <= PROVISIONAL_SOURCE_MEDIA_LIMITS.maxHeight &&
    value.width * value.height <= PROVISIONAL_SOURCE_MEDIA_LIMITS.maxPixels
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

function hasValidSourceId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function hasOnlyArrayElements(value: readonly unknown[]): boolean {
  const keys = Reflect.ownKeys(value)
  if (keys.length !== value.length + 1) return false
  let hasLength = false
  for (const key of keys) {
    if (key === 'length') {
      hasLength = true
      continue
    }
    if (typeof key !== 'string') return false
    const index = Number(key)
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= value.length ||
      String(index) !== key
    ) {
      return false
    }
  }
  return hasLength
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = new Set(keys)
  const actual = Object.keys(value)
  return (
    actual.length === expected.size && actual.every((key) => expected.has(key))
  )
}

function isImageBitmap(value: unknown): value is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
