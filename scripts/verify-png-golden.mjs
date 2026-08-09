import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDirectory = join(repositoryRoot, 'tests/fixtures/png')
const manifest = JSON.parse(
  await readFile(join(fixtureDirectory, 'manifest.json'), 'utf8'),
)

if (manifest.version !== 1 || manifest.goldens?.length !== 1) {
  throw new Error('The verified PNG manifest shape is invalid.')
}

const golden = manifest.goldens[0]
const outputPath = join(fixtureDirectory, golden.file)
const sourcePath = join(fixtureDirectory, golden.source)
const [output, source] = await Promise.all([
  readFile(outputPath),
  readFile(sourcePath),
])
assertDigest(output, golden.sha256, golden.file)
assertDigest(source, golden.sourceSha256, golden.source)
assertStrictPng(output, golden)
verifyWithExifTool(outputPath, golden)
verifyWithC2paTool(outputPath, golden)

const exifToolVersion = execFileSync('exiftool', ['-ver'], {
  encoding: 'utf8',
}).trim()
const c2paToolVersion = execFileSync('c2patool', ['--version'], {
  encoding: 'utf8',
}).trim()
console.log(
  `Verified ${golden.file} with ExifTool ${exifToolVersion} and ${c2paToolVersion}.`,
)

function assertDigest(bytes, expected, label) {
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) {
    throw new Error(
      `${label} SHA-256 mismatch: expected ${expected}, got ${actual}.`,
    )
  }
}

function assertStrictPng(bytes, golden) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (signature.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('The golden output is not a PNG.')
  }

  const chunkTypes = []
  let offset = signature.length
  let header
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 12) {
      throw new Error('The golden PNG has truncated chunk framing.')
    }
    const length = bytes.readUInt32BE(offset)
    const end = offset + length + 12
    if (end > bytes.byteLength) {
      throw new Error('The golden PNG chunk exceeds the container.')
    }
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    chunkTypes.push(type)
    if (type === 'IHDR') header = bytes.subarray(offset + 8, offset + 21)
    offset = end
  }
  if (offset !== bytes.byteLength) {
    throw new Error('The golden PNG has trailing data.')
  }
  if (JSON.stringify(chunkTypes) !== JSON.stringify(golden.expectedChunks)) {
    throw new Error(`Unexpected PNG chunks: ${chunkTypes.join(', ')}.`)
  }
  if (
    header?.byteLength !== 13 ||
    header.readUInt32BE(0) !== golden.dimensions.width ||
    header.readUInt32BE(4) !== golden.dimensions.height ||
    header[8] !== 8 ||
    header[9] !== 2 ||
    header[10] !== 0 ||
    header[11] !== 0 ||
    header[12] !== 0 ||
    golden.expectedPixelProfile !== 'opaque-rgb8'
  ) {
    throw new Error('The golden PNG dimensions or pixel profile are invalid.')
  }
}

function verifyWithExifTool(path, golden) {
  const output = execFileSync(
    'exiftool',
    [
      '-j',
      '-a',
      '-G1',
      '-s',
      '-EXIF:all',
      '-XMP:all',
      '-IPTC:all',
      '-ICC_Profile:all',
      '-C2PA:all',
      '-PNG:all',
      path,
    ],
    { encoding: 'utf8' },
  )
  const report = JSON.parse(output)[0]
  const expectedKeys = new Set([
    'SourceFile',
    'PNG:ImageWidth',
    'PNG:ImageHeight',
    'PNG:BitDepth',
    'PNG:ColorType',
    'PNG:Compression',
    'PNG:Filter',
    'PNG:Interlace',
  ])
  const unexpected = Object.keys(report).filter((key) => !expectedKeys.has(key))
  if (
    unexpected.length > 0 ||
    report['PNG:ImageWidth'] !== golden.dimensions.width ||
    report['PNG:ImageHeight'] !== golden.dimensions.height ||
    report['PNG:BitDepth'] !== 8 ||
    report['PNG:ColorType'] !== 'RGB' ||
    report['PNG:Interlace'] !== 'Noninterlaced'
  ) {
    throw new Error(
      `ExifTool reported unexpected output metadata: ${unexpected.join(', ') || 'invalid PNG facts'}.`,
    )
  }
}

function verifyWithC2paTool(path, golden) {
  const result = spawnSync('c2patool', [path], { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  const message = `${result.stdout}\n${result.stderr}`
  if (
    golden.expectedC2paClaim !== false ||
    result.status !== 1 ||
    !message.includes('No claim found')
  ) {
    throw new Error(
      `c2patool did not report the expected absence of a claim (exit ${result.status}).`,
    )
  }
}
