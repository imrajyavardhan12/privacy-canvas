import { describe, expect, it } from 'vitest'

import {
  applyWorkingDocumentCommand,
  createWorkingDocument,
  redoWorkingDocument,
  undoWorkingDocument,
} from './working-document'

describe('Working Document', () => {
  it('adds one opaque rectangle as a canonical document operation', () => {
    const initial = createWorkingDocument({ width: 640, height: 480 })

    const edited = applyWorkingDocumentCommand(initial, {
      type: 'add-rectangle',
      id: 'redaction-1',
      start: { x: 0.25, y: 0.2 },
      end: { x: 0.75, y: 0.8 },
    })

    expect(initial.redactions).toEqual([])
    expect(edited.dimensions).toEqual({ width: 640, height: 480 })
    expect(edited.redactions).toEqual([
      {
        id: 'redaction-1',
        kind: 'rectangle',
        status: 'confirmed',
        x: 0.25,
        y: 0.2,
        width: 0.5,
        height: 0.6000000000000001,
        color: '#000000',
        opacity: 1,
      },
    ])
    expect(edited.operations).toEqual([
      {
        type: 'add',
        redaction: edited.redactions[0],
      },
    ])
    expect(edited.historyPosition).toBe(1)
  })

  it('rejects a rectangle smaller than one canonical source pixel', () => {
    const document = createWorkingDocument({ width: 100, height: 50 })

    expect(() =>
      applyWorkingDocumentCommand(document, {
        type: 'add-rectangle',
        id: 'redaction-1',
        start: { x: 0, y: 0 },
        end: { x: 0.009, y: 0.02 },
      }),
    ).toThrow('at least one source pixel')
  })

  it('accepts a one-source-pixel rectangle despite floating-point roundoff', () => {
    const document = createWorkingDocument({ width: 64, height: 48 })

    expect(() =>
      applyWorkingDocumentCommand(document, {
        type: 'add-rectangle',
        id: 'redaction-1',
        start: { x: 0.11, y: 0.17 },
        end: { x: 0.11 + 1 / 64, y: 0.17 + 1 / 48 },
      }),
    ).not.toThrow()
  })

  it('updates an existing rectangle without changing its identity or opacity', () => {
    const added = applyWorkingDocumentCommand(
      createWorkingDocument({ width: 640, height: 480 }),
      {
        type: 'add-rectangle',
        id: 'redaction-1',
        start: { x: 0.25, y: 0.2 },
        end: { x: 0.75, y: 0.8 },
      },
    )

    const updated = applyWorkingDocumentCommand(added, {
      type: 'update-rectangle',
      id: 'redaction-1',
      start: { x: 0.8, y: 0.9 },
      end: { x: 0.3, y: 0.4 },
    })

    expect(updated.redactions).toEqual([
      expect.objectContaining({
        id: 'redaction-1',
        x: 0.3,
        y: 0.4,
        width: 0.5,
        height: 0.5,
        opacity: 1,
      }),
    ])
    expect(updated.operations.map(({ type }) => type)).toEqual([
      'add',
      'update',
    ])
    expect(updated.historyPosition).toBe(2)
  })

  it('does not record an update when canonical geometry is unchanged', () => {
    const added = applyWorkingDocumentCommand(
      createWorkingDocument({ width: 640, height: 480 }),
      {
        type: 'add-rectangle',
        id: 'redaction-1',
        start: { x: 0.25, y: 0.2 },
        end: { x: 0.75, y: 0.8 },
      },
    )

    const unchanged = applyWorkingDocumentCommand(added, {
      type: 'update-rectangle',
      id: 'redaction-1',
      start: { x: 0.25, y: 0.2 },
      end: { x: 0.75, y: 0.8 },
    })

    expect(unchanged).toBe(added)
    expect(unchanged.operations).toHaveLength(1)
  })

  it('removes an existing rectangle and records the removal', () => {
    const added = applyWorkingDocumentCommand(
      createWorkingDocument({ width: 640, height: 480 }),
      {
        type: 'add-rectangle',
        id: 'redaction-1',
        start: { x: 0.25, y: 0.2 },
        end: { x: 0.75, y: 0.8 },
      },
    )

    const removed = applyWorkingDocumentCommand(added, {
      type: 'remove-redaction',
      id: 'redaction-1',
    })

    expect(removed.redactions).toEqual([])
    expect(removed.operations.at(-1)).toEqual({
      type: 'remove',
      id: 'redaction-1',
    })
    expect(removed.historyPosition).toBe(2)
  })

  it('undoes remove, update, and add operations in reverse order', () => {
    const initial = createWorkingDocument({ width: 640, height: 480 })
    const added = applyWorkingDocumentCommand(initial, {
      type: 'add-rectangle',
      id: 'redaction-1',
      start: { x: 0.1, y: 0.1 },
      end: { x: 0.4, y: 0.4 },
    })
    const updated = applyWorkingDocumentCommand(added, {
      type: 'update-rectangle',
      id: 'redaction-1',
      start: { x: 0.5, y: 0.5 },
      end: { x: 0.9, y: 0.9 },
    })
    const removed = applyWorkingDocumentCommand(updated, {
      type: 'remove-redaction',
      id: 'redaction-1',
    })

    const removalUndone = undoWorkingDocument(removed)
    const updateUndone = undoWorkingDocument(removalUndone)
    const addUndone = undoWorkingDocument(updateUndone)

    expect(removalUndone.redactions).toEqual(updated.redactions)
    expect(updateUndone.redactions).toEqual(added.redactions)
    expect(addUndone.redactions).toEqual([])
    expect(addUndone.operations).toHaveLength(3)
    expect(addUndone.historyPosition).toBe(0)
  })

  it('discards the redo branch when a new operation follows undo', () => {
    const added = applyWorkingDocumentCommand(
      createWorkingDocument({ width: 640, height: 480 }),
      {
        type: 'add-rectangle',
        id: 'redaction-1',
        start: { x: 0.1, y: 0.1 },
        end: { x: 0.4, y: 0.4 },
      },
    )
    const updated = applyWorkingDocumentCommand(added, {
      type: 'update-rectangle',
      id: 'redaction-1',
      start: { x: 0.5, y: 0.5 },
      end: { x: 0.9, y: 0.9 },
    })
    const undone = undoWorkingDocument(updated)

    const replacement = applyWorkingDocumentCommand(undone, {
      type: 'update-rectangle',
      id: 'redaction-1',
      start: { x: 0.2, y: 0.2 },
      end: { x: 0.6, y: 0.6 },
    })

    expect(replacement.operations).toHaveLength(2)
    expect(replacement.redactions[0]).toEqual(
      expect.objectContaining({ x: 0.2, y: 0.2 }),
    )
    expect(redoWorkingDocument(replacement)).toBe(replacement)
  })

  it('redoes previously undone document operations in order', () => {
    const added = applyWorkingDocumentCommand(
      createWorkingDocument({ width: 640, height: 480 }),
      {
        type: 'add-rectangle',
        id: 'redaction-1',
        start: { x: 0.1, y: 0.1 },
        end: { x: 0.4, y: 0.4 },
      },
    )
    const updated = applyWorkingDocumentCommand(added, {
      type: 'update-rectangle',
      id: 'redaction-1',
      start: { x: 0.5, y: 0.5 },
      end: { x: 0.9, y: 0.9 },
    })
    const removed = applyWorkingDocumentCommand(updated, {
      type: 'remove-redaction',
      id: 'redaction-1',
    })
    const allUndone = undoWorkingDocument(
      undoWorkingDocument(undoWorkingDocument(removed)),
    )

    const addRedone = redoWorkingDocument(allUndone)
    const updateRedone = redoWorkingDocument(addRedone)
    const removeRedone = redoWorkingDocument(updateRedone)

    expect(addRedone.redactions).toEqual(added.redactions)
    expect(updateRedone.redactions).toEqual(updated.redactions)
    expect(removeRedone.redactions).toEqual([])
    expect(removeRedone.historyPosition).toBe(3)
  })
})
