import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const corpusDirectory = join(repositoryRoot, 'tests/fixtures/jpeg')
const manifestPath = join(corpusDirectory, 'manifest.json')

const expectedOrientationCorners = {
  1: ['red', 'green', 'blue', 'yellow'],
  2: ['green', 'red', 'yellow', 'blue'],
  3: ['yellow', 'blue', 'green', 'red'],
  4: ['blue', 'yellow', 'red', 'green'],
  5: ['red', 'blue', 'green', 'yellow'],
  6: ['blue', 'red', 'yellow', 'green'],
  7: ['yellow', 'green', 'blue', 'red'],
  8: ['green', 'yellow', 'red', 'blue'],
}

const requiredRisks = new Set([
  'creator-contact',
  'device-identity',
  'editing-history',
  'embedded-thumbnail',
  'hostile-text',
  'location',
  'provenance',
  'timestamp',
])

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
assert(manifest.schemaVersion === 1, 'fixture manifest schemaVersion must be 1')
assert(
  manifest.license === 'Apache-2.0',
  'fixtures must declare Apache-2.0 licensing',
)
assert(
  Array.isArray(manifest.fixtures),
  'fixture manifest must contain a fixtures array',
)

const declaredNames = new Set()
const coveredRisks = new Set()
const orientations = new Set()
let acceptedControlCount = 0
let hostileSourceNameCount = 0
let renamedNonJpegCount = 0
let animatedCount = 0
let truncatedCount = 0
let malformedDimensionCount = 0
let oversizedDimensionCount = 0

for (const fixture of manifest.fixtures) {
  assert(typeof fixture.file === 'string', 'every fixture must declare a file')
  assert(
    !declaredNames.has(fixture.file),
    `duplicate fixture declaration: ${fixture.file}`,
  )
  declaredNames.add(fixture.file)

  const fixturePath = join(corpusDirectory, fixture.file)
  const bytes = await readFile(fixturePath)
  const digest = createHash('sha256').update(bytes).digest('hex')
  assert(
    digest === fixture.sha256,
    `${fixture.file} does not match its manifest digest`,
  )

  const detectedType = sniffMediaType(bytes)
  assert(
    detectedType === fixture.detectedType,
    `${fixture.file} has unexpected magic bytes`,
  )

  const markers =
    detectedType === 'image/jpeg' ? parseJpegMarkers(bytes) : undefined
  if (markers && fixture.width !== undefined && fixture.height !== undefined) {
    const dimensions = readJpegDimensions(markers)
    assert(
      dimensions.width === fixture.width &&
        dimensions.height === fixture.height,
      `${fixture.file} has unexpected JPEG dimensions`,
    )
  }

  if (fixture.sourceName !== undefined) {
    assert(
      fixture.sourceName.includes('PC-HOSTILE-NAME') &&
        fixture.sourceName.endsWith('.jpg'),
      `${fixture.file} has an invalid hostile source name`,
    )
    hostileSourceNameCount += 1
  }

  if (fixture.disposition === 'accept') {
    acceptedControlCount += fixture.purpose === 'valid-control' ? 1 : 0
    assert(
      detectedType === 'image/jpeg',
      `${fixture.file} is accepted but is not a JPEG`,
    )
    assert(
      bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9])),
      `${fixture.file} is accepted but has no terminal EOI marker`,
    )
  }

  if (fixture.orientation !== undefined) {
    assert(markers, `${fixture.file} declares orientation but is not JPEG`)
    const orientation = readExifOrientation(markers)
    assert(
      orientation === fixture.orientation,
      `${fixture.file} has EXIF orientation ${orientation}`,
    )
    const swapsAxes = orientation >= 5
    assert(
      fixture.normalizedWidth ===
        (swapsAxes ? fixture.height : fixture.width) &&
        fixture.normalizedHeight ===
          (swapsAxes ? fixture.width : fixture.height),
      `${fixture.file} has incorrect normalized dimensions`,
    )
    assert(
      JSON.stringify(fixture.expectedCorners) ===
        JSON.stringify(expectedOrientationCorners[orientation]),
      `${fixture.file} has incorrect normalized corner expectations`,
    )
    orientations.add(orientation)
  }

  for (const risk of fixture.metadataRisks ?? []) {
    coveredRisks.add(risk)
  }

  if (fixture.metadataRisks?.includes('embedded-thumbnail')) {
    assert(
      markers,
      `${fixture.file} declares JPEG metadata risks but is not JPEG`,
    )
    assert(
      hasMarkerPrefix(markers, 0xe1, 'Exif\0\0'),
      `${fixture.file} is missing EXIF`,
    )
    assert(
      hasMarkerPrefix(markers, 0xe1, 'http://ns.adobe.com/xap/1.0/\0'),
      `${fixture.file} is missing XMP`,
    )
    assert(
      hasMarkerPrefix(markers, 0xed, 'Photoshop 3.0\0'),
      `${fixture.file} is missing IPTC`,
    )
    for (const sentinel of [
      'PC-HOSTILE-',
      'PC-SYNTHETIC-0001',
      'Fixture Person',
      'Privacy Canvas Fixture Editor',
      '2026:08:05 12:34:56',
    ]) {
      assert(
        bytes.includes(Buffer.from(sentinel, 'utf8')),
        `${fixture.file} is missing metadata sentinel: ${sentinel}`,
      )
    }
    const exif = markers.find(
      ({ marker, payload }) =>
        marker === 0xe1 &&
        payload.subarray(0, 6).equals(Buffer.from('Exif\0\0')),
    )
    assert(
      exif?.payload.includes(Buffer.from([0xff, 0xd8, 0xff])),
      `${fixture.file} is missing a thumbnail`,
    )
  }

  if (fixture.purpose === 'c2pa-provenance') {
    assert(markers, `${fixture.file} declares C2PA provenance but is not JPEG`)
    assert(
      hasMarkerPrefix(markers, 0xeb, 'JP'),
      `${fixture.file} is missing JPEG JUMBF APP11 data`,
    )
  }

  if (fixture.failure === 'unsupported-animation') {
    assert(
      countByte(bytes, 0x2c) === 2,
      `${fixture.file} must contain exactly two GIF frames`,
    )
  }
  if (fixture.failure === 'truncated-container') {
    assert(
      bytes.lastIndexOf(Buffer.from([0xff, 0xd9])) === -1,
      `${fixture.file} unexpectedly contains EOI`,
    )
  }
  if (fixture.failure === 'unexpected-trailing-data') {
    const eoiOffset = bytes.lastIndexOf(Buffer.from([0xff, 0xd9]))
    assert(
      eoiOffset >= 0 && eoiOffset < bytes.length - 2,
      `${fixture.file} has no trailing bytes after EOI`,
    )
  }

  renamedNonJpegCount += fixture.failure === 'magic-byte-mismatch' ? 1 : 0
  animatedCount += fixture.failure === 'unsupported-animation' ? 1 : 0
  truncatedCount += fixture.failure === 'truncated-container' ? 1 : 0
  malformedDimensionCount += fixture.failure === 'malformed-dimensions' ? 1 : 0
  oversizedDimensionCount +=
    fixture.failure === 'resource-limit-dimensions' ? 1 : 0
}

const filesOnDisk = (await readdir(corpusDirectory, { withFileTypes: true }))
  .filter(
    (entry) =>
      entry.isFile() &&
      entry.name !== 'README.md' &&
      entry.name !== 'manifest.json',
  )
  .map((entry) => entry.name)
  .sort()
const filesInManifest = [...declaredNames].sort()
assert(
  JSON.stringify(filesOnDisk) === JSON.stringify(filesInManifest),
  'fixture files and manifest declarations differ',
)

assert(
  acceptedControlCount >= 1,
  'corpus requires a metadata-free valid JPEG control',
)
assert(hostileSourceNameCount >= 1, 'corpus requires a hostile source filename')
assert(renamedNonJpegCount >= 1, 'corpus requires a renamed non-JPEG')
assert(animatedCount >= 1, 'corpus requires an animated non-JPEG')
assert(truncatedCount >= 1, 'corpus requires a truncated JPEG')
assert(
  malformedDimensionCount >= 1,
  'corpus requires malformed JPEG dimensions',
)
assert(
  oversizedDimensionCount >= 1,
  'corpus requires oversized declared JPEG dimensions',
)
assert(
  JSON.stringify([...orientations].sort()) ===
    JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]),
  'corpus requires EXIF orientations 1 through 8',
)
assert(
  [...requiredRisks].every((risk) => coveredRisks.has(risk)),
  `corpus does not cover every metadata risk: ${[...requiredRisks]
    .filter((risk) => !coveredRisks.has(risk))
    .join(', ')}`,
)

console.log(
  `Verified ${manifest.fixtures.length} synthetic fixtures from ${relative(repositoryRoot, manifestPath)}.`,
)

function sniffMediaType(bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return 'image/jpeg'
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return 'image/png'
  if (
    bytes
      .subarray(0, 6)
      .toString('ascii')
      .match(/^GIF8[79]a$/)
  )
    return 'image/gif'
  return 'unknown'
}

function parseJpegMarkers(bytes) {
  assert(
    bytes.readUInt16BE(0) === 0xffd8,
    'JPEG marker parsing requires an SOI marker',
  )
  const markers = []
  let offset = 2

  while (offset < bytes.length) {
    assert(
      bytes[offset] === 0xff,
      `invalid JPEG marker prefix at byte ${offset}`,
    )
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    assert(marker !== undefined, 'truncated JPEG marker')
    offset += 1

    if (marker === 0xd9) break
    if (marker === 0xda) {
      assert(offset + 2 <= bytes.length, 'truncated SOS length')
      const length = bytes.readUInt16BE(offset)
      assert(
        length >= 2 && offset + length <= bytes.length,
        'invalid SOS length',
      )
      markers.push({
        marker,
        payload: bytes.subarray(offset + 2, offset + length),
      })
      break
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue

    assert(offset + 2 <= bytes.length, 'truncated JPEG segment length')
    const length = bytes.readUInt16BE(offset)
    assert(
      length >= 2 && offset + length <= bytes.length,
      'invalid JPEG segment length',
    )
    markers.push({
      marker,
      payload: bytes.subarray(offset + 2, offset + length),
    })
    offset += length
  }

  return markers
}

function readJpegDimensions(markers) {
  const startOfFrame = markers.find(({ marker }) =>
    [
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
      0xcf,
    ].includes(marker),
  )
  assert(
    startOfFrame && startOfFrame.payload.length >= 5,
    'missing JPEG dimensions',
  )
  return {
    height: startOfFrame.payload.readUInt16BE(1),
    width: startOfFrame.payload.readUInt16BE(3),
  }
}

function readExifOrientation(markers) {
  const segment = markers.find(
    ({ marker, payload }) =>
      marker === 0xe1 && payload.subarray(0, 6).equals(Buffer.from('Exif\0\0')),
  )
  assert(segment, 'missing EXIF APP1 segment')

  const tiff = segment.payload.subarray(6)
  const byteOrder = tiff.subarray(0, 2).toString('ascii')
  assert(byteOrder === 'II' || byteOrder === 'MM', 'invalid TIFF byte order')
  const littleEndian = byteOrder === 'II'
  const read16 = (offset) =>
    littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset)
  const read32 = (offset) =>
    littleEndian ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset)
  assert(read16(2) === 42, 'invalid TIFF marker')

  const ifdOffset = read32(4)
  const entryCount = read16(ifdOffset)
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    if (read16(entryOffset) === 0x0112) {
      assert(
        read16(entryOffset + 2) === 3,
        'EXIF orientation must use SHORT type',
      )
      return read16(entryOffset + 8)
    }
  }
  return undefined
}

function hasMarkerPrefix(markers, marker, prefix) {
  const expected = Buffer.from(prefix, 'utf8')
  return markers.some(
    (segment) =>
      segment.marker === marker &&
      segment.payload.subarray(0, expected.length).equals(expected),
  )
}

function countByte(bytes, expected) {
  let count = 0
  for (const byte of bytes) count += byte === expected ? 1 : 0
  return count
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
