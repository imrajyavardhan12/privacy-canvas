type TrustedTypesFactory = Readonly<{
  createPolicy: (
    name: string,
    rules: Readonly<{
      createScriptURL: (value: string) => string
    }>,
  ) => unknown
}>

/**
 * Vite's inline worker constructor creates a same-origin blob URL at runtime.
 * The default policy is deliberately unable to create HTML or script text and
 * accepts only that narrow URL shape. CSP still independently gates worker-src.
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
      if (
        candidate.protocol !== 'blob:' ||
        candidate.origin !== globalThis.location.origin
      ) {
        throw new TypeError('Only same-origin blob worker URLs are allowed.')
      }
      return value
    },
  })
}
