const assignment = /^([A-Z][A-Z0-9_]*)=(.*)$/u
const quotes = new Set(['"', "'", '`'])

/**
 * Parses a secrets file strictly. Unlike a forgiving dotenv reader it never guesses: a line that is not
 * `NAME=value` (or blank, or a `#` comment), a repeated name or an unterminated quoted value is an error.
 * Errors name the line or the variable, never a value.
 *
 * - Names are upper-case letters, digits and underscore, starting with a letter.
 * - A value may be quoted with ", ' or `; it then continues over following lines until a line ends with the
 *   same quote (optionally followed by a `#` comment).
 * - An unquoted value ends at the first `#`, like Node's own dotenv parser, and is trimmed.
 * - `\n` becomes a newline in every value, so a PEM can sit on one line.
 */
export function parseSecretEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  const lines = text.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const match = assignment.exec(line)
    if (!match) throw new Error(`Malformed secrets file at line ${index + 1}; expected NAME=value on one line`)
    const name = match[1]!, rest = match[2]!.trimStart()
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate secret: ${name}`)
    let value: string
    if (rest.length > 0 && quotes.has(rest[0]!)) {
      const quote = rest[0]!, closing = new RegExp(`^([\\s\\S]*)${quote}[ \\t]*(?:#[^\\n]*)?$`, 'u')
      let body = rest.slice(1), closed = closing.exec(body)
      while (!closed) {
        if (++index >= lines.length) throw new Error(`Unterminated quoted secret: ${name}`)
        body += `\n${lines[index]}`
        closed = closing.exec(body)
      }
      value = closed[1]!
    } else {
      const hash = rest.indexOf('#')
      value = (hash < 0 ? rest : rest.slice(0, hash)).trim()
    }
    values[name] = value.replaceAll('\\n', '\n')
  }
  return values
}
