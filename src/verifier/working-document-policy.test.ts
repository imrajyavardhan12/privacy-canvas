import { describe, expect, it } from 'vitest'

import {
  createCanonicalRenderPlan,
  renderCanonicalRgba,
} from '../renderer/canonical-renderer'
import { createVerifiedPng } from '../sanitizer/png-sanitizer'
import { createPngVerificationPolicyFromWorkingDocument } from './working-document-policy'

describe('Working Document PNG verification policy', () => {
  it('independently rounds confirmed rectangle edges outward to required pixels', () => {
    const policy = createPngVerificationPolicyFromWorkingDocument({
      dimensions: { width: 10, height: 10 },
      redactions: [
        {
          id: 'redaction-1',
          kind: 'rectangle',
          status: 'confirmed',
          x: 0.21,
          y: 0.31,
          width: 0.1,
          height: 0.1,
          color: '#173f6b',
          opacity: 1,
        },
      ],
    })

    expect(policy).toEqual({
      expectedDimensions: { width: 10, height: 10 },
      requiredOpaqueRegions: [
        { x: 2, y: 3, width: 2, height: 2, color: '#173f6b' },
      ],
    })
  })

  it('fails with a typed policy error for malformed Working Document state', () => {
    expect(() =>
      createPngVerificationPolicyFromWorkingDocument({
        dimensions: { width: 4, height: 2 },
        redactions: [
          {
            id: 'redaction-1',
            kind: 'rectangle',
            status: 'confirmed',
            x: 0,
            y: 0,
            width: 0.5,
            height: 1,
            color: '#000000',
            opacity: 0,
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-policy' }))
  })

  it('rejects hidden data attached to Working Document arrays', () => {
    const redactions = Object.assign([], { rgba: new Uint8Array(32) })

    expect(() =>
      createPngVerificationPolicyFromWorkingDocument({
        dimensions: { width: 4, height: 2 },
        redactions,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-policy' }))
  })

  it('independently verifies encoded pixels rendered from the same Working Document', async () => {
    const document = {
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
    } as const
    const rendered = renderCanonicalRgba(
      {
        dimensions: document.dimensions,
        rgba: new Uint8Array([
          255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        ]),
      },
      createCanonicalRenderPlan(document),
    )
    const policy = createPngVerificationPolicyFromWorkingDocument(document)

    await expect(createVerifiedPng(rendered, policy)).resolves.toMatchObject({
      verification: {
        status: 'verified',
        dimensions: { width: 3, height: 1 },
        opaqueRegionsChecked: 2,
      },
    })
  })

  it('rejects excessive ordered mask work even when later masks cover it', () => {
    const redaction = {
      id: 'first',
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
      createPngVerificationPolicyFromWorkingDocument({
        dimensions: { width: 8_192, height: 2_929 },
        redactions: [redaction, { ...redaction, id: 'second' }],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-policy' }))
  })

  it('requires the final visible color where ordered redactions overlap', () => {
    const policy = createPngVerificationPolicyFromWorkingDocument({
      dimensions: { width: 4, height: 2 },
      redactions: [
        {
          id: 'first',
          kind: 'rectangle',
          status: 'confirmed',
          x: 0,
          y: 0,
          width: 0.75,
          height: 1,
          color: '#000000',
          opacity: 1,
        },
        {
          id: 'second',
          kind: 'rectangle',
          status: 'confirmed',
          x: 0.5,
          y: 0,
          width: 0.5,
          height: 1,
          color: '#d23b31',
          opacity: 1,
        },
      ],
    })

    expect(policy.requiredOpaqueRegions).toEqual([
      { x: 0, y: 0, width: 2, height: 2, color: '#000000' },
      { x: 2, y: 0, width: 2, height: 2, color: '#d23b31' },
    ])
  })
})
