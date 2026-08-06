import type { NormalizedPoint } from '../document/redaction'

export type ViewportPoint = Readonly<{
  clientX: number
  clientY: number
}>

export type ViewportBounds = Readonly<{
  left: number
  top: number
  width: number
  height: number
}>

export function viewportPointToDocument(
  point: ViewportPoint,
  viewport: ViewportBounds,
): NormalizedPoint {
  if (
    !Number.isFinite(point.clientX) ||
    !Number.isFinite(point.clientY) ||
    !Number.isFinite(viewport.left) ||
    !Number.isFinite(viewport.top) ||
    !Number.isFinite(viewport.width) ||
    viewport.width <= 0 ||
    !Number.isFinite(viewport.height) ||
    viewport.height <= 0
  ) {
    throw new Error('Viewport geometry must contain finite positive bounds.')
  }

  return {
    x: clamp((point.clientX - viewport.left) / viewport.width),
    y: clamp((point.clientY - viewport.top) / viewport.height),
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}
