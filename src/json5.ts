type Json = Record<string, unknown>
/** True for plain JSON objects (not null, not arrays). */
export const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)

/** JSON with line comments, block comments and trailing commas: the editable per-environment file format. */
export function parseJson5(text: string): unknown {
  let out = '', inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inString) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') inString = false
    } else if (c === '"') { inString = true; out += c }
    else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n' }
    else if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++ }
    else out += c
  }
  return JSON.parse(withoutTrailingCommas(out))
}
/** Drops a comma that is followed only by whitespace and a closing bracket, outside strings. */
function withoutTrailingCommas(text: string): string {
  let out = '', inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inString) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') inString = false
    } else if (c === '"') { inString = true; out += c }
    else if (c === ',') {
      let next = i + 1
      while (next < text.length && /\s/u.test(text[next]!)) next++
      if (text[next] !== '}' && text[next] !== ']') out += c
    } else out += c
  }
  return out
}
/** Deep-merges `fallback` into `current`; existing values always win and `undefined` defaults are dropped. */
export function mergeDefaults(current: unknown, fallback: unknown): unknown {
  if (fallback === undefined) return current
  if (current === undefined) return fallback
  if (!isObject(fallback) || !isObject(current)) return current
  const result: Json = { ...current }
  for (const [key, value] of Object.entries(fallback)) { const merged = mergeDefaults(current[key], value); if (merged !== undefined) result[key] = merged }
  return result
}
