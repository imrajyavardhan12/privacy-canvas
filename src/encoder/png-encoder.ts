export type PngEncodingCode =
  | 'invalid-rendered-pixels'
  | 'transparent-rendered-pixels'
  | 'encoding-unavailable'
  | 'compression-failed'
  | 'encoded-bytes-exceeded'

export class PngEncodingError extends Error {
  readonly code: PngEncodingCode

  constructor(code: PngEncodingCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PngEncodingError'
    this.code = code
  }
}

export type RenderedRgbaPixels = Readonly<{
  dimensions: Readonly<{ width: number; height: number }>
  rgba: Uint8Array<ArrayBuffer>
}>

const pngSignature = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])
const maximumDimension = 8_192
const maximumPixels = 24_000_000

/**
 * Takes ownership of a dedicated rendered-pixel buffer. Once validation passes,
 * the caller's RGBA view is detached even if platform compression later fails.
 */
export async function encodeRgbaPng({
  dimensions,
  rgba,
}: RenderedRgbaPixels): Promise<Uint8Array<ArrayBuffer>> {
  const canonicalDimensions = Object.freeze({
    width: dimensions.width,
    height: dimensions.height,
  })
  assertRenderedPixels(canonicalDimensions, rgba)
  const ownedRgba = takeRenderedPixelOwnership(rgba)

  const ihdr = new Uint8Array(13)
  const header = new DataView(ihdr.buffer)
  header.setUint32(0, canonicalDimensions.width)
  header.setUint32(4, canonicalDimensions.height)
  ihdr[8] = 8 // Eight bits per channel.
  ihdr[9] = 2 // Opaque RGB; the format carries no alpha channel.
  ihdr[10] = 0 // Deflate compression.
  ihdr[11] = 0 // PNG filters.
  ihdr[12] = 0 // No interlace.

  let compressed: Uint8Array<ArrayBuffer>
  try {
    compressed = await compressScanlines(canonicalDimensions, ownedRgba)
  } catch (error) {
    if (error instanceof PngEncodingError) throw error
    throw new PngEncodingError(
      'compression-failed',
      'Rendered pixels could not be compressed safely.',
      { cause: error },
    )
  } finally {
    ownedRgba.fill(0)
  }
  return concatenate([
    pngSignature,
    createChunk('IHDR', ihdr),
    createChunk('IDAT', compressed),
    createChunk('IEND', new Uint8Array()),
  ])
}

async function compressScanlines(
  dimensions: Readonly<{ width: number; height: number }>,
  rgba: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof CompressionStream === 'undefined') {
    throw new PngEncodingError(
      'encoding-unavailable',
      'PNG encoding is unavailable in this environment.',
    )
  }

  const stream = new CompressionStream('deflate')
  const filteredBytes =
    dimensions.width * dimensions.height * 3 + dimensions.height
  const maximumCompressedBytes =
    filteredBytes +
    dimensions.height * 6 +
    Math.ceil(filteredBytes / 16_384) * 8 +
    64
  const compressed = collectStream(stream.readable, maximumCompressedBytes)
  const writer = stream.writable.getWriter()
  const sourceRowBytes = dimensions.width * 4
  const encodedRowBytes = dimensions.width * 3
  try {
    for (let y = 0; y < dimensions.height; y += 1) {
      const scanline = new Uint8Array(encodedRowBytes + 1)
      const sourceRowOffset = y * sourceRowBytes
      for (let x = 0; x < dimensions.width; x += 1) {
        const sourceOffset = sourceRowOffset + x * 4
        const encodedOffset = 1 + x * 3
        scanline[encodedOffset] = rgba[sourceOffset]!
        scanline[encodedOffset + 1] = rgba[sourceOffset + 1]!
        scanline[encodedOffset + 2] = rgba[sourceOffset + 2]!
      }
      await writer.write(scanline)
    }
    await writer.close()
    return await compressed
  } catch (error) {
    await writer.abort(error).catch(() => undefined)
    let failure: unknown = error
    await compressed.catch((streamError: unknown) => {
      failure = streamError
    })
    if (failure instanceof PngEncodingError) throw failure
    throw new PngEncodingError(
      'compression-failed',
      'Rendered pixels could not be compressed safely.',
      { cause: failure },
    )
  }
}

async function collectStream(
  readable: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = readable.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    byteLength += result.value.byteLength
    if (byteLength > maximumBytes) {
      await reader.cancel('Compressed PNG data exceeded its safe bound.')
      throw new PngEncodingError(
        'encoded-bytes-exceeded',
        'Compressed PNG data exceeded its safe bound.',
      )
    }
    chunks.push(result.value)
  }
  return concatenate(chunks, byteLength)
}

function createChunk(
  type: 'IHDR' | 'IDAT' | 'IEND',
  data: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const chunk = new Uint8Array(data.byteLength + 12)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.byteLength)
  for (let index = 0; index < 4; index += 1) {
    chunk[4 + index] = type.charCodeAt(index)
  }
  chunk.set(data, 8)
  view.setUint32(
    8 + data.byteLength,
    encoderCrc32(chunk.subarray(4, 8 + data.byteLength)),
  )
  return chunk
}

function encoderCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function concatenate(
  chunks: readonly Uint8Array[],
  knownLength?: number,
): Uint8Array<ArrayBuffer> {
  const byteLength =
    knownLength ?? chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const result = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function takeRenderedPixelOwnership(
  rgba: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  try {
    return structuredClone(rgba, { transfer: [rgba.buffer] })
  } catch (error) {
    throw new PngEncodingError(
      'invalid-rendered-pixels',
      'Rendered RGBA pixel ownership could not be transferred.',
      { cause: error },
    )
  }
}

function assertRenderedPixels(
  dimensions: Readonly<{ width: number; height: number }>,
  rgba: Uint8Array<ArrayBuffer>,
): void {
  const { width, height } = dimensions
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    width > maximumDimension ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    height > maximumDimension ||
    width * height > maximumPixels
  ) {
    throw new PngEncodingError(
      'invalid-rendered-pixels',
      'Rendered pixel dimensions exceed the provisional PNG limits.',
    )
  }
  if (
    !(rgba instanceof Uint8Array) ||
    rgba.byteLength !== width * height * 4 ||
    rgba.byteOffset !== 0 ||
    rgba.buffer.byteLength !== rgba.byteLength
  ) {
    throw new PngEncodingError(
      'invalid-rendered-pixels',
      'Rendered RGBA pixels do not match their dimensions.',
    )
  }
  for (let alphaOffset = 3; alphaOffset < rgba.byteLength; alphaOffset += 4) {
    if (rgba[alphaOffset] !== 255) {
      throw new PngEncodingError(
        'transparent-rendered-pixels',
        'Rendered PNG pixels must be fully opaque.',
      )
    }
  }
}
