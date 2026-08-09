type TrustedTypesFactory = Readonly<{
  createPolicy: (
    name: string,
    rules: Readonly<{
      createScriptURL: (value: string) => string
    }>,
  ) => unknown
}>

/**
 * Vite's inline worker constructor creates a same-origin blob URL at runtime,
 * while the offline Network Lock registers the exact same-origin `/sw.js` path.
 * The default policy is deliberately unable to create HTML or script text and
 * accepts only those narrow URL shapes. CSP still gates worker-src separately.
 */
export function installWorkerTrustedTypesPolicy(): void {
  const trustedTypes = (
    globalThis as typeof globalThis & {
      trustedTypes?: TrustedTypesFactory
    }
  ).trustedTypes
  if (trustedTypes === undefined) return

  trustedTypes.createPolicy('default', {
    createScriptURL(value) {
      const candidate = new URL(value, globalThis.location.href)
      const isSameOriginBlob =
        candidate.protocol === 'blob:' &&
        candidate.origin === globalThis.location.origin
      const isServiceWorker =
        candidate.origin === globalThis.location.origin &&
        candidate.pathname === '/sw.js' &&
        candidate.search === '' &&
        candidate.hash === ''
      if (!isSameOriginBlob && !isServiceWorker) {
        throw new TypeError(
          'Only the service worker and same-origin blob worker URLs are allowed.',
        )
      }
      return value
    },
  })
}
