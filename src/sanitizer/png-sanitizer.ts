import { encodeRgbaPng, type RenderedRgbaPixels } from '../encoder/png-encoder'
import {
  createPngVerificationPolicy,
  verifyPng,
  type PngVerificationReport,
  type RequiredOpaqueRegion,
} from '../verifier/png-verifier'

const verifiedPngBrand: unique symbol = Symbol('VerifiedPng')

export type VerifiedPng = Readonly<{
  blob: Blob
  verification: PngVerificationReport
  [verifiedPngBrand]: true
}>

export type PngSanitizationPolicy = Readonly<{
  requiredOpaqueRegions: readonly RequiredOpaqueRegion[]
}>

export async function createVerifiedPng(
  renderedPixels: RenderedRgbaPixels,
  policy: PngSanitizationPolicy,
): Promise<VerifiedPng> {
  const expectedDimensions = Object.freeze({
    width: renderedPixels.dimensions.width,
    height: renderedPixels.dimensions.height,
  })
  const verificationPolicy = createPngVerificationPolicy({
    expectedDimensions,
    requiredOpaqueRegions: policy.requiredOpaqueRegions,
  })
  const encoded = await encodeRgbaPng({
    dimensions: expectedDimensions,
    rgba: renderedPixels.rgba,
  })
  const verification = await verifyPng(encoded, verificationPolicy)
  const blob = new Blob([encoded], { type: 'image/png' })
  return Object.freeze({
    blob,
    verification,
    [verifiedPngBrand]: true,
  })
}
