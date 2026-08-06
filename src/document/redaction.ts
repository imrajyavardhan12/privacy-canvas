export type NormalizedPoint = Readonly<{
  x: number
  y: number
}>

export type NormalizedDelta = Readonly<{
  x: number
  y: number
}>

export type NormalizedSize = Readonly<{
  width: number
  height: number
}>

export type ConfirmedRectangleRedaction = Readonly<{
  id: string
  kind: 'rectangle'
  status: 'confirmed'
  x: number
  y: number
  width: number
  height: number
  color: `#${string}`
  opacity: 1
}>

export type ConfirmRectangleInput = Readonly<{
  id: string
  start: NormalizedPoint
  end: NormalizedPoint
  color?: `#${string}`
}>

const opaqueRgbColor = /^#[0-9a-f]{6}$/i

export function confirmRectangle({
  id,
  start,
  end,
  color = '#000000',
}: ConfirmRectangleInput): ConfirmedRectangleRedaction {
  if (id.trim().length === 0) {
    throw new Error('A confirmed redaction requires an identifier.')
  }

  assertNormalizedPoint(start)
  assertNormalizedPoint(end)

  if (!opaqueRgbColor.test(color)) {
    throw new Error('A confirmed redaction requires an opaque RGB color.')
  }

  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)

  if (width === 0 || height === 0) {
    throw new Error('A confirmed rectangle must cover a non-zero area.')
  }

  return {
    id,
    kind: 'rectangle',
    status: 'confirmed',
    x,
    y,
    width,
    height,
    color,
    opacity: 1,
  }
}

export function moveRectangle(
  rectangle: ConfirmedRectangleRedaction,
  delta: NormalizedDelta,
): ConfirmRectangleInput {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new Error('A rectangle movement requires finite coordinates.')
  }

  const x = clamp(rectangle.x + delta.x, 0, 1 - rectangle.width)
  const y = clamp(rectangle.y + delta.y, 0, 1 - rectangle.height)
  return {
    id: rectangle.id,
    start: { x, y },
    end: { x: x + rectangle.width, y: y + rectangle.height },
    color: rectangle.color,
  }
}

export function resizeRectangle(
  rectangle: ConfirmedRectangleRedaction,
  delta: NormalizedDelta,
  minimum: NormalizedSize,
): ConfirmRectangleInput {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new Error('A rectangle resize requires finite coordinates.')
  }
  if (
    !Number.isFinite(minimum.width) ||
    minimum.width <= 0 ||
    minimum.width > 1 - rectangle.x ||
    !Number.isFinite(minimum.height) ||
    minimum.height <= 0 ||
    minimum.height > 1 - rectangle.y
  ) {
    throw new Error('A rectangle resize requires a valid minimum size.')
  }

  const width = clamp(rectangle.width + delta.x, minimum.width, 1 - rectangle.x)
  const height = clamp(
    rectangle.height + delta.y,
    minimum.height,
    1 - rectangle.y,
  )
  return {
    id: rectangle.id,
    start: { x: rectangle.x, y: rectangle.y },
    end: { x: rectangle.x + width, y: rectangle.y + height },
    color: rectangle.color,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function assertNormalizedPoint(point: NormalizedPoint): void {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.x > 1 ||
    point.y < 0 ||
    point.y > 1
  ) {
    throw new Error('Redaction coordinates must be finite values from 0 to 1.')
  }
}
