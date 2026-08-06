import { describe, expect, it, vi } from 'vitest'

import { encodeRgbaPng } from '../encoder/png-encoder'
import { createVerifiedPng } from './png-sanitizer'
import { verifyPng } from '../verifier/png-verifier'

describe('PNG privacy path', () => {
  it('freshly encodes rendered RGBA pixels and verifies opaque coverage', async () => {
    const encoded = await encodeRgbaPng({
      dimensions: { width: 2, height: 2 },
      rgba: new Uint8Array([
        0, 0, 0, 255, 210, 59, 49, 255, 23, 107, 69, 255, 255, 255, 255, 255,
      ]),
    })

    await expect(
      verifyPng(encoded, {
        expectedDimensions: { width: 2, height: 2 },
        requiredOpaqueRegions: [
          { x: 0, y: 0, width: 1, height: 1, color: '#000000' },
        ],
      }),
    ).resolves.toEqual({
      status: 'verified',
      format: 'png',
      dimensions: { width: 2, height: 2 },
      frameCount: 1,
      pixelProfile: 'opaque-rgb8',
      metadataPolicy: 'core-chunks-only',
      metadataClassesChecked: [
        'exif',
        'gps',
        'xmp',
        'iptc',
        'comments',
        'thumbnails',
        'color-profiles',
        'c2pa',
        'other-ancillary-chunks',
      ],
      opaqueRegionsChecked: 1,
    })
  })

  it('rejects rendered pixel buffers that do not match canonical dimensions', async () => {
    await expect(
      encodeRgbaPng({
        dimensions: { width: 2, height: 2 },
        rgba: new Uint8Array([0, 0, 0, 255]),
      }),
    ).rejects.toMatchObject({ code: 'invalid-rendered-pixels' })
  })

  it('rejects a rendered pixel view that does not own its entire backing buffer', async () => {
    const backing = new Uint8Array([0, 0, 0, 255, 1, 2, 3, 4])

    await expect(
      encodeRgbaPng({
        dimensions: { width: 1, height: 1 },
        rgba: backing.subarray(0, 4),
      }),
    ).rejects.toMatchObject({ code: 'invalid-rendered-pixels' })
    expect(backing.byteLength).toBe(8)
  })

  it('fails closed when platform PNG compression is unavailable', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    try {
      await expect(
        encodeRgbaPng({
          dimensions: { width: 1, height: 1 },
          rgba: new Uint8Array([0, 0, 0, 255]),
        }),
      ).rejects.toMatchObject({ code: 'encoding-unavailable' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('snapshots canonical dimensions before asynchronous encoding', async () => {
    const dimensions = { width: 2, height: 1 }
    const encoding = encodeRgbaPng({
      dimensions,
      rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
    })
    dimensions.width = 1
    dimensions.height = 2

    const encoded = await encoding
    await expect(
      verifyPng(encoded, {
        expectedDimensions: { width: 2, height: 1 },
        requiredOpaqueRegions: [],
      }),
    ).resolves.toMatchObject({ status: 'verified' })
  })

  it('takes ownership of the rendered pixel buffer during encoding', async () => {
    const rgba = new Uint8Array([0, 0, 0, 255])

    await encodeRgbaPng({
      dimensions: { width: 1, height: 1 },
      rgba,
    })

    expect(rgba.byteLength).toBe(0)
  })

  it('emits only core PNG chunks and independently decodable scanlines', async () => {
    const rgba = new Uint8Array([0, 0, 0, 255, 210, 59, 49, 255])
    const expectedRgb = new Uint8Array([0, 0, 0, 210, 59, 49])
    const encoded = await encodeRgbaPng({
      dimensions: { width: 2, height: 1 },
      rgba,
    })
    const chunks = readPngChunksForTest(encoded)

    expect(chunks.map(({ type }) => type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    const compressed = concatenateForTest(
      chunks.filter(({ type }) => type === 'IDAT').map(({ data }) => data),
    )
    const decoded = new Uint8Array(
      await new Response(
        new Blob([compressed])
          .stream()
          .pipeThrough(new DecompressionStream('deflate')),
      ).arrayBuffer(),
    )
    expect(decoded).toEqual(new Uint8Array([0, ...expectedRgb]))
  })

  it('releases an immutable PNG Blob only after verification succeeds', async () => {
    const output = await createVerifiedPng(
      {
        dimensions: { width: 1, height: 1 },
        rgba: new Uint8Array([0, 0, 0, 255]),
      },
      {
        requiredOpaqueRegions: [
          { x: 0, y: 0, width: 1, height: 1, color: '#000000' },
        ],
      },
    )

    expect(output.blob).toBeInstanceOf(Blob)
    expect(output.blob.type).toBe('image/png')
    expect(output.verification.status).toBe('verified')
    expect(Object.isFrozen(output)).toBe(true)
    expect(Object.isFrozen(output.verification)).toBe(true)
    expect(Object.isFrozen(output.verification.dimensions)).toBe(true)
  })

  it('cannot bypass the Sanitizer gate by mutating policy during encoding', async () => {
    const requiredOpaqueRegions = [
      { x: 0, y: 0, width: 1, height: 1, color: '#000000' as const },
    ]
    const sanitization = createVerifiedPng(
      {
        dimensions: { width: 1, height: 1 },
        rgba: new Uint8Array([210, 59, 49, 255]),
      },
      { requiredOpaqueRegions },
    )
    requiredOpaqueRegions.length = 0

    await expect(sanitization).rejects.toMatchObject({
      code: 'opaque-coverage-failed',
    })
  })

  it('does not release a Blob when final verification fails', async () => {
    await expect(
      createVerifiedPng(
        {
          dimensions: { width: 1, height: 1 },
          rgba: new Uint8Array([210, 59, 49, 255]),
        },
        {
          requiredOpaqueRegions: [
            { x: 0, y: 0, width: 1, height: 1, color: '#000000' },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: 'opaque-coverage-failed' })
  })

  it('cannot bypass opaque coverage by mutating policy during verification', async () => {
    const encoded = await encodeRgbaPng({
      dimensions: { width: 1, height: 1 },
      rgba: new Uint8Array([210, 59, 49, 255]),
    })
    const requiredOpaqueRegions = [
      { x: 0, y: 0, width: 1, height: 1, color: '#000000' as const },
    ]

    const verification = verifyPng(encoded, {
      expectedDimensions: { width: 1, height: 1 },
      requiredOpaqueRegions,
    })
    requiredOpaqueRegions.length = 0

    await expect(verification).rejects.toMatchObject({
      code: 'opaque-coverage-failed',
    })
  })

  it('rejects rendered pixels containing any transparency', async () => {
    await expect(
      encodeRgbaPng({
        dimensions: { width: 2, height: 1 },
        rgba: new Uint8Array([0, 0, 0, 255, 210, 59, 49, 254]),
      }),
    ).rejects.toMatchObject({ code: 'transparent-rendered-pixels' })
  })

  it('rejects encoded pixels that do not cover a required opaque region', async () => {
    const encoded = await encodeRgbaPng({
      dimensions: { width: 2, height: 1 },
      rgba: new Uint8Array([0, 0, 0, 255, 210, 59, 49, 255]),
    })

    await expect(
      verifyPng(encoded, {
        expectedDimensions: { width: 2, height: 1 },
        requiredOpaqueRegions: [
          { x: 0, y: 0, width: 2, height: 1, color: '#000000' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'opaque-coverage-failed' })
  })

  it('fails closed when platform PNG decompression is unavailable', async () => {
    const encoded = await encodeRgbaPng({
      dimensions: { width: 1, height: 1 },
      rgba: new Uint8Array([0, 0, 0, 255]),
    })
    vi.stubGlobal('DecompressionStream', undefined)
    try {
      await expect(
        verifyPng(encoded, {
          expectedDimensions: { width: 1, height: 1 },
          requiredOpaqueRegions: [],
        }),
      ).rejects.toMatchObject({ code: 'decode-failed' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a PNG profile that carries an alpha channel', async () => {
    const encoded = await encodeRgbaPng({
      dimensions: { width: 1, height: 1 },
      rgba: new Uint8Array([0, 0, 0, 255]),
    })
    const withAlphaProfile = concatenateForTest([
      encoded.subarray(0, 8),
      ...readPngChunksForTest(encoded).map(({ type, data }) => {
        const changed = data.slice()
        if (type === 'IHDR') changed[9] = 6
        return createPngChunkForTest(type, changed)
      }),
    ])

    await expect(
      verifyPng(withAlphaProfile, {
        expectedDimensions: { width: 1, height: 1 },
        requiredOpaqueRegions: [],
      }),
    ).rejects.toMatchObject({ code: 'malformed-png' })
  })

  it('rejects output dimensions that differ from the canonical render', async () => {
    const encoded = await encodeRgbaPng({
      dimensions: { width: 2, height: 1 },
      rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
    })

    await expect(
      verifyPng(encoded, {
        expectedDimensions: { width: 1, height: 2 },
        requiredOpaqueRegions: [],
      }),
    ).rejects.toMatchObject({ code: 'dimensions-mismatch' })
  })

  it('rejects verification policies whose total coverage work exceeds the pixel budget', async () => {
    await expect(
      verifyPng(new Uint8Array(), {
        expectedDimensions: { width: 8_192, height: 2_929 },
        requiredOpaqueRegions: [
          {
            x: 0,
            y: 0,
            width: 8_192,
            height: 2_929,
            color: '#000000',
          },
          { x: 0, y: 0, width: 6_000, height: 1, color: '#000000' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid-policy' })
  })

  it('rejects multiple image-data chunks outside the generated PNG profile', async () => {
    const encoded = await encodeRgbaPng({
      dimensions: { width: 1, height: 1 },
      rgba: new Uint8Array([0, 0, 0, 255]),
    })
    const chunks = readPngChunksForTest(encoded)
    const duplicateIdat = concatenateForTest([
      encoded.subarray(0, 8),
      ...chunks.flatMap(({ type, data }) =>
        type === 'IDAT'
          ? [
              createPngChunkForTest(type, data),
              createPngChunkForTest(type, data),
            ]
          : [createPngChunkForTest(type, data)],
      ),
    ])

    await expect(
      verifyPng(duplicateIdat, {
        expectedDimensions: { width: 1, height: 1 },
        requiredOpaqueRegions: [],
      }),
    ).rejects.toMatchObject({ code: 'malformed-png' })
  })

  it('rejects trailing data inside the compressed PNG stream', async () => {
    const encoded = await encodeRgbaPng({
      dimensions: { width: 1, height: 1 },
      rgba: new Uint8Array([0, 0, 0, 255]),
    })
    const contaminated = concatenateForTest([
      encoded.subarray(0, 8),
      ...readPngChunksForTest(encoded).map(({ type, data }) =>
        createPngChunkForTest(
          type,
          type === 'IDAT'
            ? concatenateForTest([data, new Uint8Array([1])])
            : data,
        ),
      ),
    ])

    await expect(
      verifyPng(contaminated, {
        expectedDimensions: { width: 1, height: 1 },
        requiredOpaqueRegions: [],
      }),
    ).rejects.toMatchObject({ code: 'decode-failed' })
  })

  it('rejects malformed compressed pixel data', async () => {
    const encoded = await encodeRgbaPng({
      dimensions: { width: 1, height: 1 },
      rgba: new Uint8Array([0, 0, 0, 255]),
    })
    const malformed = concatenateForTest([
      encoded.subarray(0, 8),
      ...readPngChunksForTest(encoded).map(({ type, data }) =>
        createPngChunkForTest(
          type,
          type === 'IDAT' ? new Uint8Array([1, 2, 3]) : data,
        ),
      ),
    ])

    await expect(
      verifyPng(malformed, {
        expectedDimensions: { width: 1, height: 1 },
        requiredOpaqueRegions: [],
      }),
    ).rejects.toMatchObject({ code: 'decode-failed' })
  })

  it('rejects trailing bytes after the PNG end chunk', async () => {
    const encoded = await encodeRgbaPng({
      dimensions: { width: 1, height: 1 },
      rgba: new Uint8Array([0, 0, 0, 255]),
    })
    const trailing = concatenateForTest([encoded, new Uint8Array([1])])

    await expect(
      verifyPng(trailing, {
        expectedDimensions: { width: 1, height: 1 },
        requiredOpaqueRegions: [],
      }),
    ).rejects.toMatchObject({ code: 'malformed-png' })
  })

  it('rejects a PNG with a corrupted chunk checksum', async () => {
    const encoded = await encodeRgbaPng({
      dimensions: { width: 1, height: 1 },
      rgba: new Uint8Array([0, 0, 0, 255]),
    })
    const corrupted = encoded.slice()
    corrupted[corrupted.byteLength - 1]! ^= 1

    await expect(
      verifyPng(corrupted, {
        expectedDimensions: { width: 1, height: 1 },
        requiredOpaqueRegions: [],
      }),
    ).rejects.toMatchObject({ code: 'malformed-png' })
  })

  it('rejects a PNG containing a forbidden textual metadata chunk', async () => {
    const encoded = await encodeRgbaPng({
      dimensions: { width: 1, height: 1 },
      rgba: new Uint8Array([0, 0, 0, 255]),
    })
    const textChunk = createPngChunkForTest(
      'tEXt',
      new TextEncoder().encode('SourceComment\0private location'),
    )
    const contaminated = concatenateForTest([
      encoded.subarray(0, encoded.byteLength - 12),
      textChunk,
      encoded.subarray(encoded.byteLength - 12),
    ])

    await expect(
      verifyPng(contaminated, {
        expectedDimensions: { width: 1, height: 1 },
        requiredOpaqueRegions: [],
      }),
    ).rejects.toMatchObject({
      code: 'forbidden-chunk',
    })
  })
})

function readPngChunksForTest(
  encoded: Uint8Array,
): ReadonlyArray<Readonly<{ type: string; data: Uint8Array }>> {
  const chunks: Array<Readonly<{ type: string; data: Uint8Array }>> = []
  let offset = 8
  while (offset < encoded.byteLength) {
    const length = new DataView(
      encoded.buffer,
      encoded.byteOffset,
      encoded.byteLength,
    ).getUint32(offset)
    const type = String.fromCharCode(
      ...encoded.subarray(offset + 4, offset + 8),
    )
    chunks.push({
      type,
      data: encoded.subarray(offset + 8, offset + 8 + length),
    })
    offset += length + 12
  }
  return chunks
}

function createPngChunkForTest(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(data.byteLength + 12)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.byteLength)
  for (let index = 0; index < 4; index += 1) {
    chunk[4 + index] = type.charCodeAt(index)
  }
  chunk.set(data, 8)
  view.setUint32(
    data.byteLength + 8,
    testCrc32(chunk.subarray(4, data.byteLength + 8)),
  )
  return chunk
}

function testCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function concatenateForTest(
  chunks: readonly Uint8Array[],
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  )
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
