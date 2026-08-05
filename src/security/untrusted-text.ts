export type BoundedUntrustedText = Readonly<{
  value: string
  truncated: boolean
}>

/**
 * Produces bounded display text without claiming that the result is safe for an
 * HTML sink. Callers must still render the returned string as text.
 */
export function boundUntrustedText(
  value: string,
  maximumCodeUnits: number,
): BoundedUntrustedText {
  if (!Number.isSafeInteger(maximumCodeUnits) || maximumCodeUnits < 2) {
    throw new TypeError('The untrusted text limit is invalid.')
  }

  const visible = makeHiddenControlsVisible(value)
  if (visible.length <= maximumCodeUnits) {
    return { value: visible, truncated: false }
  }

  let prefix = visible.slice(0, maximumCodeUnits - 1)
  const lastCodeUnit = prefix.charCodeAt(prefix.length - 1)
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    prefix = prefix.slice(0, -1)
  }
  return { value: `${prefix}…`, truncated: true }
}

function makeHiddenControlsVisible(value: string): string {
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
