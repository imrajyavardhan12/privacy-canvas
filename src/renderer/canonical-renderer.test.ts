import { describe, expect, it } from 'vitest'

import {
  createCanonicalRenderPlan,
  createPreviewRenderPlan,
  renderCanonicalRgba,
} from './canonical-renderer'

describe('canonical renderer', () => {
  it('replaces exactly the canonical pixels covered by a confirmed rectangle', () => {
    const plan = createCanonicalRenderPlan({
      dimensions: { width: 4, height: 3 },
      redactions: [
        {
          id: 'redaction-1',
          kind: 'rectangle',
          status: 'confirmed',
          x: 0.25,
          y: 1 / 3,
          width: 0.5,
          height: 1 / 3,
          color: '#d23b31',
          opacity: 1,
        },
      ],
    })
    const source = new Uint8Array(
      Array.from({ length: 12 }, () => [255, 255, 255, 255]).flat(),
    )

    const rendered = renderCanonicalRgba(
      { dimensions: { width: 4, height: 3 }, rgba: source },
      plan,
    )

    expect(rendered).toEqual({
      dimensions: { width: 4, height: 3 },
      rgba: new Uint8Array([
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 210, 59, 49, 255, 210, 59, 49, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255,
      ]),
    })
  })

  it('rounds fractional edges outward and preserves exact document boundaries', () => {
    const plan = createCanonicalRenderPlan({
      dimensions: { width: 10, height: 10 },
      redactions: [
        {
          id: 'fractional',
          kind: 'rectangle',
          status: 'confirmed',
          x: 0.21,
          y: 0.31,
          width: 0.2,
          height: 0.2,
          color: '#000000',
          opacity: 1,
        },
        {
          id: 'bottom-right-pixel',
          kind: 'rectangle',
          status: 'confirmed',
          x: 0.9,
          y: 0.9,
          width: 0.1,
          height: 0.1,
          color: '#ffffff',
          opacity: 1,
        },
      ],
    })

    expect(plan.redactions).toEqual([
      {
        id: 'fractional',
        x: 2,
        y: 3,
        width: 3,
        height: 3,
        color: '#000000',
      },
      {
        id: 'bottom-right-pixel',
        x: 9,
        y: 9,
        width: 1,
        height: 1,
        color: '#ffffff',
      },
    ])
  })

  it('applies overlapping confirmed redactions in Working Document order', () => {
    const plan = createCanonicalRenderPlan({
      dimensions: { width: 3, height: 1 },
      redactions: [
        {
          id: 'first',
          kind: 'rectangle',
          status: 'confirmed',
          x: 0,
          y: 0,
          width: 2 / 3,
          height: 1,
          color: '#000000',
          opacity: 1,
        },
        {
          id: 'second',
          kind: 'rectangle',
          status: 'confirmed',
          x: 1 / 3,
          y: 0,
          width: 2 / 3,
          height: 1,
          color: '#d23b31',
          opacity: 1,
        },
      ],
    })

    const rendered = renderCanonicalRgba(
      {
        dimensions: { width: 3, height: 1 },
        rgba: new Uint8Array([
          255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        ]),
      },
      plan,
    )

    expect(rendered.rgba).toEqual(
      new Uint8Array([0, 0, 0, 255, 210, 59, 49, 255, 210, 59, 49, 255]),
    )
  })

  it('does not mutate or alias the retained source pixels', () => {
    const source = new Uint8Array([255, 255, 255, 255])
    const plan = createCanonicalRenderPlan({
      dimensions: { width: 1, height: 1 },
      redactions: [
        {
          id: 'only-pixel',
          kind: 'rectangle',
          status: 'confirmed',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          color: '#000000',
          opacity: 1,
        },
      ],
    })

    const rendered = renderCanonicalRgba(
      { dimensions: { width: 1, height: 1 }, rgba: source },
      plan,
    )

    expect(source).toEqual(new Uint8Array([255, 255, 255, 255]))
    expect(rendered.rgba).not.toBe(source)
  })

  it('maps canonical mask coverage outward onto a reduced preview', () => {
    const canonical = createCanonicalRenderPlan({
      dimensions: { width: 100, height: 50 },
      redactions: [
        {
          id: 'redaction-1',
          kind: 'rectangle',
          status: 'confirmed',
          x: 0.11,
          y: 0.22,
          width: 0.1,
          height: 0.2,
          color: '#000000',
          opacity: 1,
        },
      ],
    })

    const preview = createPreviewRenderPlan(canonical, {
      width: 10,
      height: 5,
    })

    expect(preview).toEqual({
      dimensions: { width: 10, height: 5 },
      redactions: [
        {
          id: 'redaction-1',
          x: 1,
          y: 1,
          width: 2,
          height: 2,
          color: '#000000',
        },
      ],
    })
  })

  it('keeps preview dimensions from changing canonical output dimensions', () => {
    const canonical = createCanonicalRenderPlan({
      dimensions: { width: 1_000, height: 500 },
      redactions: [],
    })

    const preview = createPreviewRenderPlan(canonical, {
      width: 100,
      height: 50,
    })

    expect(preview.dimensions).toEqual({ width: 100, height: 50 })
    expect(canonical.dimensions).toEqual({ width: 1_000, height: 500 })
  })

  it('rejects a forged pixel plan that bypasses normalized-state validation', () => {
    expect(() =>
      renderCanonicalRgba(
        {
          dimensions: { width: 1, height: 1 },
          rgba: new Uint8Array([255, 255, 255, 255]),
        },
        {
          dimensions: { width: 1, height: 1 },
          redactions: [
            {
              id: 'forged',
              x: -1,
              y: 0,
              width: 2,
              height: 1,
              color: '#000000',
            },
          ],
        },
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid-render-plan' }))
  })

  it('snapshots a mutable source view before validating and copying pixels', () => {
    const opaque = new Uint8Array([255, 255, 255, 255])
    const transparent = new Uint8Array([255, 255, 255, 0])
    let reads = 0
    const source = {
      dimensions: { width: 1, height: 1 },
      get rgba(): Uint8Array<ArrayBuffer> {
        reads += 1
        return reads <= 7 ? opaque : transparent
      },
    }
    const plan = createCanonicalRenderPlan({
      dimensions: { width: 1, height: 1 },
      redactions: [],
    })

    const rendered = renderCanonicalRgba(source, plan)

    expect(rendered.rgba).toEqual(opaque)
    expect(reads).toBe(1)
  })

  it('rejects shared, non-owned, or transparent source pixels', () => {
    const shared = new Uint8Array(new SharedArrayBuffer(4))
    shared.set([0, 0, 0, 255])
    const plan = createCanonicalRenderPlan({
      dimensions: { width: 1, height: 1 },
      redactions: [],
    })

    expect(() =>
      renderCanonicalRgba(
        {
          dimensions: { width: 1, height: 1 },
          rgba: shared as unknown as Uint8Array<ArrayBuffer>,
        },
        plan,
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid-source-pixels' }))
  })

  it('rejects source pixels with non-canonical dimensions or transparency', () => {
    const plan = createCanonicalRenderPlan({
      dimensions: { width: 1, height: 1 },
      redactions: [],
    })

    expect(() =>
      renderCanonicalRgba(
        {
          dimensions: { width: 2, height: 1 },
          rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
        },
        plan,
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'render-dimensions-mismatch' }),
    )
    expect(() =>
      renderCanonicalRgba(
        {
          dimensions: { width: 1, height: 1 },
          rgba: new Uint8Array([0, 0, 0, 254]),
        },
        plan,
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid-source-pixels' }))
  })

  it('rejects a render plan containing a non-opaque redaction', () => {
    expect(() =>
      createCanonicalRenderPlan({
        dimensions: { width: 4, height: 3 },
        redactions: [
          {
            id: 'redaction-1',
            kind: 'rectangle',
            status: 'confirmed',
            x: 0.25,
            y: 1 / 3,
            width: 0.5,
            height: 1 / 3,
            color: '#000000',
            opacity: 0.5,
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-render-plan' }))
  })

  it('rejects duplicate identifiers and excessive rasterization work', () => {
    const redaction = {
      id: 'duplicate',
      kind: 'rectangle',
      status: 'confirmed',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: '#000000',
      opacity: 1,
    } as const

    expect(() =>
      createCanonicalRenderPlan({
        dimensions: { width: 2, height: 2 },
        redactions: [redaction, redaction],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-render-plan' }))
    expect(() =>
      createCanonicalRenderPlan({
        dimensions: { width: 8_192, height: 2_929 },
        redactions: [
          redaction,
          { ...redaction, id: 'second-full-image-redaction' },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'render-resource-limit' }))
  })
})
