import {
  confirmRectangle,
  type ConfirmedRectangleRedaction,
  type ConfirmRectangleInput,
} from './redaction'

export type DocumentDimensions = Readonly<{
  width: number
  height: number
}>

export type WorkingDocumentOperation = Readonly<
  | {
      type: 'add'
      redaction: ConfirmedRectangleRedaction
    }
  | {
      type: 'update'
      redaction: ConfirmedRectangleRedaction
    }
  | {
      type: 'remove'
      id: string
    }
>

export type WorkingDocument = Readonly<{
  dimensions: DocumentDimensions
  redactions: readonly ConfirmedRectangleRedaction[]
  operations: readonly WorkingDocumentOperation[]
  historyPosition: number
}>

export type WorkingDocumentCommand = Readonly<
  | ({ type: 'add-rectangle' } & ConfirmRectangleInput)
  | ({ type: 'update-rectangle' } & ConfirmRectangleInput)
  | { type: 'remove-redaction'; id: string }
>

export function createWorkingDocument(
  dimensions: DocumentDimensions,
): WorkingDocument {
  assertDocumentDimensions(dimensions)
  return {
    dimensions: { ...dimensions },
    redactions: [],
    operations: [],
    historyPosition: 0,
  }
}

export function applyWorkingDocumentCommand(
  document: WorkingDocument,
  command: WorkingDocumentCommand,
): WorkingDocument {
  const existingIndex = document.redactions.findIndex(
    ({ id }) => id === command.id,
  )
  if (command.type === 'remove-redaction') {
    if (existingIndex === -1) {
      throw new Error('The redaction to remove does not exist.')
    }
    return {
      dimensions: document.dimensions,
      redactions: document.redactions.filter(({ id }) => id !== command.id),
      operations: [
        ...document.operations.slice(0, document.historyPosition),
        { type: 'remove', id: command.id },
      ],
      historyPosition: document.historyPosition + 1,
    }
  }

  if (command.type === 'add-rectangle' && existingIndex !== -1) {
    throw new Error('A redaction with this identifier already exists.')
  }
  if (command.type === 'update-rectangle' && existingIndex === -1) {
    throw new Error('The redaction to update does not exist.')
  }

  const redaction = confirmRectangle({
    ...command,
    color:
      command.color ??
      (existingIndex === -1
        ? '#000000'
        : (document.redactions[existingIndex]?.color ?? '#000000')),
  })
  assertMinimumRectangleSize(redaction, document.dimensions)
  const existing = document.redactions[existingIndex]
  if (
    command.type === 'update-rectangle' &&
    existing !== undefined &&
    rectanglesAreEqual(existing, redaction)
  ) {
    return document
  }
  const operation: WorkingDocumentOperation = {
    type: command.type === 'add-rectangle' ? 'add' : 'update',
    redaction,
  }
  const redactions = [...document.redactions]
  if (existingIndex === -1) redactions.push(redaction)
  else redactions[existingIndex] = redaction

  return {
    dimensions: document.dimensions,
    redactions,
    operations: [
      ...document.operations.slice(0, document.historyPosition),
      operation,
    ],
    historyPosition: document.historyPosition + 1,
  }
}

export function undoWorkingDocument(
  document: WorkingDocument,
): WorkingDocument {
  if (document.historyPosition === 0) return document
  return moveHistoryPosition(document, document.historyPosition - 1)
}

export function redoWorkingDocument(
  document: WorkingDocument,
): WorkingDocument {
  if (document.historyPosition === document.operations.length) return document
  return moveHistoryPosition(document, document.historyPosition + 1)
}

function moveHistoryPosition(
  document: WorkingDocument,
  historyPosition: number,
): WorkingDocument {
  return {
    dimensions: document.dimensions,
    redactions: replayOperations(document.operations, historyPosition),
    operations: document.operations,
    historyPosition,
  }
}

function replayOperations(
  operations: readonly WorkingDocumentOperation[],
  historyPosition: number,
): readonly ConfirmedRectangleRedaction[] {
  const redactions: ConfirmedRectangleRedaction[] = []
  for (const operation of operations.slice(0, historyPosition)) {
    const existingIndex = redactions.findIndex(
      ({ id }) =>
        id ===
        (operation.type === 'remove' ? operation.id : operation.redaction.id),
    )
    if (operation.type === 'add') {
      if (existingIndex !== -1) throw new Error('Invalid operation history.')
      redactions.push(operation.redaction)
    } else if (operation.type === 'update') {
      if (existingIndex === -1) throw new Error('Invalid operation history.')
      redactions[existingIndex] = operation.redaction
    } else {
      if (existingIndex === -1) throw new Error('Invalid operation history.')
      redactions.splice(existingIndex, 1)
    }
  }
  return redactions
}

const canonicalPixelTolerance = 1e-9

export function rectangleCoversMinimumSourcePixel(
  rectangle: ConfirmedRectangleRedaction,
  dimensions: DocumentDimensions,
): boolean {
  return (
    rectangle.width * dimensions.width >= 1 - canonicalPixelTolerance &&
    rectangle.height * dimensions.height >= 1 - canonicalPixelTolerance
  )
}

function assertMinimumRectangleSize(
  rectangle: ConfirmedRectangleRedaction,
  dimensions: DocumentDimensions,
): void {
  if (!rectangleCoversMinimumSourcePixel(rectangle, dimensions)) {
    throw new Error(
      'A confirmed rectangle must cover at least one source pixel per axis.',
    )
  }
}

function rectanglesAreEqual(
  first: ConfirmedRectangleRedaction,
  second: ConfirmedRectangleRedaction,
): boolean {
  return (
    first.id === second.id &&
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height &&
    first.color === second.color
  )
}

function assertDocumentDimensions(dimensions: DocumentDimensions): void {
  if (
    !Number.isSafeInteger(dimensions.width) ||
    dimensions.width <= 0 ||
    !Number.isSafeInteger(dimensions.height) ||
    dimensions.height <= 0
  ) {
    throw new Error('Working Document dimensions must be positive integers.')
  }
}
