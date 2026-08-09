import { useEffect, useRef, useState } from 'react'
import type {
  MetadataRiskCategory,
  SourceMediaInspection,
} from './intake/source-media'
import {
  createWorkingDocument,
  type WorkingDocument,
} from './document/working-document'
import { RectangleEditor } from './ui/RectangleEditor'
import {
  MediaWorkerClient,
  MediaWorkerOperationError,
} from './workers/media-worker-client'
import type { PngVerificationReport } from './verifier/png-verifier'
import {
  activateNetworkLock,
  type NetworkLockSession,
} from './security/network-lock'
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

type NetworkLockState =
  | 'activating'
  | 'active'
  | 'development'
  | 'update-available'
  | 'activating-update'
  | 'unavailable'

type VerifiedExportState = Readonly<{
  url: string
  size: number
  verification: PngVerificationReport
}>

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
  const networkLock = useRef<NetworkLockSession | null>(null)
  const previewCanvas = useRef<HTMLCanvasElement | null>(null)
  const exportGeneration = useRef(0)
  const verifiedExportUrl = useRef<string | null>(null)
  const [status, setStatus] = useState('Preparing private image intake…')
  const [networkLockState, setNetworkLockState] =
    useState<NetworkLockState>('activating')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [verifiedExport, setVerifiedExport] =
    useState<VerifiedExportState | null>(null)
  const [sourceName, setSourceName] = useState<string | null>(null)
  const [inspection, setInspection] = useState<SourceMediaInspection | null>(
    null,
  )
  const [workingDocument, setWorkingDocument] =
    useState<WorkingDocument | null>(null)

  useEffect(() => {
    let client: MediaWorkerClient
    try {
      client = new MediaWorkerClient()
    } catch {
      setStatus('Private image intake is unavailable in this browser.')
      return
    }
    let active = true
    let unsubscribeFromUpdate = (): void => undefined
    mediaWorker.current = client
    void Promise.all([client.ready, activateNetworkLock()])
      .then(([, session]) => {
        if (!active) return
        networkLock.current = session
        const showUpdate = (): void => {
          if (!active) return
          setReady(false)
          setNetworkLockState('update-available')
          setStatus(
            'Application update ready. Activate it before opening Source Media.',
          )
        }
        unsubscribeFromUpdate = session.subscribeToUpdate(showUpdate)
        if (session.updateAvailable) {
          showUpdate()
          return
        }
        setReady(true)
        if (session.version === 'development') {
          setNetworkLockState('development')
          setStatus(
            'Development mode is for synthetic test media only. Network Lock guarantees are unavailable.',
          )
          return
        }
        setNetworkLockState('active')
        setStatus('Ready to inspect one local JPEG.')
      })
      .catch(() => {
        if (!active) return
        client.terminate()
        if (mediaWorker.current === client) mediaWorker.current = null
        networkLock.current = null
        setNetworkLockState('unavailable')
        setStatus(
          'Private image processing or Network Lock is unavailable in this browser.',
        )
      })
    return () => {
      active = false
      unsubscribeFromUpdate()
      networkLock.current = null
      exportGeneration.current += 1
      if (verifiedExportUrl.current !== null) {
        URL.revokeObjectURL(verifiedExportUrl.current)
        verifiedExportUrl.current = null
      }
      mediaWorker.current?.terminate()
      mediaWorker.current = null
    }
  }, [])

  useEffect(() => {
    const client = mediaWorker.current
    if (client === null || workingDocument === null) return
    let active = true
    void client
      .renderWorkingDocument(workingDocument)
      .then((result) => {
        if (!active) {
          result.preview.close()
          return
        }
        drawPreview(
          previewCanvas.current,
          result.previewDimensions,
          result.preview,
        )
      })
      .catch((error: unknown) => {
        if (!active) return
        clearPreview(previewCanvas.current)
        setStatus(
          error instanceof MediaWorkerOperationError
            ? error.message
            : 'The redacted preview could not be rendered safely.',
        )
      })
    return () => {
      active = false
    }
  }, [workingDocument])

  const activateApplicationUpdate = async (): Promise<void> => {
    const session = networkLock.current
    if (session === null || !session.updateAvailable) return
    setReady(false)
    setNetworkLockState('activating-update')
    setStatus('Activating the complete application update and reloading…')
    try {
      await session.activateUpdate()
    } catch {
      setNetworkLockState('unavailable')
      setStatus('The application update could not be activated safely.')
    }
  }

  const clearVerifiedExport = (): void => {
    exportGeneration.current += 1
    if (verifiedExportUrl.current !== null) {
      URL.revokeObjectURL(verifiedExportUrl.current)
      verifiedExportUrl.current = null
    }
    setVerifiedExport(null)
  }

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

  const createPrivacyExport = async (): Promise<void> => {
    const client = mediaWorker.current
    const document = workingDocument
    if (client === null || document === null || busy || exporting) return

    clearVerifiedExport()
    const generation = exportGeneration.current
    setExporting(true)
    setStatus('Rendering, freshly encoding, and verifying the PNG locally…')
    try {
      const result = await client.exportWorkingDocument(document)
      if (
        generation !== exportGeneration.current ||
        mediaWorker.current !== client
      ) {
        return
      }
      const url = URL.createObjectURL(result.blob)
      verifiedExportUrl.current = url
      setVerifiedExport({
        url,
        size: result.blob.size,
        verification: result.verification,
      })
      setStatus('Verified PNG ready. Download is now available.')
    } catch (error) {
      if (generation !== exportGeneration.current) return
      const message =
        error instanceof MediaWorkerOperationError
          ? error.message
          : 'Privacy Export could not be verified safely.'
      const requiresFreshWorker =
        !(error instanceof MediaWorkerOperationError) ||
        error.failure.code === 'operation-timeout'
      if (requiresFreshWorker) {
        setInspection(null)
        setSourceName(null)
        setWorkingDocument(null)
        clearPreview(previewCanvas.current)
        if (!(await replaceMediaWorker(client))) {
          setStatus('Private image processing is unavailable in this browser.')
          return
        }
      }
      setStatus(message)
    } finally {
      setExporting(false)
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
    clearVerifiedExport()
    setInspection(null)
    setSourceName(null)
    setWorkingDocument(null)
    setStatus('Inspecting and decoding Source Media locally…')
    clearPreview(previewCanvas.current)

    try {
      const result = await client.openFile(file)
      drawPreview(
        previewCanvas.current,
        result.previewDimensions,
        result.preview,
      )
      setInspection(result.inspection)
      setSourceName(result.sourceName)
      setWorkingDocument(
        createWorkingDocument(result.inspection.normalizedDimensions),
      )
      setStatus('Source ready. Review metadata risks and add a redaction.')
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
    const terminatePendingExport = exporting

    setBusy(true)
    setReady(false)
    setExporting(false)
    clearVerifiedExport()
    setInspection(null)
    setSourceName(null)
    setWorkingDocument(null)
    setStatus('Releasing the current private session…')
    clearPreview(previewCanvas.current)

    if (!terminatePendingExport) {
      try {
        await client.reset()
      } catch {
        // Worker termination below remains the fail-closed cleanup path.
      }
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
        <div className={`network-lock-status ${networkLockState}`}>
          <span>{networkLockLabel(networkLockState)}</span>
          {networkLockState === 'update-available' ? (
            <button
              onClick={() => void activateApplicationUpdate()}
              type="button"
            >
              Activate update and reload
            </button>
          ) : null}
        </div>
      </header>

      <section className="intake" aria-labelledby="intake-title">
        <div>
          <p className="eyebrow">Source Media</p>
          <h2 id="intake-title">Open a local JPEG</h2>
          <p>
            The original bytes move to a dedicated media worker. Nothing is
            uploaded or saved to browser storage. Rectangle editing is local;
            verified PNG download appears only after final-output checks pass.
          </p>
        </div>
        <label className="file-picker">
          <span>Choose a JPEG</span>
          <input
            accept="image/jpeg,.jpg,.jpeg"
            disabled={
              !['active', 'development'].includes(networkLockState) ||
              !ready ||
              busy ||
              exporting
            }
            onChange={(event) => void openSource(event)}
            type="file"
          />
        </label>

        <RectangleEditor
          canvasRef={previewCanvas}
          document={workingDocument}
          onDocumentChange={(document) => {
            const invalidatedExport = verifiedExportUrl.current !== null
            clearVerifiedExport()
            setWorkingDocument(document)
            if (invalidatedExport) {
              setStatus(
                'Working Document changed. Create a new verified PNG before downloading.',
              )
            }
          }}
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

            <section className="privacy-export" aria-labelledby="export-title">
              <div>
                <p className="eyebrow">Privacy Export</p>
                <h2 id="export-title">Create a verified PNG</h2>
                <p>
                  Full-resolution pixels stay in the media worker. Download
                  appears only after fresh encoding and final-byte verification
                  both succeed.
                </p>
              </div>
              <button
                disabled={busy || exporting}
                onClick={() => void createPrivacyExport()}
                type="button"
              >
                {exporting ? 'Creating verified PNG…' : 'Create verified PNG'}
              </button>
              {verifiedExport === null ? null : (
                <div className="verification-report">
                  <h3>Verification report</h3>
                  <p>
                    Verified opaque RGB PNG ·{' '}
                    {verifiedExport.verification.dimensions.width} ×{' '}
                    {verifiedExport.verification.dimensions.height} pixels ·{' '}
                    {formatBytes(verifiedExport.size)}
                  </p>
                  <p>
                    {verifiedExport.verification.opaqueRegionsChecked}{' '}
                    {verifiedExport.verification.opaqueRegionsChecked === 1
                      ? 'opaque region checked'
                      : 'opaque regions checked'}
                    . Core chunks only; metadata and source profiles are
                    excluded by the verified PNG profile.
                  </p>
                  <p>
                    Verification checks file properties and confirmed masks. It
                    cannot prove that every Sensitive Region was found or
                    guarantee anonymity.
                  </p>
                  <a download="privacy-export.png" href={verifiedExport.url}>
                    Download verified PNG
                  </a>
                </div>
              )}
            </section>

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

function networkLockLabel(state: NetworkLockState): string {
  switch (state) {
    case 'active':
      return 'Network Lock active'
    case 'development':
      return 'Development mode — Network Lock unavailable'
    case 'update-available':
      return 'Network Lock update available'
    case 'activating-update':
      return 'Network Lock activating update…'
    case 'unavailable':
      return 'Network Lock unavailable'
    case 'activating':
      return 'Network Lock activating…'
  }
}

function drawPreview(
  canvas: HTMLCanvasElement | null,
  dimensions: Readonly<{ width: number; height: number }>,
  preview: ImageBitmap,
): void {
  try {
    if (canvas === null) throw new Error('Preview canvas is unavailable.')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d', {
      alpha: false,
      colorSpace: 'srgb',
    })
    if (context === null) throw new Error('Preview canvas is unavailable.')
    context.drawImage(preview, 0, 0)
  } finally {
    preview.close()
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  return `${(bytes / 1_024).toFixed(1)} KiB`
}

function clearPreview(canvas: HTMLCanvasElement | null): void {
  if (canvas === null) return
  canvas.width = 1
  canvas.height = 1
}

export default App
