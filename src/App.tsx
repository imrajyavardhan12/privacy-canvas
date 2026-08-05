import './App.css'

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
  return (
    <main>
      <header className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Foundation phase</p>
        <h1 id="page-title">Privacy Canvas</h1>
        <p className="lede">
          A local-first image privacy workbench for irreversible visual
          redaction and verifiable metadata sanitization.
        </p>
        <p className="status" role="status">
          The editor is not available yet. Privacy-critical behaviour is being
          specified and tested before image handling is enabled.
        </p>
      </header>

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
        <p>
          Open source · Apache-2.0 · No user media is processed in this build
        </p>
      </footer>
    </main>
  )
}

export default App
