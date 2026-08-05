import type {
  MetadataFinding,
  MetadataRiskCategory,
  MetadataRiskGroup,
  MetadataRiskSummary,
  SourceMediaInspection,
} from './source-media'

const metadataInspectionByteBudget = 1024 * 1024
const metadataFindingLimit = 64
const metadataValueCodeUnitLimit = 512

const textEncoder = new TextEncoder()
const utf8Decoder = new TextDecoder()
const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true })
const asciiUserCommentPrefix = textEncoder.encode('ASCII\0\0\0')
const c2paLabel = textEncoder.encode('c2pa')
const tiffTypeSizes = new Map<number, number>([
  [1, 1],
  [2, 1],
  [3, 2],
  [4, 4],
  [5, 8],
  [7, 1],
  [9, 4],
  [10, 8],
])
const xmlNamedEntities = new Map([
  ['amp', '&'],
  ['apos', "'"],
  ['gt', '>'],
  ['lt', '<'],
  ['quot', '"'],
])

/**
 * Advisory source inspection only. Findings are bounded plain strings and must
 * still be rendered as text. Export sanitization never depends on this parser.
 */
export class JpegMetadataCollector {
  private readonly metadata = new MetadataAccumulator()
  private inspectedBytes = 0

  inspectApp1(
    payload: Uint8Array,
  ): SourceMediaInspection['orientation'] | undefined {
    const orientation = readExifOrientation(payload)
    if (!this.reserveInspectionBudget(payload.byteLength)) return orientation
    const classifiedOrientation = inspectExifMetadata(payload, this.metadata)
    inspectXmpMetadata(payload, this.metadata)
    return classifiedOrientation ?? orientation
  }

  inspectApp11(payload: Uint8Array): void {
    if (this.reserveInspectionBudget(payload.byteLength)) {
      inspectJumbfMetadata(payload, this.metadata)
    }
  }

  inspectApp13(payload: Uint8Array): void {
    if (this.reserveInspectionBudget(payload.byteLength)) {
      inspectIptcMetadata(payload, this.metadata)
    }
  }

  inspectComment(payload: Uint8Array): void {
    if (!this.reserveInspectionBudget(payload.byteLength)) return
    const value = utf8Decoder.decode(payload)
    if (value.length > 0) {
      this.metadata.add('embedded-text', 'jpeg', 'JPEG comment', value)
    }
  }

  summarize(): MetadataRiskSummary {
    return this.metadata.summarize()
  }

  private reserveInspectionBudget(byteLength: number): boolean {
    if (this.inspectedBytes + byteLength > metadataInspectionByteBudget) {
      this.metadata.markPartial('jpeg', 'Metadata inspection budget exceeded')
      return false
    }
    this.inspectedBytes += byteLength
    return true
  }
}

const primaryExifTextTags = new Map<
  number,
  Readonly<{ category: MetadataRiskCategory; label: string }>
>([
  [0x010e, { category: 'embedded-text', label: 'Image description' }],
  [0x010f, { category: 'device-identity', label: 'Camera make' }],
  [0x0110, { category: 'device-identity', label: 'Camera model' }],
  [0x0131, { category: 'editing-history', label: 'Software' }],
  [0x0132, { category: 'timestamp', label: 'Modified date' }],
  [0x013b, { category: 'creator-contact', label: 'Artist' }],
  [0x8298, { category: 'creator-contact', label: 'Copyright' }],
  [0xc62f, { category: 'device-identity', label: 'Camera serial number' }],
])

const exifSubdirectoryTextTags = new Map<
  number,
  Readonly<{ category: MetadataRiskCategory; label: string }>
>([
  [0x9003, { category: 'timestamp', label: 'Original capture date' }],
  [0x9004, { category: 'timestamp', label: 'Digitized date' }],
  [0xa430, { category: 'creator-contact', label: 'Camera owner' }],
  [0xa431, { category: 'device-identity', label: 'Body serial number' }],
  [0xa434, { category: 'device-identity', label: 'Lens model' }],
  [0xa435, { category: 'device-identity', label: 'Lens serial number' }],
])

const xmpTextProperties: readonly Readonly<{
  category: MetadataRiskCategory
  label: string
  property: string
}>[] = [
  { category: 'creator-contact', label: 'Creator', property: 'dc:creator' },
  {
    category: 'embedded-text',
    label: 'Description',
    property: 'dc:description',
  },
  { category: 'timestamp', label: 'Created date', property: 'xmp:CreateDate' },
  { category: 'timestamp', label: 'Modified date', property: 'xmp:ModifyDate' },
  {
    category: 'editing-history',
    label: 'Creator tool',
    property: 'xmp:CreatorTool',
  },
  {
    category: 'editing-history',
    label: 'Document ID',
    property: 'xmpMM:DocumentID',
  },
  {
    category: 'editing-history',
    label: 'Instance ID',
    property: 'xmpMM:InstanceID',
  },
]

const standardXmpPrefix = textEncoder.encode('http://ns.adobe.com/xap/1.0/\0')
const photoshopResourcePrefix = textEncoder.encode('Photoshop 3.0\0')
const iptcTextDatasets = new Map<
  string,
  Readonly<{ category: MetadataRiskCategory; label: string }>
>([
  ['2:5', { category: 'embedded-text', label: 'Object name' }],
  ['2:55', { category: 'timestamp', label: 'Date created' }],
  ['2:60', { category: 'timestamp', label: 'Time created' }],
  ['2:80', { category: 'creator-contact', label: 'By-line' }],
  ['2:90', { category: 'location', label: 'City' }],
  ['2:92', { category: 'location', label: 'Sublocation' }],
  ['2:95', { category: 'location', label: 'Province or state' }],
  ['2:101', { category: 'location', label: 'Country' }],
  ['2:110', { category: 'creator-contact', label: 'Credit' }],
  ['2:115', { category: 'creator-contact', label: 'Source' }],
  ['2:116', { category: 'creator-contact', label: 'Copyright notice' }],
  ['2:118', { category: 'creator-contact', label: 'Contact' }],
  ['2:120', { category: 'embedded-text', label: 'Caption' }],
  ['2:122', { category: 'creator-contact', label: 'Caption writer' }],
])

function inspectJumbfMetadata(
  payload: Uint8Array,
  metadata: MetadataAccumulator,
): void {
  if (
    payload[0] === 0x4a &&
    payload[1] === 0x50 &&
    containsBytes(payload, c2paLabel)
  ) {
    metadata.add('provenance', 'jumbf', 'C2PA Content Credentials', null)
  }
}

function containsBytes(bytes: Uint8Array, needle: Uint8Array): boolean {
  outer: for (
    let offset = 0;
    offset <= bytes.length - needle.length;
    offset += 1
  ) {
    for (let index = 0; index < needle.length; index += 1) {
      if (bytes[offset + index] !== needle[index]) continue outer
    }
    return true
  }
  return false
}

function inspectIptcMetadata(
  payload: Uint8Array,
  metadata: MetadataAccumulator,
): void {
  if (!startsWithBytes(payload, photoshopResourcePrefix)) return
  let offset = photoshopResourcePrefix.length

  while (offset < payload.length) {
    if (
      payload[offset] !== 0x38 ||
      payload[offset + 1] !== 0x42 ||
      payload[offset + 2] !== 0x49 ||
      payload[offset + 3] !== 0x4d
    ) {
      metadata.markPartial('iptc', 'Unparsed IPTC metadata')
      return
    }
    const resourceId = readUint16(payload, offset + 4)
    const nameLength = payload[offset + 6]
    if (resourceId === undefined || nameLength === undefined) {
      metadata.markPartial('iptc', 'Unparsed IPTC metadata')
      return
    }

    const nameFieldLength = 1 + nameLength
    const namePadding = nameFieldLength % 2
    const sizeOffset = offset + 6 + nameFieldLength + namePadding
    const dataLength = readUint32(payload, sizeOffset)
    if (dataLength === undefined) {
      metadata.markPartial('iptc', 'Unparsed IPTC metadata')
      return
    }
    const dataOffset = sizeOffset + 4
    const dataEnd = dataOffset + dataLength
    if (dataEnd > payload.length) {
      metadata.markPartial('iptc', 'Unparsed IPTC metadata')
      return
    }

    if (
      resourceId === 0x0404 &&
      !inspectIptcDatasets(payload.subarray(dataOffset, dataEnd), metadata)
    ) {
      metadata.markPartial('iptc', 'Unparsed IPTC metadata')
    }
    const nextOffset = dataEnd + (dataLength % 2)
    if (nextOffset > payload.length) {
      metadata.markPartial('iptc', 'Unparsed IPTC metadata')
      return
    }
    offset = nextOffset
  }
}

function inspectIptcDatasets(
  bytes: Uint8Array,
  metadata: MetadataAccumulator,
): boolean {
  let offset = 0
  while (offset < bytes.length) {
    if (bytes[offset] !== 0x1c || offset + 5 > bytes.length) return false
    const record = bytes[offset + 1]!
    const dataset = bytes[offset + 2]!
    const dataLength = readUint16(bytes, offset + 3)
    if (dataLength === undefined || (dataLength & 0x8000) !== 0) return false
    const dataOffset = offset + 5
    const dataEnd = dataOffset + dataLength
    if (dataEnd > bytes.length) return false

    const risk = iptcTextDatasets.get(`${record}:${dataset}`)
    if (risk !== undefined && dataLength > 0) {
      const value = utf8Decoder.decode(bytes.subarray(dataOffset, dataEnd))
      if (value.length > 0) {
        metadata.add(risk.category, 'iptc', risk.label, value)
      }
    }
    offset = dataEnd
  }
  return true
}

function inspectXmpMetadata(
  payload: Uint8Array,
  metadata: MetadataAccumulator,
): void {
  if (!startsWithBytes(payload, standardXmpPrefix)) return
  let packet: string
  try {
    packet = strictUtf8Decoder.decode(
      payload.subarray(standardXmpPrefix.length),
    )
  } catch {
    metadata.markPartial('xmp', 'Unparsed XMP metadata')
    return
  }
  const completeXmpMeta =
    packet.includes('<x:xmpmeta') && packet.includes('</x:xmpmeta>')
  const completeRdf =
    packet.includes('<rdf:RDF') && packet.includes('</rdf:RDF>')
  if (!completeXmpMeta && !completeRdf) {
    metadata.markPartial('xmp', 'Unparsed XMP metadata')
    return
  }

  for (const { category, label, property } of xmpTextProperties) {
    const value = extractXmpProperty(packet, property)
    if (value !== undefined) metadata.add(category, 'xmp', label, value)
  }
}

function extractXmpProperty(
  packet: string,
  property: string,
): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const element = new RegExp(
    `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`,
    'i',
  ).exec(packet)
  if (element?.[1] !== undefined) {
    const text = decodeXmlEntities(
      element[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]*>/g, ' '),
    )
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length > 0) return text
  }

  const doubleQuoted = new RegExp(`\\b${escaped}\\s*=\\s*"([^"]*)"`, 'i').exec(
    packet,
  )?.[1]
  const singleQuoted = new RegExp(`\\b${escaped}\\s*=\\s*'([^']*)'`, 'i').exec(
    packet,
  )?.[1]
  const attribute = doubleQuoted ?? singleQuoted
  if (attribute === undefined) return undefined
  const text = decodeXmlEntities(attribute).trim()
  return text.length > 0 ? text : undefined
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|apos|gt|lt|quot);/gi,
    (entity, body: string) => {
      const named = xmlNamedEntities.get(body.toLowerCase())
      if (named !== undefined) return named

      const hexadecimal = body.toLowerCase().startsWith('#x')
      const codePoint = Number.parseInt(
        body.slice(hexadecimal ? 2 : 1),
        hexadecimal ? 16 : 10,
      )
      return Number.isInteger(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity
    },
  )
}

function readExifOrientation(
  payload: Uint8Array,
): SourceMediaInspection['orientation'] | undefined {
  if (
    payload.length < 14 ||
    payload[0] !== 0x45 ||
    payload[1] !== 0x78 ||
    payload[2] !== 0x69 ||
    payload[3] !== 0x66 ||
    payload[4] !== 0 ||
    payload[5] !== 0
  ) {
    return undefined
  }

  const tiff = payload.subarray(6)
  const littleEndian = tiff[0] === 0x49 && tiff[1] === 0x49
  const bigEndian = tiff[0] === 0x4d && tiff[1] === 0x4d
  if (
    (!littleEndian && !bigEndian) ||
    readTiffUint16(tiff, 2, littleEndian) !== 42
  ) {
    return undefined
  }

  const ifdOffset = readTiffUint32(tiff, 4, littleEndian)
  if (ifdOffset === undefined) return undefined
  const entryCount = readTiffUint16(tiff, ifdOffset, littleEndian)
  if (entryCount === undefined) return undefined
  const entriesEnd = ifdOffset + 2 + entryCount * 12
  if (!Number.isSafeInteger(entriesEnd) || entriesEnd > tiff.length)
    return undefined

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    if (readTiffUint16(tiff, entryOffset, littleEndian) !== 0x0112) continue
    if (
      readTiffUint16(tiff, entryOffset + 2, littleEndian) !== 3 ||
      readTiffUint32(tiff, entryOffset + 4, littleEndian) !== 1
    ) {
      return undefined
    }
    const orientation = readTiffUint16(tiff, entryOffset + 8, littleEndian)
    return orientation !== undefined && orientation >= 1 && orientation <= 8
      ? (orientation as SourceMediaInspection['orientation'])
      : undefined
  }
  return undefined
}

function inspectExifMetadata(
  payload: Uint8Array,
  metadata: MetadataAccumulator,
): SourceMediaInspection['orientation'] | undefined {
  const isExif =
    payload.length >= 6 &&
    payload[0] === 0x45 &&
    payload[1] === 0x78 &&
    payload[2] === 0x69 &&
    payload[3] === 0x66 &&
    payload[4] === 0 &&
    payload[5] === 0
  if (!isExif) return undefined
  if (payload.length < 14) {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
    return undefined
  }

  const tiff = payload.subarray(6)
  const littleEndian = tiff[0] === 0x49 && tiff[1] === 0x49
  const bigEndian = tiff[0] === 0x4d && tiff[1] === 0x4d
  if (!littleEndian && !bigEndian) {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
    return undefined
  }

  const read16 = (offset: number): number | undefined =>
    readTiffUint16(tiff, offset, littleEndian)
  const read32 = (offset: number): number | undefined =>
    readTiffUint32(tiff, offset, littleEndian)
  if (read16(2) !== 42) {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
    return undefined
  }

  const ifdOffset = read32(4)
  if (ifdOffset === undefined) {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
    return undefined
  }
  const entryCount = read16(ifdOffset)
  if (entryCount === undefined) {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
    return undefined
  }
  const entriesEnd = ifdOffset + 2 + entryCount * 12
  if (!Number.isSafeInteger(entriesEnd) || entriesEnd > tiff.length) {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
    return undefined
  }

  let exifDirectoryOffset: number | undefined
  let gpsDirectoryOffset: number | undefined
  let orientation: SourceMediaInspection['orientation'] | undefined
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    const tag = read16(entryOffset)
    if (tag === undefined) continue

    const textRisk = primaryExifTextTags.get(tag)
    if (textRisk !== undefined) {
      const value = readTiffTextValue(tiff, entryOffset, littleEndian)
      if (value !== undefined) {
        metadata.add(textRisk.category, 'exif', textRisk.label, value)
      } else {
        metadata.markPartial('exif', 'Unparsed EXIF metadata')
      }
    }

    if (tag === 0x8769) {
      exifDirectoryOffset = readTiffLongScalar(tiff, entryOffset, littleEndian)
      if (exifDirectoryOffset === undefined) {
        metadata.markPartial('exif', 'Unparsed EXIF metadata')
      }
    }
    if (tag === 0x8825) {
      gpsDirectoryOffset = readTiffLongScalar(tiff, entryOffset, littleEndian)
      if (gpsDirectoryOffset === undefined) {
        metadata.markPartial('exif', 'Unparsed EXIF metadata')
      }
    }

    if (tag === 0x0112) {
      if (read16(entryOffset + 2) !== 3 || read32(entryOffset + 4) !== 1) {
        metadata.markPartial('exif', 'Unparsed EXIF metadata')
        continue
      }
      const value = read16(entryOffset + 8)
      if (value !== undefined && value >= 1 && value <= 8) {
        orientation = value as SourceMediaInspection['orientation']
      } else {
        metadata.markPartial('exif', 'Unparsed EXIF metadata')
      }
    }
  }

  if (exifDirectoryOffset !== undefined) {
    inspectExifSubdirectory(tiff, exifDirectoryOffset, littleEndian, metadata)
  }
  if (gpsDirectoryOffset !== undefined) {
    inspectGpsDirectory(tiff, gpsDirectoryOffset, littleEndian, metadata)
  }
  const thumbnailDirectoryOffset = read32(entriesEnd)
  if (thumbnailDirectoryOffset === undefined) {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
  } else if (thumbnailDirectoryOffset !== 0) {
    inspectThumbnailDirectory(
      tiff,
      thumbnailDirectoryOffset,
      littleEndian,
      metadata,
    )
  }
  return orientation
}

function inspectExifSubdirectory(
  tiff: Uint8Array,
  ifdOffset: number,
  littleEndian: boolean,
  metadata: MetadataAccumulator,
): void {
  const entryCount = readTiffUint16(tiff, ifdOffset, littleEndian)
  if (entryCount === undefined) {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
    return
  }
  const entriesEnd = ifdOffset + 2 + entryCount * 12
  if (!Number.isSafeInteger(entriesEnd) || entriesEnd > tiff.length) {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
    return
  }

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    const tag = readTiffUint16(tiff, entryOffset, littleEndian)
    if (tag === undefined) continue

    const textRisk = exifSubdirectoryTextTags.get(tag)
    if (textRisk !== undefined) {
      const value = readTiffTextValue(tiff, entryOffset, littleEndian)
      if (value !== undefined) {
        metadata.add(textRisk.category, 'exif', textRisk.label, value)
      } else {
        metadata.markPartial('exif', 'Unparsed EXIF metadata')
      }
    }

    if (tag === 0x9286) {
      const value = readExifUserComment(tiff, entryOffset, littleEndian)
      if (value !== undefined) {
        metadata.add('embedded-text', 'exif', 'User comment', value)
      } else {
        metadata.markPartial('exif', 'Unparsed EXIF metadata')
      }
    }
  }
}

function inspectGpsDirectory(
  tiff: Uint8Array,
  ifdOffset: number,
  littleEndian: boolean,
  metadata: MetadataAccumulator,
): void {
  const entryCount = readTiffUint16(tiff, ifdOffset, littleEndian)
  if (entryCount === undefined) {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
    return
  }
  const entriesEnd = ifdOffset + 2 + entryCount * 12
  if (!Number.isSafeInteger(entriesEnd) || entriesEnd > tiff.length) {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
    return
  }

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    const tag = readTiffUint16(tiff, entryOffset, littleEndian)
    if (tag === 0x0001 || tag === 0x0003) {
      const value = readTiffTextValue(tiff, entryOffset, littleEndian)
      if (value !== undefined) {
        metadata.add(
          'location',
          'exif',
          tag === 0x0001 ? 'GPS latitude reference' : 'GPS longitude reference',
          value,
        )
      } else {
        metadata.markPartial('exif', 'Unparsed EXIF metadata')
      }
    }
    if (tag === 0x0002 || tag === 0x0004 || tag === 0x0006) {
      const value = readTiffRationalText(tiff, entryOffset, littleEndian)
      if (value !== undefined) {
        const label =
          tag === 0x0002
            ? 'GPS latitude'
            : tag === 0x0004
              ? 'GPS longitude'
              : 'GPS altitude'
        metadata.add('location', 'exif', label, value)
      } else {
        metadata.markPartial('exif', 'Unparsed EXIF metadata')
      }
    }
    if (tag === 0x001d) {
      const value = readTiffTextValue(tiff, entryOffset, littleEndian)
      if (value !== undefined) {
        metadata.add('timestamp', 'exif', 'GPS date', value)
      } else {
        metadata.markPartial('exif', 'Unparsed EXIF metadata')
      }
    }
  }
}

function inspectThumbnailDirectory(
  tiff: Uint8Array,
  ifdOffset: number,
  littleEndian: boolean,
  metadata: MetadataAccumulator,
): void {
  const entryCount = readTiffUint16(tiff, ifdOffset, littleEndian)
  if (entryCount === undefined) {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
    return
  }
  const entriesEnd = ifdOffset + 2 + entryCount * 12
  if (!Number.isSafeInteger(entriesEnd) || entriesEnd > tiff.length) {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
    return
  }

  let thumbnailLength: number | undefined
  let thumbnailOffset: number | undefined
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    const tag = readTiffUint16(tiff, entryOffset, littleEndian)
    if (tag === 0x0201) {
      thumbnailOffset = readTiffLongScalar(tiff, entryOffset, littleEndian)
    }
    if (tag === 0x0202) {
      thumbnailLength = readTiffLongScalar(tiff, entryOffset, littleEndian)
    }
  }

  if (
    thumbnailOffset !== undefined &&
    thumbnailLength !== undefined &&
    thumbnailLength > 0 &&
    thumbnailOffset + thumbnailLength <= tiff.length &&
    readUint16(tiff, thumbnailOffset) === 0xffd8
  ) {
    metadata.add('embedded-thumbnail', 'exif', 'Embedded JPEG thumbnail', null)
  } else {
    metadata.markPartial('exif', 'Unparsed EXIF metadata')
  }
}

function readTiffRationalText(
  tiff: Uint8Array,
  entryOffset: number,
  littleEndian: boolean,
): string | undefined {
  if (readTiffUint16(tiff, entryOffset + 2, littleEndian) !== 5)
    return undefined
  const bytes = readTiffValueBytes(tiff, entryOffset, littleEndian)
  if (bytes === undefined || bytes.length % 8 !== 0) return undefined

  const values: number[] = []
  for (let offset = 0; offset < bytes.length; offset += 8) {
    const numerator = readTiffUint32(bytes, offset, littleEndian)
    const denominator = readTiffUint32(bytes, offset + 4, littleEndian)
    if (
      numerator === undefined ||
      denominator === undefined ||
      denominator === 0
    ) {
      return undefined
    }
    values.push(numerator / denominator)
  }

  if (values.length === 3 && values[2]! >= 59.9995) {
    values[2] = 0
    values[1] = values[1]! + 1
  }
  if (values.length === 3 && values[1]! >= 60) {
    values[1] = 0
    values[0] = values[0]! + 1
  }
  return values.map(formatMetadataNumber).join(', ')
}

function formatMetadataNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(6)))
}

function readTiffLongScalar(
  tiff: Uint8Array,
  entryOffset: number,
  littleEndian: boolean,
): number | undefined {
  const type = readTiffUint16(tiff, entryOffset + 2, littleEndian)
  const count = readTiffUint32(tiff, entryOffset + 4, littleEndian)
  if (type !== 4 || count !== 1) return undefined
  return readTiffUint32(tiff, entryOffset + 8, littleEndian)
}

function readExifUserComment(
  tiff: Uint8Array,
  entryOffset: number,
  littleEndian: boolean,
): string | undefined {
  const value = readTiffValueBytes(tiff, entryOffset, littleEndian)
  if (value === undefined || value.length === 0) return undefined
  if (!startsWithBytes(value, asciiUserCommentPrefix)) return undefined
  const content = value.subarray(8)
  const terminator = content.indexOf(0)
  const text = utf8Decoder.decode(
    terminator >= 0 ? content.subarray(0, terminator) : content,
  )
  return text.length > 0 ? text : undefined
}

function readTiffTextValue(
  tiff: Uint8Array,
  entryOffset: number,
  littleEndian: boolean,
): string | undefined {
  if (readTiffUint16(tiff, entryOffset + 2, littleEndian) !== 2)
    return undefined
  const bytes = readTiffValueBytes(tiff, entryOffset, littleEndian)
  if (bytes === undefined) return undefined

  const terminator = bytes.indexOf(0)
  const text = utf8Decoder.decode(
    terminator >= 0 ? bytes.subarray(0, terminator) : bytes,
  )
  return text.length > 0 ? text : undefined
}

function readTiffValueBytes(
  tiff: Uint8Array,
  entryOffset: number,
  littleEndian: boolean,
): Uint8Array | undefined {
  const type = readTiffUint16(tiff, entryOffset + 2, littleEndian)
  const count = readTiffUint32(tiff, entryOffset + 4, littleEndian)
  if (type === undefined || count === undefined || count === 0) return undefined

  const typeSize = tiffTypeSizes.get(type)
  if (typeSize === undefined) return undefined
  const byteLength = count * typeSize
  if (!Number.isSafeInteger(byteLength) || byteLength > tiff.length)
    return undefined

  const valueOffset =
    byteLength <= 4
      ? entryOffset + 8
      : readTiffUint32(tiff, entryOffset + 8, littleEndian)
  if (valueOffset === undefined || valueOffset + byteLength > tiff.length) {
    return undefined
  }
  return tiff.subarray(valueOffset, valueOffset + byteLength)
}

function startsWithBytes(value: Uint8Array, prefix: Uint8Array): boolean {
  return (
    value.length >= prefix.length &&
    prefix.every((byte, index) => value[index] === byte)
  )
}

class MetadataAccumulator {
  private readonly findings = new Map<MetadataRiskCategory, MetadataFinding[]>()
  private readonly findingKeys = new Set<string>()
  private findingCount = 0
  private partial = false

  add(
    category: MetadataRiskCategory,
    source: MetadataFinding['source'],
    label: string,
    value: string | null,
  ): void {
    const limited = limitMetadataValue(value)
    if (limited.truncated) this.partial = true
    const key = `${category}\0${source}\0${label}\0${limited.value ?? ''}`
    if (this.findingKeys.has(key)) return
    if (this.findingCount >= metadataFindingLimit) {
      this.partial = true
      return
    }
    this.findingKeys.add(key)
    this.findingCount += 1
    const finding: MetadataFinding = {
      source,
      label,
      value: limited.value,
      truncated: limited.truncated,
    }
    const findings = this.findings.get(category)
    if (findings) findings.push(finding)
    else this.findings.set(category, [finding])
  }

  markPartial(source: MetadataFinding['source'], label: string): void {
    this.partial = true
    this.add('unclassified-metadata', source, label, null)
  }

  summarize(): MetadataRiskSummary {
    const groups: MetadataRiskGroup[] = []
    for (const category of metadataCategoryOrder) {
      const findings = this.findings.get(category)
      if (findings && findings.length > 0) groups.push({ category, findings })
    }
    return { status: this.partial ? 'partial' : 'inspected', groups }
  }
}

const metadataCategoryOrder: readonly MetadataRiskCategory[] = [
  'location',
  'device-identity',
  'timestamp',
  'creator-contact',
  'embedded-thumbnail',
  'editing-history',
  'provenance',
  'embedded-text',
  'unclassified-metadata',
]

function limitMetadataValue(value: string | null): Readonly<{
  value: string | null
  truncated: boolean
}> {
  if (value === null) return { value, truncated: false }
  const visible = makeMetadataControlsVisible(value)
  if (visible.length <= metadataValueCodeUnitLimit) {
    return { value: visible, truncated: false }
  }
  let prefix = visible.slice(0, metadataValueCodeUnitLimit - 1)
  const lastCodeUnit = prefix.charCodeAt(prefix.length - 1)
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    prefix = prefix.slice(0, -1)
  }
  return { value: `${prefix}…`, truncated: true }
}

function makeMetadataControlsVisible(value: string): string {
  let visible = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    const hiddenControl =
      (codePoint >= 0 && codePoint <= 8) ||
      codePoint === 11 ||
      codePoint === 12 ||
      (codePoint >= 14 && codePoint <= 31) ||
      codePoint === 127 ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    visible += hiddenControl
      ? `\\u{${codePoint.toString(16).padStart(4, '0')}}`
      : character
  }
  return visible
}

function readTiffUint16(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
): number | undefined {
  if (offset < 0 || offset + 2 > bytes.length) return undefined
  return littleEndian
    ? bytes[offset]! | (bytes[offset + 1]! << 8)
    : (bytes[offset]! << 8) | bytes[offset + 1]!
}

function readTiffUint32(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
): number | undefined {
  if (offset < 0 || offset + 4 > bytes.length) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4)
  return view.getUint32(0, littleEndian)
}

function readUint32(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 4 > bytes.length) return undefined
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0)
}

function readUint16(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 2 > bytes.length) return undefined
  return (bytes[offset]! << 8) | bytes[offset + 1]!
}
