import { describe, expect, it } from 'vitest'

import { viewportPointToDocument } from './coordinates'

describe('viewportPointToDocument', () => {
  it('converts a CSS-scaled pointer position to normalized canonical coordinates', () => {
    const viewport = { left: 100, top: 50, width: 320, height: 240 }

    expect(
      viewportPointToDocument({ clientX: 180, clientY: 230 }, viewport),
    ).toEqual({ x: 0.25, y: 0.75 })

    expect(
      viewportPointToDocument({ clientX: 500, clientY: 20 }, viewport),
    ).toEqual({ x: 1, y: 0 })
  })
})
