import { describe, expect, it } from 'vitest'

import {
  inspectSourceMedia,
  PROVISIONAL_SOURCE_MEDIA_LIMITS,
  SourceMediaIntakeError,
  type MetadataFinding,
  type MetadataRiskCategory,
  type MetadataRiskSummary,
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
      metadataRiskSummary: {
        status: 'inspected',
        groups: [],
      },
    })
  })

  it.each(['metadata-rich.jpg', 'metadata-c2pa.jpg'])(
    'accepts a structurally valid metadata-bearing JPEG: %s',
    (name) => {
      expect(inspectSourceMedia(fixture(name))).toMatchObject({
        format: 'jpeg',
        encodedDimensions: { width: 64, height: 48 },
        normalizedDimensions: { width: 64, height: 48 },
        orientation: 1,
      })
    },
  )

  it('classifies EXIF camera identity values', () => {
    const { metadataRiskSummary } = inspectSourceMedia(
      fixture('metadata-rich.jpg'),
    )
    expect(metadataRiskSummary.groups).toContainEqual({
      category: 'device-identity',
      findings: expect.arrayContaining([
        {
          source: 'exif',
          label: 'Camera make',
          value: 'Privacy Canvas Fixture Camera',
          truncated: false,
        },
        {
          source: 'exif',
          label: 'Camera model',
          value: 'PC-SYNTHETIC-42',
          truncated: false,
        },
        {
          source: 'exif',
          label: 'Camera serial number',
          value: 'PC-SYNTHETIC-0001',
          truncated: false,
        },
      ]),
    })
  })

  it('groups EXIF text from the primary directory by privacy risk', () => {
    const { metadataRiskSummary } = inspectSourceMedia(
      fixture('metadata-rich.jpg'),
    )
    expectMetadataFinding(metadataRiskSummary, 'timestamp', {
      source: 'exif',
      label: 'Modified date',
      value: '2026:08:05 12:34:56',
      truncated: false,
    })
    expectMetadataFinding(metadataRiskSummary, 'creator-contact', {
      source: 'exif',
      label: 'Artist',
      value: 'Fixture Person <fixture@example.invalid>',
      truncated: false,
    })
    expectMetadataFinding(metadataRiskSummary, 'editing-history', {
      source: 'exif',
      label: 'Software',
      value: 'Privacy Canvas Fixture Editor 1.0',
      truncated: false,
    })
    expectMetadataFinding(metadataRiskSummary, 'embedded-text', {
      source: 'exif',
      label: 'Image description',
      value: 'PC-HOSTILE-EXIF <img src=x onerror="globalThis.PC_PWNED=1">',
      truncated: false,
    })
  })

  it('classifies EXIF subdirectory identity, timestamp, and hostile comment values', () => {
    const { metadataRiskSummary } = inspectSourceMedia(
      fixture('metadata-rich.jpg'),
    )
    expectMetadataFinding(metadataRiskSummary, 'timestamp', {
      source: 'exif',
      label: 'Original capture date',
      value: '2026:08:05 12:34:56',
      truncated: false,
    })
    expectMetadataFinding(metadataRiskSummary, 'creator-contact', {
      source: 'exif',
      label: 'Camera owner',
      value: 'Fixture Person',
      truncated: false,
    })
    expectMetadataFinding(metadataRiskSummary, 'embedded-text', {
      source: 'exif',
      label: 'User comment',
      value: 'PC-HOSTILE-EXIF <img src=x onerror="globalThis.PC_PWNED=1">',
      truncated: false,
    })
  })

  it('classifies EXIF GPS coordinates and the embedded thumbnail', () => {
    const { metadataRiskSummary } = inspectSourceMedia(
      fixture('metadata-rich.jpg'),
    )
    expectMetadataFinding(metadataRiskSummary, 'location', {
      source: 'exif',
      label: 'GPS latitude',
      value: '45, 30, 0',
      truncated: false,
    })
    expectMetadataFinding(metadataRiskSummary, 'location', {
      source: 'exif',
      label: 'GPS longitude',
      value: '73, 34, 0',
      truncated: false,
    })
    expectMetadataFinding(metadataRiskSummary, 'embedded-thumbnail', {
      source: 'exif',
      label: 'Embedded JPEG thumbnail',
      value: null,
      truncated: false,
    })
  })

  it('classifies decoded XMP values without interpreting embedded markup', () => {
    const { metadataRiskSummary } = inspectSourceMedia(
      fixture('metadata-rich.jpg'),
    )
    expectMetadataFinding(metadataRiskSummary, 'creator-contact', {
      source: 'xmp',
      label: 'Creator',
      value: 'Fixture Person <fixture@example.invalid>',
      truncated: false,
    })
    expectMetadataFinding(metadataRiskSummary, 'embedded-text', {
      source: 'xmp',
      label: 'Description',
      value: 'PC-HOSTILE-XMP <script>globalThis.PC_PWNED=1</script>',
      truncated: false,
    })
    expectMetadataFinding(metadataRiskSummary, 'timestamp', {
      source: 'xmp',
      label: 'Created date',
      value: '2026-08-05T12:34:56Z',
      truncated: false,
    })
    expectMetadataFinding(metadataRiskSummary, 'editing-history', {
      source: 'xmp',
      label: 'Creator tool',
      value: 'Privacy Canvas Fixture Editor 1.0',
      truncated: false,
    })
  })

  it('classifies IPTC identity, location, timestamp, and hostile caption values', () => {
    const { metadataRiskSummary } = inspectSourceMedia(
      fixture('metadata-rich.jpg'),
    )
    expectMetadataFinding(metadataRiskSummary, 'creator-contact', {
      source: 'iptc',
      label: 'By-line',
      value: 'Fixture Person',
      truncated: false,
    })
    expectMetadataFinding(metadataRiskSummary, 'location', {
      source: 'iptc',
      label: 'City',
      value: 'Fixture City',
      truncated: false,
    })
    expectMetadataFinding(metadataRiskSummary, 'timestamp', {
      source: 'iptc',
      label: 'Date created',
      value: '20260805',
      truncated: false,
    })
    expectMetadataFinding(metadataRiskSummary, 'embedded-text', {
      source: 'iptc',
      label: 'Caption',
      value: 'PC-HOSTILE-IPTC <svg onload=globalThis.PC_PWNED=1>',
      truncated: false,
    })
  })

  it('classifies C2PA/JUMBF data as provenance risk', () => {
    const { metadataRiskSummary } = inspectSourceMedia(
      fixture('metadata-c2pa.jpg'),
    )
    expectMetadataFinding(metadataRiskSummary, 'provenance', {
      source: 'jumbf',
      label: 'C2PA Content Credentials',
      value: null,
      truncated: false,
    })
  })

  it('returns metadata risk groups in stable review order', () => {
    const { groups, status } = inspectSourceMedia(
      fixture('metadata-c2pa.jpg'),
    ).metadataRiskSummary
    expect(status).toBe('inspected')
    expect(groups.map(({ category }) => category)).toEqual([
      'location',
      'device-identity',
      'timestamp',
      'creator-contact',
      'embedded-thumbnail',
      'editing-history',
      'provenance',
      'embedded-text',
    ])
  })

  it('renders control and bidirectional metadata characters visibly', () => {
    const bytes = insertJpegSegment(
      fixture('control-valid.jpg'),
      0xfe,
      new TextEncoder().encode('before\0middle\u202eafter'),
    )
    const { metadataRiskSummary } = inspectSourceMedia(bytes)

    expectMetadataFinding(metadataRiskSummary, 'embedded-text', {
      source: 'jpeg',
      label: 'JPEG comment',
      value: 'before\\u{0000}middle\\u{202e}after',
      truncated: false,
    })
  })

  it('bounds displayed metadata values and reports partial inspection', () => {
    const comment = 'x'.repeat(600)
    const bytes = insertJpegSegment(
      fixture('control-valid.jpg'),
      0xfe,
      new TextEncoder().encode(comment),
    )
    const { metadataRiskSummary } = inspectSourceMedia(bytes)

    expect(metadataRiskSummary.status).toBe('partial')
    expectMetadataFinding(metadataRiskSummary, 'embedded-text', {
      source: 'jpeg',
      label: 'JPEG comment',
      value: `${'x'.repeat(511)}…`,
      truncated: true,
    })
  })

  it('accepts pixels but reports partial inspection for malformed EXIF metadata', () => {
    const bytes = insertJpegSegment(
      fixture('control-valid.jpg'),
      0xe1,
      new TextEncoder().encode('Exif\0\0malformed'),
    )
    const inspection = inspectSourceMedia(bytes)

    expect(inspection.metadataRiskSummary.status).toBe('partial')
    expectMetadataFinding(
      inspection.metadataRiskSummary,
      'unclassified-metadata',
      {
        source: 'exif',
        label: 'Unparsed EXIF metadata',
        value: null,
        truncated: false,
      },
    )
  })

  it('accepts pixels but reports partial inspection for malformed XMP metadata', () => {
    const bytes = insertJpegSegment(
      fixture('control-valid.jpg'),
      0xe1,
      new TextEncoder().encode(
        'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:RDF>',
      ),
    )
    const inspection = inspectSourceMedia(bytes)

    expect(inspection.metadataRiskSummary.status).toBe('partial')
    expectMetadataFinding(
      inspection.metadataRiskSummary,
      'unclassified-metadata',
      {
        source: 'xmp',
        label: 'Unparsed XMP metadata',
        value: null,
        truncated: false,
      },
    )
  })

  it('accepts pixels but reports partial inspection for malformed IPTC metadata', () => {
    const bytes = insertJpegSegment(
      fixture('control-valid.jpg'),
      0xed,
      new TextEncoder().encode('Photoshop 3.0\0broken'),
    )
    const inspection = inspectSourceMedia(bytes)

    expect(inspection.metadataRiskSummary.status).toBe('partial')
    expectMetadataFinding(
      inspection.metadataRiskSummary,
      'unclassified-metadata',
      {
        source: 'iptc',
        label: 'Unparsed IPTC metadata',
        value: null,
        truncated: false,
      },
    )
  })

  it('bounds the total number of metadata findings', () => {
    let bytes = fixture('control-valid.jpg')
    for (let index = 0; index < 70; index += 1) {
      bytes = insertJpegSegment(
        bytes,
        0xfe,
        new TextEncoder().encode(`comment-${index}`),
      )
    }

    const { metadataRiskSummary } = inspectSourceMedia(bytes)
    const findingCount = metadataRiskSummary.groups.reduce(
      (total, group) => total + group.findings.length,
      0,
    )
    expect(metadataRiskSummary.status).toBe('partial')
    expect(findingCount).toBe(64)
  })

  it('reads orientation even after advisory metadata exceeds its budget', () => {
    let bytes = fixture('orientation-6.jpg')
    const largeComment = new Uint8Array(65_531).fill(0x78)
    for (let index = 0; index < 17; index += 1) {
      bytes = insertJpegSegment(bytes, 0xfe, largeComment, 0xe1)
    }

    const inspection = inspectSourceMedia(bytes)
    expect(inspection.orientation).toBe(6)
    expect(inspection.normalizedDimensions).toEqual({ width: 48, height: 64 })
    expect(inspection.metadataRiskSummary.status).toBe('partial')
  })

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

  it.each(['metadata-rich.jpg', 'metadata-c2pa.jpg'])(
    'never leaks an untyped metadata parser error for sampled mutations: %s',
    (name) => {
      const complete = fixture(name)
      for (let offset = 0; offset < complete.length; offset += 251) {
        const mutated = complete.slice()
        mutated[offset] = mutated[offset]! ^ 0xff
        try {
          inspectSourceMedia(mutated)
        } catch (error) {
          expect(error, `${name} mutation at byte ${offset}`).toBeInstanceOf(
            SourceMediaIntakeError,
          )
        }
      }
    },
  )

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
        metadataRiskSummary: {
          status: 'inspected',
          groups: [],
        },
      })
    },
  )
})

function expectMetadataFinding(
  summary: MetadataRiskSummary,
  category: MetadataRiskCategory,
  finding: MetadataFinding,
): void {
  expect(summary.groups).toContainEqual({
    category,
    findings: expect.arrayContaining([finding]),
  })
}

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

function insertJpegSegment(
  jpeg: Uint8Array,
  marker: number,
  payload: Uint8Array,
  beforeMarker = 0xc0,
): Uint8Array {
  const frameOffset = findMarker(jpeg, beforeMarker)
  const segment = new Uint8Array(payload.length + 4)
  segment[0] = 0xff
  segment[1] = marker
  const length = payload.length + 2
  segment[2] = length >>> 8
  segment[3] = length & 0xff
  segment.set(payload, 4)

  const result = new Uint8Array(jpeg.length + segment.length)
  result.set(jpeg.subarray(0, frameOffset), 0)
  result.set(segment, frameOffset)
  result.set(jpeg.subarray(frameOffset), frameOffset + segment.length)
  return result
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
