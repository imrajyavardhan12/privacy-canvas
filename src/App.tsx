import { useEffect, useRef, useState } from 'react'
import type {
  MetadataRiskCategory,
  SourceMediaInspection,
} from './intake/source-media'
import {
  MediaWorkerClient,
  MediaWorkerOperationError,
} from './workers/media-worker-client'
import './App.css'

const metadataCategoryLabels: Record<MetadataRiskCategory, string> = {
  'creator-contact': 'Creator or contact',
  'device-identity': 'Device identity',
  'editing-history': 'Editing history',
  'embedded-text': 'Embedded text',
  'embedded-thumbnail': 'Embedded thumbnail',
  location: 'Location',
  provenance: 'Provenance',
  timestamp: 'Timestamps',
  'unclassified-metadata': 'Unclassified metadata',
}

const principles = [
  {
    title: 'Local by construction',
    detail:
      'No accounts, uploads, analytics, remote models, or media persistence.',
  },
  {
    title: 'Safe by default',
    detail:
      'Opaque redaction is the privacy-safe path. Automation only suggests.',
  },
  {
    title: 'Verified exports',
    detail:
      'Freshly encoded output is checked before it can be saved or shared.',
  },
]

function App() {
  const mediaWorker = useRef<MediaWorkerClient | null>(null)
  const previewCanvas = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState('Preparing private image intake…')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sourceName, setSourceName] = useState<string | null>(null)
  const [inspection, setInspection] = useState<SourceMediaInspection | null>(
    null,
  )

  useEffect(() => {
    let client: MediaWorkerClient
    try {
      client = new MediaWorkerClient()
    } catch {
      setStatus('Private image intake is unavailable in this browser.')
      return
    }
    let active = true
    mediaWorker.current = client
    void client.ready
      .then(() => {
        if (!active) return
        setReady(true)
        setStatus('Ready to inspect one local JPEG.')
      })
      .catch(() => {
        if (!active) return
        setStatus('Private image intake is unavailable in this browser.')
      })
    return () => {
      active = false
      mediaWorker.current?.terminate()
      mediaWorker.current = null
    }
  }, [])

  const replaceMediaWorker = async (
    current: MediaWorkerClient,
  ): Promise<boolean> => {
    setReady(false)
    current.terminate()
    let replacement: MediaWorkerClient
    try {
      replacement = new MediaWorkerClient()
    } catch {
      if (mediaWorker.current === current) mediaWorker.current = null
      return false
    }
    mediaWorker.current = replacement
    try {
      await replacement.ready
      if (mediaWorker.current !== replacement) return false
      setReady(true)
      return true
    } catch {
      if (mediaWorker.current === replacement) mediaWorker.current = null
      return false
    }
  }

  const openSource = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.currentTarget.files?.item(0)
    event.currentTarget.value = ''
    const client = mediaWorker.current
    if (file === null || file === undefined || client === null || busy) return

    setBusy(true)
    setInspection(null)
    setSourceName(null)
    setStatus('Inspecting and decoding Source Media locally…')
    clearPreview(previewCanvas.current)

    try {
      const result = await client.openFile(file)
      const canvas = previewCanvas.current
      try {
        if (canvas === null) throw new Error('Preview canvas is unavailable.')
        canvas.width = result.previewDimensions.width
        canvas.height = result.previewDimensions.height
        const context = canvas.getContext('2d', { alpha: false })
        if (context === null) throw new Error('Preview canvas is unavailable.')
        context.drawImage(result.preview, 0, 0)
      } finally {
        result.preview.close()
      }
      setInspection(result.inspection)
      setSourceName(result.sourceName)
      setStatus('Source ready. Review its metadata risks before editing.')
    } catch (error) {
      const message =
        error instanceof MediaWorkerOperationError
          ? error.message
          : 'Source Media could not be opened safely.'
      const requiresFreshWorker =
        !(error instanceof MediaWorkerOperationError) ||
        error.failure.code === 'operation-timeout'
      if (requiresFreshWorker && !(await replaceMediaWorker(client))) {
        setStatus('Private image intake is unavailable in this browser.')
      } else {
        setStatus(message)
      }
    } finally {
      setBusy(false)
    }
  }

  const resetSession = async (): Promise<void> => {
    const client = mediaWorker.current
    if (client === null || busy) return

    setBusy(true)
    setReady(false)
    setInspection(null)
    setSourceName(null)
    setStatus('Releasing the current private session…')
    clearPreview(previewCanvas.current)

    try {
      await client.reset()
    } catch {
      // Worker termination below remains the fail-closed cleanup path.
    }

    const replaced = await replaceMediaWorker(client)
    setStatus(
      replaced
        ? 'Ready to inspect one local JPEG.'
        : 'Private image intake is unavailable in this browser.',
    )
    setBusy(false)
  }

  return (
    <main>
      <header className="hero" aria-labelledby="page-title">
        <p className="eyebrow">First privacy path</p>
        <h1 id="page-title">Privacy Canvas</h1>
        <p className="lede">
          A local-first image privacy workbench for irreversible visual
          redaction and verifiable metadata sanitization.
        </p>
        <p className="status" role="status">
          {status}
        </p>
      </header>

      <section className="intake" aria-labelledby="intake-title">
        <div>
          <p className="eyebrow">Source Media</p>
          <h2 id="intake-title">Open a local JPEG</h2>
          <p>
            The original bytes move to a dedicated media worker. Nothing is
            uploaded or saved to browser storage. Redaction and export are not
            available yet.
          </p>
        </div>
        <label className="file-picker">
          <span>Choose a JPEG</span>
          <input
            accept="image/jpeg,.jpg,.jpeg"
            disabled={!ready || busy}
            onChange={(event) => void openSource(event)}
            type="file"
          />
        </label>

        <canvas
          aria-label="Normalized Source Media preview"
          className="source-preview"
          hidden={inspection === null}
          ref={previewCanvas}
          role="img"
        />

        {inspection !== null && sourceName !== null ? (
          <>
            <dl className="source-facts">
              <div>
                <dt>Source name</dt>
                <dd>{sourceName}</dd>
              </div>
              <div>
                <dt>Normalized size</dt>
                <dd>
                  {inspection.normalizedDimensions.width} ×{' '}
                  {inspection.normalizedDimensions.height} pixels
                </dd>
              </div>
              <div>
                <dt>Metadata inspection</dt>
                <dd>{inspection.metadataRiskSummary.status}</dd>
              </div>
            </dl>

            <button
              className="reset-session"
              disabled={busy}
              onClick={() => void resetSession()}
              type="button"
            >
              Reset session
            </button>

            <section
              className="metadata-summary"
              aria-labelledby="metadata-summary-title"
            >
              <div>
                <p className="eyebrow">Advisory review</p>
                <h2 id="metadata-summary-title">Metadata risks</h2>
                <p>
                  This bounded summary is not proof that metadata is absent or
                  fully understood. Privacy Export sanitization is independent
                  of these findings.
                </p>
              </div>
              {inspection.metadataRiskSummary.groups.length === 0 ? (
                <p>No risks were found by the supported metadata parsers.</p>
              ) : (
                <div className="metadata-groups">
                  {inspection.metadataRiskSummary.groups.map((group) => (
                    <article className="metadata-group" key={group.category}>
                      <h3>{metadataCategoryLabels[group.category]}</h3>
                      <dl>
                        {group.findings.map((finding, index) => (
                          <div
                            key={`${finding.source}-${finding.label}-${index}`}
                          >
                            <dt>
                              {finding.label} <span>({finding.source})</span>
                            </dt>
                            <dd>
                              {finding.value ??
                                'Present; no text value exposed'}
                              {finding.truncated ? ' (truncated)' : ''}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </section>

      <section className="principles" aria-labelledby="principles-title">
        <h2 id="principles-title">Engineering principles</h2>
        <div className="principle-grid">
          {principles.map((principle, index) => (
            <article className="principle" key={principle.title}>
              <span aria-hidden="true">0{index + 1}</span>
              <h3>{principle.title}</h3>
              <p>{principle.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <footer>
        <p>Open source · Apache-2.0 · User media stays on this device</p>
      </footer>
    </main>
  )
}

function clearPreview(canvas: HTMLCanvasElement | null): void {
  if (canvas === null) return
  canvas.width = 1
  canvas.height = 1
}

export default App
