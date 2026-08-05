import { describe, expect, it } from 'vitest'

import {
  inspectSourceMedia,
  PROVISIONAL_SOURCE_MEDIA_LIMITS,
  SourceMediaIntakeError,
  type SourceMediaIntakeLimits,
} from './source-media'

const fixtureDataUrls = import.meta.glob('../../tests/fixtures/jpeg/*.jpg', {
  eager: true,
  import: 'default',
  query: '?inline',
}) as Readonly<Record<string, string>>

describe('inspectSourceMedia', () => {
  it('accepts a complete JPEG and reports its encoded and normalized dimensions', () => {
    expect(inspectSourceMedia(fixture('control-valid.jpg'))).toEqual({
      format: 'jpeg',
      encodedDimensions: { width: 64, height: 48 },
      normalizedDimensions: { width: 64, height: 48 },
      orientation: 1,
    })
  })

  it.each(['metadata-rich.jpg', 'metadata-c2pa.jpg'])(
    'accepts a structurally valid metadata-bearing JPEG: %s',
    (name) => {
      expect(inspectSourceMedia(fixture(name))).toEqual({
        format: 'jpeg',
        encodedDimensions: { width: 64, height: 48 },
        normalizedDimensions: { width: 64, height: 48 },
        orientation: 1,
      })
    },
  )

  it('rejects a renamed non-JPEG by its bytes', () => {
    expectFailure('invalid-not-jpeg.jpg', {
      stage: 'intake',
      code: 'unsupported-format',
    })
  })

  it('rejects malformed zero dimensions', () => {
    expectFailure('invalid-zero-dimension.jpg', {
      stage: 'intake',
      code: 'malformed-container',
    })
  })

  it('rejects a truncated JPEG container', () => {
    expectFailure('invalid-truncated.jpg', {
      stage: 'intake',
      code: 'malformed-container',
    })
  })

  it('fails with a typed error for every truncated prefix of a valid JPEG', () => {
    const complete = fixture('control-valid.jpg')
    for (let length = 0; length < complete.length; length += 1) {
      try {
        inspectSourceMedia(complete.subarray(0, length))
        throw new Error(`Accepted a JPEG truncated at byte ${length}.`)
      } catch (error) {
        expect(error, `truncation at byte ${length}`).toBeInstanceOf(
          SourceMediaIntakeError,
        )
      }
    }
  })

  it('never leaks an untyped parser error for single-byte mutations', () => {
    const complete = fixture('control-valid.jpg')
    for (let offset = 0; offset < complete.length; offset += 1) {
      const mutated = complete.slice()
      mutated[offset] = mutated[offset]! ^ 0xff
      try {
        inspectSourceMedia(mutated)
      } catch (error) {
        expect(error, `mutation at byte ${offset}`).toBeInstanceOf(
          SourceMediaIntakeError,
        )
      }
    }
  })

  it('rejects malformed segments even when dimensions and EOI are present', () => {
    const bytes = fixture('control-valid.jpg').slice()
    const huffmanTable = findMarker(bytes, 0xc4)
    bytes[huffmanTable + 2] = 0
    bytes[huffmanTable + 3] = 1

    expectBytesFailure(bytes, {
      stage: 'intake',
      code: 'malformed-container',
    })
  })

  it('rejects an inconsistent JPEG scan component table', () => {
    const bytes = fixture('control-valid.jpg').slice()
    const scan = findMarker(bytes, 0xda)
    bytes[scan + 4] = 0

    expectBytesFailure(bytes, {
      stage: 'intake',
      code: 'malformed-container',
    })
  })

  it('rejects reserved JPEG marker extensions', () => {
    const bytes = fixture('control-valid.jpg').slice()
    const applicationSegment = findMarker(bytes, 0xe0)
    bytes[applicationSegment + 1] = 0xf0

    expectBytesFailure(bytes, {
      stage: 'intake',
      code: 'malformed-container',
    })
  })

  it('rejects a second image frame in the same JPEG marker stream', () => {
    const control = fixture('control-valid.jpg')
    const frameOffset = findMarker(control, 0xc0)
    const frameLength = 2 + readUint16(control, frameOffset + 2)
    const duplicateFrame = control.slice(frameOffset, frameOffset + frameLength)
    const bytes = new Uint8Array(control.length + duplicateFrame.length)
    bytes.set(control.subarray(0, frameOffset), 0)
    bytes.set(duplicateFrame, frameOffset)
    bytes.set(
      control.subarray(frameOffset),
      frameOffset + duplicateFrame.length,
    )

    expectBytesFailure(bytes, {
      stage: 'intake',
      code: 'malformed-container',
    })
  })

  it('rejects concatenated JPEG images even when the final bytes are EOI', () => {
    const control = fixture('control-valid.jpg')
    const concatenated = new Uint8Array(control.length * 2)
    concatenated.set(control, 0)
    concatenated.set(control, control.length)

    expectBytesFailure(concatenated, {
      stage: 'intake',
      code: 'malformed-container',
    })
  })

  it('rejects undeclared bytes after JPEG EOI', () => {
    expectFailure('invalid-trailing-data.jpg', {
      stage: 'intake',
      code: 'malformed-container',
    })
  })

  it('rejects oversized declared dimensions before decode', () => {
    expectFailure('invalid-oversized-dimensions.jpg', {
      stage: 'resource-limit',
      code: 'dimensions-exceeded',
    })
  })

  it('rejects Source Media above the byte budget before parsing', () => {
    expectFailure(
      'control-valid.jpg',
      { stage: 'resource-limit', code: 'input-bytes-exceeded' },
      { ...PROVISIONAL_SOURCE_MEDIA_LIMITS, maxInputBytes: 100 },
    )
  })

  it('rejects declared pixels above the pixel budget before decode', () => {
    expectFailure(
      'control-valid.jpg',
      { stage: 'resource-limit', code: 'pixels-exceeded' },
      { ...PROVISIONAL_SOURCE_MEDIA_LIMITS, maxPixels: 1_000 },
    )
  })

  it('accepts Source Media exactly at every configured resource boundary', () => {
    const bytes = fixture('control-valid.jpg')
    expect(
      inspectSourceMedia(bytes, {
        maxInputBytes: bytes.byteLength,
        maxWidth: 64,
        maxHeight: 48,
        maxPixels: 64 * 48,
      }),
    ).toMatchObject({ format: 'jpeg' })
  })

  it('rejects unsupported animation before JPEG parsing', () => {
    expectFailure('invalid-animated.gif.jpg', {
      stage: 'intake',
      code: 'unsupported-animation',
    })
  })

  it.each([
    [1, 64, 48],
    [2, 64, 48],
    [3, 64, 48],
    [4, 64, 48],
    [5, 48, 64],
    [6, 48, 64],
    [7, 48, 64],
    [8, 48, 64],
  ] as const)(
    'reports EXIF orientation %i and its normalized dimensions',
    (orientation, width, height) => {
      expect(
        inspectSourceMedia(fixture(`orientation-${orientation}.jpg`)),
      ).toEqual({
        format: 'jpeg',
        encodedDimensions: { width: 64, height: 48 },
        normalizedDimensions: { width, height },
        orientation,
      })
    },
  )
})

function expectFailure(
  name: string,
  expected: Readonly<{
    stage: SourceMediaIntakeError['stage']
    code: SourceMediaIntakeError['code']
  }>,
  limits?: SourceMediaIntakeLimits,
): void {
  expectBytesFailure(fixture(name), expected, limits)
}

function expectBytesFailure(
  bytes: Uint8Array,
  expected: Readonly<{
    stage: SourceMediaIntakeError['stage']
    code: SourceMediaIntakeError['code']
  }>,
  limits?: SourceMediaIntakeLimits,
): void {
  try {
    inspectSourceMedia(bytes, limits)
    throw new Error('Expected Source Media to be rejected.')
  } catch (error) {
    expect(error).toBeInstanceOf(SourceMediaIntakeError)
    expect(error).toMatchObject(expected)
  }
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!
}

function findMarker(bytes: Uint8Array, marker: number): number {
  for (let offset = 0; offset < bytes.length - 1; offset += 1) {
    if (bytes[offset] === 0xff && bytes[offset + 1] === marker) return offset
  }
  throw new Error(`Fixture does not contain marker 0x${marker.toString(16)}.`)
}

function fixture(name: string): Uint8Array {
  const dataUrl = fixtureDataUrls[`../../tests/fixtures/jpeg/${name}`]
  const encoded = dataUrl?.split(',', 2)[1]
  if (encoded === undefined)
    throw new Error(`Fixture is not available: ${name}`)

  const binary = atob(encoded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
