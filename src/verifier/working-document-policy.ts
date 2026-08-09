import {
  createPngVerificationPolicy,
  PngVerificationError,
  type PngVerificationPolicy,
  type RequiredOpaqueRegion,
} from './png-verifier'

const opaqueRgbColor = /^#[0-9a-f]{6}$/i
const maximumDimension = 8_192
const maximumPixels = 24_000_000
const maximumRedactions = 1_024
const canonicalPixelTolerance = 1e-9

/**
 * Independently derives final-output mask requirements from untrusted
 * normalized Working Document state. It intentionally shares no renderer
 * rasterization helper.
 */
export function createPngVerificationPolicyFromWorkingDocument(
  value: unknown,
): PngVerificationPolicy {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['dimensions', 'redactions']) ||
    !isRecord(value.dimensions) ||
    !hasOnlyKeys(value.dimensions, ['width', 'height']) ||
    !Array.isArray(value.redactions) ||
    value.redactions.length > maximumRedactions ||
    !hasOnlyArrayElements(value.redactions)
  ) {
    throw invalidPolicy()
  }
  const width = value.dimensions.width
  const height = value.dimensions.height
  if (
    !Number.isSafeInteger(width) ||
    (width as number) <= 0 ||
    (width as number) > maximumDimension ||
    !Number.isSafeInteger(height) ||
    (height as number) <= 0 ||
    (height as number) > maximumDimension ||
    (width as number) * (height as number) > maximumPixels
  ) {
    throw invalidPolicy()
  }

  const identifiers = new Set<string>()
  const requiredOpaqueRegions: RequiredOpaqueRegion[] = []
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
      (candidate.width as number) * (width as number) <
        1 - canonicalPixelTolerance ||
      (candidate.height as number) * (height as number) <
        1 - canonicalPixelTolerance
    ) {
      throw invalidPolicy()
    }
    identifiers.add(candidate.id)
    const left = Math.max(
      0,
      Math.floor((candidate.x as number) * (width as number)),
    )
    const top = Math.max(
      0,
      Math.floor((candidate.y as number) * (height as number)),
    )
    const right = Math.min(
      width as number,
      Math.ceil(
        ((candidate.x as number) + (candidate.width as number)) *
          (width as number),
      ),
    )
    const bottom = Math.min(
      height as number,
      Math.ceil(
        ((candidate.y as number) + (candidate.height as number)) *
          (height as number),
      ),
    )
    const nextRegion: RequiredOpaqueRegion = {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      color: candidate.color as `#${string}`,
    }
    rasterizedPixels += nextRegion.width * nextRegion.height
    if (
      !Number.isSafeInteger(rasterizedPixels) ||
      rasterizedPixels > maximumPixels
    ) {
      throw invalidPolicy()
    }
    const stillVisible = requiredOpaqueRegions.flatMap((region) =>
      subtractCoveredRegion(region, nextRegion),
    )
    if (stillVisible.length + 1 > maximumRedactions) throw invalidPolicy()
    requiredOpaqueRegions.splice(
      0,
      requiredOpaqueRegions.length,
      ...stillVisible,
      nextRegion,
    )
  }

  return createPngVerificationPolicy({
    expectedDimensions: { width: width as number, height: height as number },
    requiredOpaqueRegions,
  })
}

function subtractCoveredRegion(
  existing: RequiredOpaqueRegion,
  cover: RequiredOpaqueRegion,
): readonly RequiredOpaqueRegion[] {
  const intersectionLeft = Math.max(existing.x, cover.x)
  const intersectionTop = Math.max(existing.y, cover.y)
  const intersectionRight = Math.min(
    existing.x + existing.width,
    cover.x + cover.width,
  )
  const intersectionBottom = Math.min(
    existing.y + existing.height,
    cover.y + cover.height,
  )
  if (
    intersectionLeft >= intersectionRight ||
    intersectionTop >= intersectionBottom
  ) {
    return [existing]
  }

  const pieces: RequiredOpaqueRegion[] = []
  appendRegion(
    pieces,
    existing.x,
    existing.y,
    existing.width,
    intersectionTop - existing.y,
    existing.color,
  )
  appendRegion(
    pieces,
    existing.x,
    intersectionTop,
    intersectionLeft - existing.x,
    intersectionBottom - intersectionTop,
    existing.color,
  )
  appendRegion(
    pieces,
    intersectionRight,
    intersectionTop,
    existing.x + existing.width - intersectionRight,
    intersectionBottom - intersectionTop,
    existing.color,
  )
  appendRegion(
    pieces,
    existing.x,
    intersectionBottom,
    existing.width,
    existing.y + existing.height - intersectionBottom,
    existing.color,
  )
  return pieces
}

function appendRegion(
  regions: RequiredOpaqueRegion[],
  x: number,
  y: number,
  width: number,
  height: number,
  color: `#${string}`,
): void {
  if (width > 0 && height > 0) regions.push({ x, y, width, height, color })
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

function invalidPolicy(): PngVerificationError {
  return new PngVerificationError(
    'invalid-policy',
    'The Working Document verification policy is invalid.',
  )
}
