import { encodeRgbaPng, type RenderedRgbaPixels } from '../encoder/png-encoder'
import {
  createPngVerificationPolicy,
  PngVerificationError,
  verifyPng,
  type PngVerificationPolicy,
  type PngVerificationReport,
} from '../verifier/png-verifier'

const verifiedPngBrand: unique symbol = Symbol('VerifiedPng')

export type VerifiedPng = Readonly<{
  blob: Blob
  verification: PngVerificationReport
  [verifiedPngBrand]: true
}>

export type PngSanitizationPolicy = PngVerificationPolicy

export async function createVerifiedPng(
  renderedPixels: RenderedRgbaPixels,
  policy: PngSanitizationPolicy,
): Promise<VerifiedPng> {
  const verificationPolicy = createPngVerificationPolicy(policy)
  const dimensions = renderedPixels.dimensions
  const rgba = renderedPixels.rgba
  const renderedDimensions = Object.freeze({
    width: dimensions.width,
    height: dimensions.height,
  })
  if (
    renderedDimensions.width !== verificationPolicy.expectedDimensions.width ||
    renderedDimensions.height !== verificationPolicy.expectedDimensions.height
  ) {
    throw new PngVerificationError(
      'dimensions-mismatch',
      'Rendered pixels do not match the independent verification dimensions.',
    )
  }
  const encoded = await encodeRgbaPng({
    dimensions: verificationPolicy.expectedDimensions,
    rgba,
  })
  const verification = await verifyPng(encoded, verificationPolicy)
  const blob = new Blob([encoded], { type: 'image/png' })
  return Object.freeze({
    blob,
    verification,
    [verifiedPngBrand]: true,
  })
}
