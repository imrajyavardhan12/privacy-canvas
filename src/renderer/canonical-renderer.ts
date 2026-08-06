import type { ConfirmedRectangleRedaction } from '../document/redaction'
import type { DocumentDimensions } from '../document/working-document'

export type CanonicalRenderCode =
  | 'invalid-render-plan'
  | 'render-resource-limit'
  | 'render-dimensions-mismatch'
  | 'invalid-source-pixels'

export class CanonicalRenderError extends Error {
  readonly code: CanonicalRenderCode

  constructor(code: CanonicalRenderCode, message: string) {
    super(message)
    this.name = 'CanonicalRenderError'
    this.code = code
  }
}

export type CanonicalPixelRedaction = Readonly<{
  id: string
  x: number
  y: number
  width: number
  height: number
  color: `#${string}`
}>

export type CanonicalRenderPlan = Readonly<{
  dimensions: DocumentDimensions
  redactions: readonly CanonicalPixelRedaction[]
}>

export type CanonicalRenderDocument = Readonly<{
  dimensions: DocumentDimensions
  redactions: readonly ConfirmedRectangleRedaction[]
}>

export type CanonicalRgbaRaster = Readonly<{
  dimensions: DocumentDimensions
  rgba: Uint8Array<ArrayBuffer>
}>

const opaqueRgbColor = /^#[0-9a-f]{6}$/i
const maximumDimension = 8_192
const maximumPixels = 24_000_000
const maximumRedactions = 1_024
const canonicalPixelTolerance = 1e-9
const trustedRenderPlans = new WeakSet<CanonicalRenderPlan>()

/**
 * Runtime-validates and snapshots the untrusted normalized render state, then
 * rounds rectangle edges outward to conservative half-open pixel coverage.
 */
export function createCanonicalRenderPlan(value: unknown): CanonicalRenderPlan {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['dimensions', 'redactions']) ||
    !isRecord(value.dimensions) ||
    !hasOnlyKeys(value.dimensions, ['width', 'height']) ||
    !Array.isArray(value.redactions)
  ) {
    throw invalidPlan()
  }
  if (value.redactions.length > maximumRedactions) throw resourceLimit()
  if (!hasOnlyArrayElements(value.redactions)) throw invalidPlan()

  const width = value.dimensions.width
  const height = value.dimensions.height
  if (
    !Number.isSafeInteger(width) ||
    (width as number) <= 0 ||
    (width as number) > maximumDimension ||
    !Number.isSafeInteger(height) ||
    (height as number) <= 0 ||
    (height as number) > maximumDimension
  ) {
    throw invalidPlan()
  }
  if ((width as number) * (height as number) > maximumPixels) {
    throw resourceLimit()
  }

  const dimensions = Object.freeze({
    width: width as number,
    height: height as number,
  })
  const identifiers = new Set<string>()
  const redactions: CanonicalPixelRedaction[] = []
  let rasterizedPixels = 0

  for (const candidate of value.redactions) {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, [
        'id',
        'kind',
        'status',
        'x',
        'y',
        'width',
        'height',
        'color',
        'opacity',
      ]) ||
      typeof candidate.id !== 'string' ||
      candidate.id.trim().length === 0 ||
      candidate.id.length > 128 ||
      identifiers.has(candidate.id) ||
      candidate.kind !== 'rectangle' ||
      candidate.status !== 'confirmed' ||
      candidate.opacity !== 1 ||
      typeof candidate.color !== 'string' ||
      !opaqueRgbColor.test(candidate.color) ||
      !isNormalizedRectangle(candidate) ||
      (candidate.width as number) * dimensions.width <
        1 - canonicalPixelTolerance ||
      (candidate.height as number) * dimensions.height <
        1 - canonicalPixelTolerance
    ) {
      throw invalidPlan()
    }

    identifiers.add(candidate.id)
    const left = Math.max(
      0,
      Math.floor((candidate.x as number) * dimensions.width),
    )
    const top = Math.max(
      0,
      Math.floor((candidate.y as number) * dimensions.height),
    )
    const right = Math.min(
      dimensions.width,
      Math.ceil(
        ((candidate.x as number) + (candidate.width as number)) *
          dimensions.width,
      ),
    )
    const bottom = Math.min(
      dimensions.height,
      Math.ceil(
        ((candidate.y as number) + (candidate.height as number)) *
          dimensions.height,
      ),
    )
    const redaction = Object.freeze({
      id: candidate.id,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      color: candidate.color as `#${string}`,
    })
    rasterizedPixels += redaction.width * redaction.height
    if (
      !Number.isSafeInteger(rasterizedPixels) ||
      rasterizedPixels > maximumPixels
    ) {
      throw resourceLimit()
    }
    redactions.push(redaction)
  }

  return trustRenderPlan(
    Object.freeze({
      dimensions,
      redactions: Object.freeze(redactions),
    }),
  )
}

export function createPreviewRenderPlan(
  canonical: CanonicalRenderPlan,
  previewDimensions: DocumentDimensions,
): CanonicalRenderPlan {
  if (
    !trustedRenderPlans.has(canonical) ||
    !Number.isSafeInteger(previewDimensions.width) ||
    previewDimensions.width <= 0 ||
    previewDimensions.width > 512 ||
    previewDimensions.width > canonical.dimensions.width ||
    !Number.isSafeInteger(previewDimensions.height) ||
    previewDimensions.height <= 0 ||
    previewDimensions.height > 512 ||
    previewDimensions.height > canonical.dimensions.height
  ) {
    throw invalidPlan()
  }
  const dimensions = Object.freeze({ ...previewDimensions })
  return trustRenderPlan(
    Object.freeze({
      dimensions,
      redactions: Object.freeze(
        canonical.redactions.map((redaction) => {
          const left = Math.floor(
            (redaction.x * dimensions.width) / canonical.dimensions.width,
          )
          const top = Math.floor(
            (redaction.y * dimensions.height) / canonical.dimensions.height,
          )
          const right = Math.ceil(
            ((redaction.x + redaction.width) * dimensions.width) /
              canonical.dimensions.width,
          )
          const bottom = Math.ceil(
            ((redaction.y + redaction.height) * dimensions.height) /
              canonical.dimensions.height,
          )
          return Object.freeze({
            id: redaction.id,
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
            color: redaction.color,
          })
        }),
      ),
    }),
  )
}

/** Returns a dedicated canonical RGBA buffer; the caller's source is unchanged. */
export function renderCanonicalRgba(
  source: CanonicalRgbaRaster,
  plan: CanonicalRenderPlan,
): CanonicalRgbaRaster {
  if (!trustedRenderPlans.has(plan)) throw invalidPlan()
  const sourceRgba = snapshotSourcePixels(source, plan.dimensions)
  const rgba = new Uint8Array(sourceRgba)
  for (const redaction of plan.redactions) {
    const [red, green, blue] = parseRgb(redaction.color)
    for (let y = redaction.y; y < redaction.y + redaction.height; y += 1) {
      for (let x = redaction.x; x < redaction.x + redaction.width; x += 1) {
        const offset = (y * plan.dimensions.width + x) * 4
        rgba[offset] = red
        rgba[offset + 1] = green
        rgba[offset + 2] = blue
        rgba[offset + 3] = 255
      }
    }
  }
  return { dimensions: plan.dimensions, rgba }
}

function snapshotSourcePixels(
  source: CanonicalRgbaRaster,
  expectedDimensions: DocumentDimensions,
): Uint8Array<ArrayBuffer> {
  if (!isRecord(source) || !hasOnlyKeys(source, ['dimensions', 'rgba'])) {
    throw new CanonicalRenderError(
      'invalid-source-pixels',
      'Source RGBA pixels are invalid.',
    )
  }
  const dimensions = source.dimensions
  const rgba = source.rgba
  if (
    !isRecord(dimensions) ||
    !hasOnlyKeys(dimensions, ['width', 'height']) ||
    dimensions.width !== expectedDimensions.width ||
    dimensions.height !== expectedDimensions.height
  ) {
    throw new CanonicalRenderError(
      'render-dimensions-mismatch',
      'Source pixels do not match the canonical render dimensions.',
    )
  }
  const expectedBytes = expectedDimensions.width * expectedDimensions.height * 4
  if (
    !(rgba instanceof Uint8Array) ||
    !(rgba.buffer instanceof ArrayBuffer) ||
    rgba.byteLength !== expectedBytes ||
    rgba.byteOffset !== 0 ||
    rgba.buffer.byteLength !== rgba.byteLength
  ) {
    throw new CanonicalRenderError(
      'invalid-source-pixels',
      'Source RGBA pixels are invalid.',
    )
  }
  for (let alphaOffset = 3; alphaOffset < rgba.byteLength; alphaOffset += 4) {
    if (rgba[alphaOffset] !== 255) {
      throw new CanonicalRenderError(
        'invalid-source-pixels',
        'Source RGBA pixels must be fully opaque.',
      )
    }
  }
  return rgba
}

function isNormalizedRectangle(value: Record<string, unknown>): boolean {
  const x = value.x
  const y = value.y
  const width = value.width
  const height = value.height
  return (
    typeof x === 'number' &&
    Number.isFinite(x) &&
    x >= 0 &&
    x < 1 &&
    typeof y === 'number' &&
    Number.isFinite(y) &&
    y >= 0 &&
    y < 1 &&
    typeof width === 'number' &&
    Number.isFinite(width) &&
    width > 0 &&
    x + width <= 1 &&
    typeof height === 'number' &&
    Number.isFinite(height) &&
    height > 0 &&
    y + height <= 1
  )
}

function parseRgb(color: `#${string}`): readonly [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ]
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function trustRenderPlan(plan: CanonicalRenderPlan): CanonicalRenderPlan {
  trustedRenderPlans.add(plan)
  return plan
}

function invalidPlan(): CanonicalRenderError {
  return new CanonicalRenderError(
    'invalid-render-plan',
    'The canonical render plan is invalid.',
  )
}

function resourceLimit(): CanonicalRenderError {
  return new CanonicalRenderError(
    'render-resource-limit',
    'The canonical render plan exceeds safe resource limits.',
  )
}
