import { describe, expect, it } from 'vitest'

import { confirmRectangle } from './redaction'

describe('confirmRectangle', () => {
  it('normalizes drag direction and produces an opaque confirmed redaction', () => {
    expect(
      confirmRectangle({
        id: 'redaction-1',
        start: { x: 0.8, y: 0.7 },
        end: { x: 0.2, y: 0.1 },
      }),
    ).toEqual({
      id: 'redaction-1',
      kind: 'rectangle',
      status: 'confirmed',
      x: 0.2,
      y: 0.1,
      width: 0.6000000000000001,
      height: 0.6,
      color: '#000000',
      opacity: 1,
    })
  })

  it.each(['#00000000', '#000', 'rgba(0, 0, 0, 0.5)'])(
    'rejects a non-opaque color: %s',
    (color) => {
      expect(() =>
        confirmRectangle({
          id: 'redaction-1',
          start: { x: 0, y: 0 },
          end: { x: 1, y: 1 },
          color: color as `#${string}`,
        }),
      ).toThrow('opaque RGB color')
    },
  )

  it('rejects coordinates outside the normalized document', () => {
    expect(() =>
      confirmRectangle({
        id: 'redaction-1',
        start: { x: -0.1, y: 0 },
        end: { x: 1, y: 1 },
      }),
    ).toThrow('from 0 to 1')
  })

  it('rejects a zero-area rectangle', () => {
    expect(() =>
      confirmRectangle({
        id: 'redaction-1',
        start: { x: 0.5, y: 0.5 },
        end: { x: 0.5, y: 0.8 },
      }),
    ).toThrow('non-zero area')
  })
})
