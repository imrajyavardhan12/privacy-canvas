export type RequiredOpaqueRegion = Readonly<{
  x: number
  y: number
  width: number
  height: number
  color: `#${string}`
}>

export type PngVerificationPolicy = Readonly<{
  expectedDimensions: Readonly<{ width: number; height: number }>
  requiredOpaqueRegions: readonly RequiredOpaqueRegion[]
}>

export type PngVerificationReport = Readonly<{
  status: 'verified'
  format: 'png'
  dimensions: Readonly<{ width: number; height: number }>
  frameCount: 1
  pixelProfile: 'opaque-rgb8'
  metadataPolicy: 'core-chunks-only'
  metadataClassesChecked: readonly PngMetadataClass[]
  opaqueRegionsChecked: number
}>

export type PngMetadataClass =
  | 'exif'
  | 'gps'
  | 'xmp'
  | 'iptc'
  | 'comments'
  | 'thumbnails'
  | 'color-profiles'
  | 'c2pa'
  | 'other-ancillary-chunks'

export type PngVerificationCode =
  | 'invalid-policy'
  | 'malformed-png'
  | 'dimensions-mismatch'
  | 'forbidden-chunk'
  | 'decode-failed'
  | 'opaque-coverage-failed'

export class PngVerificationError extends Error {
  readonly code: PngVerificationCode

  constructor(
    code: PngVerificationCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'PngVerificationError'
    this.code = code
  }
}

const metadataClassesChecked: readonly PngMetadataClass[] = Object.freeze([
  'exif',
  'gps',
  'xmp',
  'iptc',
  'comments',
  'thumbnails',
  'color-profiles',
  'c2pa',
  'other-ancillary-chunks',
])
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const opaqueRgbColor = /^#[0-9a-f]{6}$/i
const maximumEncodedBytes = 128 * 1024 * 1024
const maximumDimension = 8_192
const maximumPixels = 24_000_000
const verifierCrcTable = createVerifierCrcTable()

type ParsedPng = Readonly<{
  dimensions: Readonly<{ width: number; height: number }>
  compressedPixels: Uint8Array<ArrayBuffer>
}>

/** Snapshots mutable bytes and policy before asynchronous final-output checks. */
export async function verifyPng(
  encoded: Uint8Array,
  policy: PngVerificationPolicy,
): Promise<PngVerificationReport> {
  const ownedPolicy = createPngVerificationPolicy(policy)
  if (
    !(encoded instanceof Uint8Array) ||
    encoded.byteLength > maximumEncodedBytes
  ) {
    throw failure(
      'malformed-png',
      'Encoded PNG bytes exceed the verifier limit.',
    )
  }
  const verifierOwnedBytes = new Uint8Array(encoded)
  const parsed = parseStrictPng(
    verifierOwnedBytes,
    ownedPolicy.expectedDimensions,
  )
  const rgb = await decodeStrictRgb(parsed)
  verifyOpaqueRegions(rgb, parsed.dimensions, ownedPolicy.requiredOpaqueRegions)

  return Object.freeze({
    status: 'verified',
    format: 'png',
    dimensions: parsed.dimensions,
    frameCount: 1,
    pixelProfile: 'opaque-rgb8',
    metadataPolicy: 'core-chunks-only',
    metadataClassesChecked,
    opaqueRegionsChecked: ownedPolicy.requiredOpaqueRegions.length,
  })
}

function parseStrictPng(
  encoded: Uint8Array,
  expectedDimensions: Readonly<{ width: number; height: number }>,
): ParsedPng {
  if (
    encoded.byteLength < pngSignature.length ||
    pngSignature.some((byte, index) => encoded[index] !== byte)
  ) {
    throw failure('malformed-png', 'Encoded output is not a PNG.')
  }

  let offset: number = pngSignature.length
  let dimensions: Readonly<{ width: number; height: number }> | undefined
  let sawIdat = false
  let sawIend = false
  const idatChunks: Uint8Array[] = []
  let compressedByteLength = 0

  while (offset < encoded.byteLength) {
    if (encoded.byteLength - offset < 12) {
      throw failure('malformed-png', 'PNG chunk framing is truncated.')
    }
    const chunkLength = readUint32(encoded, offset)
    const chunkEnd = offset + 12 + chunkLength
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > encoded.byteLength) {
      throw failure('malformed-png', 'PNG chunk length exceeds the container.')
    }
    const typeBytes = encoded.subarray(offset + 4, offset + 8)
    const type = String.fromCharCode(...typeBytes)
    const data = encoded.subarray(offset + 8, offset + 8 + chunkLength)
    const expectedCrc = readUint32(encoded, offset + 8 + chunkLength)
    const actualCrc = verifierCrc32(
      encoded.subarray(offset + 4, offset + 8 + chunkLength),
    )
    if (actualCrc !== expectedCrc) {
      throw failure('malformed-png', 'PNG chunk checksum verification failed.')
    }

    if (type === 'IHDR') {
      if (offset !== pngSignature.length || dimensions !== undefined) {
        throw failure('malformed-png', 'PNG header ordering is invalid.')
      }
      dimensions = readStrictHeader(data, expectedDimensions)
    } else if (type === 'IDAT') {
      if (dimensions === undefined || sawIdat || sawIend) {
        throw failure('malformed-png', 'PNG image-data ordering is invalid.')
      }
      sawIdat = true
      compressedByteLength += data.byteLength
      if (compressedByteLength > maximumEncodedBytes) {
        throw failure(
          'malformed-png',
          'PNG image data exceeds the verifier limit.',
        )
      }
      idatChunks.push(data)
    } else if (type === 'IEND') {
      if (
        dimensions === undefined ||
        !sawIdat ||
        sawIend ||
        data.byteLength !== 0
      ) {
        throw failure('malformed-png', 'PNG end-chunk framing is invalid.')
      }
      sawIend = true
      offset = chunkEnd
      break
    } else {
      throw failure(
        'forbidden-chunk',
        `PNG chunk ${printableChunkType(type)} is not permitted.`,
      )
    }

    offset = chunkEnd
  }

  if (
    dimensions === undefined ||
    !sawIdat ||
    !sawIend ||
    offset !== encoded.byteLength
  ) {
    throw failure(
      'malformed-png',
      'PNG container is incomplete or has trailing data.',
    )
  }

  return {
    dimensions,
    compressedPixels: concatenate(idatChunks, compressedByteLength),
  }
}

function readStrictHeader(
  data: Uint8Array,
  expected: Readonly<{ width: number; height: number }>,
): Readonly<{ width: number; height: number }> {
  if (data.byteLength !== 13) {
    throw failure('malformed-png', 'PNG header length is invalid.')
  }
  const width = readUint32(data, 0)
  const height = readUint32(data, 4)
  if (width !== expected.width || height !== expected.height) {
    throw failure(
      'dimensions-mismatch',
      'PNG dimensions do not match the canonical rendered dimensions.',
    )
  }
  if (
    data[8] !== 8 ||
    data[9] !== 2 ||
    data[10] !== 0 ||
    data[11] !== 0 ||
    data[12] !== 0
  ) {
    throw failure('malformed-png', 'PNG pixel profile is not permitted.')
  }
  return Object.freeze({ width, height })
}

async function decodeStrictRgb(parsed: ParsedPng): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw failure('decode-failed', 'PNG verification is unavailable.')
  }
  const rowBytes = parsed.dimensions.width * 3
  const expectedBytes = (rowBytes + 1) * parsed.dimensions.height
  try {
    const stream = new Blob([parsed.compressedPixels])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'))
    const scanlines = await collectExactStream(stream, expectedBytes)
    const rgb = new Uint8Array(rowBytes * parsed.dimensions.height)
    for (let y = 0; y < parsed.dimensions.height; y += 1) {
      const scanlineOffset = y * (rowBytes + 1)
      if (scanlines[scanlineOffset] !== 0) {
        throw failure('decode-failed', 'PNG scanline filter is not permitted.')
      }
      rgb.set(
        scanlines.subarray(scanlineOffset + 1, scanlineOffset + rowBytes + 1),
        y * rowBytes,
      )
    }
    return rgb
  } catch (error) {
    if (error instanceof PngVerificationError) throw error
    throw failure(
      'decode-failed',
      'PNG pixels could not be decoded safely.',
      error,
    )
  }
}

async function collectExactStream(
  readable: ReadableStream<Uint8Array>,
  expectedBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = readable.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    byteLength += result.value.byteLength
    if (byteLength > expectedBytes) {
      await reader.cancel('Decoded PNG pixels exceeded their exact bound.')
      throw failure(
        'decode-failed',
        'Decoded PNG pixels exceed their exact bound.',
      )
    }
    chunks.push(result.value)
  }
  if (byteLength !== expectedBytes) {
    throw failure('decode-failed', 'Decoded PNG pixel length is invalid.')
  }
  return concatenate(chunks, byteLength)
}

function verifyOpaqueRegions(
  rgb: Uint8Array,
  dimensions: Readonly<{ width: number; height: number }>,
  regions: readonly RequiredOpaqueRegion[],
): void {
  for (const region of regions) {
    const [red, green, blue] = parseRgb(region.color)
    for (let y = region.y; y < region.y + region.height; y += 1) {
      for (let x = region.x; x < region.x + region.width; x += 1) {
        const offset = (y * dimensions.width + x) * 3
        if (
          rgb[offset] !== red ||
          rgb[offset + 1] !== green ||
          rgb[offset + 2] !== blue
        ) {
          throw failure(
            'opaque-coverage-failed',
            'Encoded PNG does not fully cover a required opaque region.',
          )
        }
      }
    }
  }
}

export function createPngVerificationPolicy(
  policy: PngVerificationPolicy,
): PngVerificationPolicy {
  if (
    !isRecord(policy) ||
    !isRecord(policy.expectedDimensions) ||
    !Array.isArray(policy.requiredOpaqueRegions) ||
    policy.requiredOpaqueRegions.length > 1_024
  ) {
    throw failure('invalid-policy', 'PNG verification policy is invalid.')
  }
  const width = policy.expectedDimensions.width
  const height = policy.expectedDimensions.height
  if (
    !Number.isSafeInteger(width) ||
    (width as number) <= 0 ||
    (width as number) > maximumDimension ||
    !Number.isSafeInteger(height) ||
    (height as number) <= 0 ||
    (height as number) > maximumDimension ||
    (width as number) * (height as number) > maximumPixels
  ) {
    throw failure('invalid-policy', 'PNG verification policy is invalid.')
  }

  const dimensions = Object.freeze({
    width: width as number,
    height: height as number,
  })

  let coverageChecks = 0
  const regions: RequiredOpaqueRegion[] = []
  for (const value of policy.requiredOpaqueRegions) {
    if (!isRecord(value)) {
      throw failure('invalid-policy', 'Required opaque region is invalid.')
    }
    const region = Object.freeze({
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      color: value.color,
    })
    if (
      !Number.isSafeInteger(region.x) ||
      (region.x as number) < 0 ||
      !Number.isSafeInteger(region.y) ||
      (region.y as number) < 0 ||
      !Number.isSafeInteger(region.width) ||
      (region.width as number) <= 0 ||
      !Number.isSafeInteger(region.height) ||
      (region.height as number) <= 0 ||
      (region.x as number) + (region.width as number) > width ||
      (region.y as number) + (region.height as number) > height ||
      typeof region.color !== 'string' ||
      !opaqueRgbColor.test(region.color)
    ) {
      throw failure('invalid-policy', 'Required opaque region is invalid.')
    }
    const validatedRegion = region as RequiredOpaqueRegion
    coverageChecks += validatedRegion.width * validatedRegion.height
    if (
      !Number.isSafeInteger(coverageChecks) ||
      coverageChecks > maximumPixels
    ) {
      throw failure(
        'invalid-policy',
        'Required opaque-region checks exceed the verifier limit.',
      )
    }
    regions.push(validatedRegion)
  }

  return Object.freeze({
    expectedDimensions: dimensions,
    requiredOpaqueRegions: Object.freeze(regions),
  })
}

function parseRgb(color: `#${string}`): readonly [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ]
}

function verifierCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = verifierCrcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function createVerifierCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset)
}

function concatenate(
  chunks: readonly Uint8Array[],
  byteLength: number,
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function printableChunkType(type: string): string {
  return /^[\x20-\x7e]{4}$/.test(type) ? type : '(non-printable)'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function failure(
  code: PngVerificationCode,
  message: string,
  cause?: unknown,
): PngVerificationError {
  return new PngVerificationError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  )
}
