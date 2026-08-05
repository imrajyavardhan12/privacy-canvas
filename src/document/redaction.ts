export type NormalizedPoint = Readonly<{
  x: number
  y: number
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

type ConfirmRectangleInput = Readonly<{
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
