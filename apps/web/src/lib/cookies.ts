// The value of one cookie from a `Cookie` header or `document.cookie` string,
// or undefined when it is absent. Only name matching is done here; callers
// decode the value if they wrote an encoded one.
export function readCookie(
  cookies: string | undefined,
  name: string,
): string | undefined {
  if (!cookies) return undefined
  for (const pair of cookies.split(';')) {
    const separator = pair.indexOf('=')
    if (separator === -1) continue
    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim()
    }
  }
  return undefined
}
