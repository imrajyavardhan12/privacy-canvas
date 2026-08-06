import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  confirmRectangle,
  moveRectangle,
  resizeRectangle,
  type ConfirmedRectangleRedaction,
  type NormalizedPoint,
} from '../document/redaction'
import {
  applyWorkingDocumentCommand,
  rectangleCoversMinimumSourcePixel,
  redoWorkingDocument,
  undoWorkingDocument,
  type WorkingDocument,
} from '../document/working-document'
import { viewportPointToDocument } from '../viewport/coordinates'

type RectangleEditorProps = Readonly<{
  canvasRef: RefObject<HTMLCanvasElement | null>
  document: WorkingDocument | null
  onDocumentChange: (document: WorkingDocument) => void
}>

type PointerInteraction = Readonly<{
  pointerId: number
  kind: 'add' | 'move' | 'resize'
  start: NormalizedPoint
  rectangle?: ConfirmedRectangleRedaction
}>

const redactionId = 'redaction-1'

export function RectangleEditor({
  canvasRef,
  document,
  onDocumentChange,
}: RectangleEditorProps) {
  const editor = useRef<SVGSVGElement | null>(null)
  const interaction = useRef<PointerInteraction | null>(null)
  const [draft, setDraft] = useState<ConfirmedRectangleRedaction | null>(null)
  const rectangle = document?.redactions[0]
  const displayedRectangle = draft ?? rectangle

  useEffect(() => {
    interaction.current = null
    setDraft(null)
  }, [document])

  const addRectangle = (): void => {
    if (document === null || rectangle !== undefined) return
    onDocumentChange(
      applyWorkingDocumentCommand(document, {
        type: 'add-rectangle',
        id: redactionId,
        start: { x: 0.25, y: 0.25 },
        end: { x: 0.75, y: 0.75 },
      }),
    )
    requestAnimationFrame(() => editor.current?.focus())
  }

  const removeRectangle = (): void => {
    if (document === null || rectangle === undefined) return
    onDocumentChange(
      applyWorkingDocumentCommand(document, {
        type: 'remove-redaction',
        id: rectangle.id,
      }),
    )
  }

  const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>): void => {
    if (document === null) return
    const historyKey = event.ctrlKey || event.metaKey
    if (historyKey && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      onDocumentChange(
        event.shiftKey
          ? redoWorkingDocument(document)
          : undoWorkingDocument(document),
      )
      return
    }
    if (historyKey && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      onDocumentChange(redoWorkingDocument(document))
      return
    }
    if (rectangle === undefined) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removeRectangle()
      return
    }

    const direction = keyboardDirection(event.key)
    if (direction === undefined) return
    event.preventDefault()
    const delta = {
      x: direction.x / document.dimensions.width,
      y: direction.y / document.dimensions.height,
    }
    const geometry = event.shiftKey
      ? resizeRectangle(rectangle, delta, minimumRectangleSize(document))
      : moveRectangle(rectangle, delta)
    onDocumentChange(
      applyWorkingDocumentCommand(document, {
        type: 'update-rectangle',
        ...geometry,
      }),
    )
  }

  const handlePointerDown = (
    event: React.PointerEvent<SVGSVGElement>,
  ): void => {
    if (document === null || event.button !== 0 || interaction.current !== null)
      return
    const action = (event.target as SVGElement).dataset.action
    const kind =
      action === 'move' ? 'move' : action === 'resize' ? 'resize' : 'add'
    if (kind === 'add' && rectangle !== undefined) return
    if (kind !== 'add' && rectangle === undefined) return

    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    interaction.current = {
      pointerId: event.pointerId,
      kind,
      start: pointerPosition(event),
      ...(rectangle === undefined ? {} : { rectangle }),
    }
  }

  const handlePointerMove = (
    event: React.PointerEvent<SVGSVGElement>,
  ): void => {
    const current = interaction.current
    if (
      document === null ||
      current === null ||
      current.pointerId !== event.pointerId
    ) {
      return
    }
    setDraft(rectangleForInteraction(current, pointerPosition(event), document))
  }

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>): void => {
    const current = interaction.current
    if (
      document === null ||
      current === null ||
      current.pointerId !== event.pointerId
    ) {
      return
    }

    const finalRectangle = rectangleForInteraction(
      current,
      pointerPosition(event),
      document,
    )
    interaction.current = null
    setDraft(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (finalRectangle === null) return

    onDocumentChange(
      applyWorkingDocumentCommand(document, {
        type: current.kind === 'add' ? 'add-rectangle' : 'update-rectangle',
        id: finalRectangle.id,
        start: { x: finalRectangle.x, y: finalRectangle.y },
        end: {
          x: finalRectangle.x + finalRectangle.width,
          y: finalRectangle.y + finalRectangle.height,
        },
        color: finalRectangle.color,
      }),
    )
  }

  const cancelPointer = (): void => {
    interaction.current = null
    setDraft(null)
  }

  return (
    <>
      <div className="editor-viewport" hidden={document === null}>
        <canvas
          aria-label="Normalized Source Media preview"
          className="source-preview"
          ref={canvasRef}
          role="img"
        />
        {document === null ? null : (
          <svg
            aria-describedby="redaction-editor-instructions"
            aria-label="Redaction editor"
            className="redaction-overlay"
            onKeyDown={handleKeyDown}
            onLostPointerCapture={cancelPointer}
            onPointerCancel={cancelPointer}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            ref={editor}
            role="group"
            tabIndex={0}
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
          >
            <rect
              aria-hidden="true"
              className="editor-hit-area"
              data-action="add"
              height={1}
              width={1}
              x={0}
              y={0}
            />
            {displayedRectangle === undefined ? null : (
              <>
                <rect
                  aria-label="Confirmed opaque rectangle"
                  className="confirmed-rectangle"
                  data-action="move"
                  height={displayedRectangle.height}
                  role="img"
                  width={displayedRectangle.width}
                  x={displayedRectangle.x}
                  y={displayedRectangle.y}
                />
                <rect
                  aria-label="Resize rectangle"
                  className="rectangle-resize-handle"
                  data-action="resize"
                  height={0.1}
                  role="img"
                  width={0.1}
                  x={Math.max(
                    displayedRectangle.x,
                    displayedRectangle.x + displayedRectangle.width - 0.05,
                  )}
                  y={Math.max(
                    displayedRectangle.y,
                    displayedRectangle.y + displayedRectangle.height - 0.05,
                  )}
                />
              </>
            )}
          </svg>
        )}
      </div>

      {document === null ? null : (
        <section
          className="redaction-controls"
          aria-labelledby="redaction-title"
        >
          <div>
            <p className="eyebrow">Working Document</p>
            <h2 id="redaction-title">Opaque rectangle</h2>
            <p id="redaction-editor-instructions">
              Draw on the preview, or add a rectangle with the button. Arrow
              keys move by one source pixel; Shift plus an arrow resizes. Delete
              removes it. Control or Command plus Z/Y changes operation history.
            </p>
          </div>
          <div className="redaction-actions">
            <button
              disabled={rectangle !== undefined}
              onClick={addRectangle}
              type="button"
            >
              Add opaque rectangle
            </button>
            <button
              disabled={document.historyPosition === 0}
              onClick={() => onDocumentChange(undoWorkingDocument(document))}
              type="button"
            >
              Undo
            </button>
            <button
              disabled={document.historyPosition === document.operations.length}
              onClick={() => onDocumentChange(redoWorkingDocument(document))}
              type="button"
            >
              Redo
            </button>
            <button
              disabled={rectangle === undefined}
              onClick={removeRectangle}
              type="button"
            >
              Remove rectangle
            </button>
          </div>
          <p className="redaction-summary" aria-live="polite">
            {rectangle === undefined
              ? 'No confirmed redactions'
              : `1 confirmed opaque rectangle. Rectangle: x ${percent(rectangle.x)}, y ${percent(rectangle.y)}, width ${percent(rectangle.width)}, height ${percent(rectangle.height)}.`}
          </p>
        </section>
      )}
    </>
  )
}

function keyboardDirection(
  key: string,
): Readonly<{ x: number; y: number }> | undefined {
  if (key === 'ArrowLeft') return { x: -1, y: 0 }
  if (key === 'ArrowRight') return { x: 1, y: 0 }
  if (key === 'ArrowUp') return { x: 0, y: -1 }
  if (key === 'ArrowDown') return { x: 0, y: 1 }
  return undefined
}

function pointerPosition(
  event: React.PointerEvent<SVGSVGElement>,
): NormalizedPoint {
  return viewportPointToDocument(
    event,
    event.currentTarget.getBoundingClientRect(),
  )
}

function rectangleForInteraction(
  interaction: PointerInteraction,
  current: NormalizedPoint,
  document: WorkingDocument,
): ConfirmedRectangleRedaction | null {
  try {
    if (interaction.kind === 'add') {
      const rectangle = confirmRectangle({
        id: redactionId,
        start: interaction.start,
        end: current,
      })
      return rectangleCoversMinimumSourcePixel(rectangle, document.dimensions)
        ? rectangle
        : null
    }
    const rectangle = interaction.rectangle
    if (rectangle === undefined) return null
    const delta = {
      x: current.x - interaction.start.x,
      y: current.y - interaction.start.y,
    }
    return confirmRectangle(
      interaction.kind === 'move'
        ? moveRectangle(rectangle, delta)
        : resizeRectangle(rectangle, delta, minimumRectangleSize(document)),
    )
  } catch {
    return null
  }
}

function minimumRectangleSize(
  document: WorkingDocument,
): Readonly<{ width: number; height: number }> {
  return {
    width: 1 / document.dimensions.width,
    height: 1 / document.dimensions.height,
  }
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}
