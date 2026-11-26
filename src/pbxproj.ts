// A small reader for Xcode's OpenStep-style project.pbxproj. Every node keeps its position, so edits are surgical text
// changes that leave the rest of the file (order, comments, formatting) exactly as Xcode wrote it.
import { requireValue } from './runtime.js'

export interface PbxString { type: 'string'; value: string; start: number; end: number }
/** `end` is the position of the closing parenthesis. */
export interface PbxArray { type: 'array'; items: PbxNode[]; start: number; end: number }
/** `end` is the position just after the semicolon. */
export interface PbxEntry { key: string; value: PbxNode; start: number; end: number }
/** `end` is the position of the closing brace. */
export interface PbxDict { type: 'dict'; entries: Map<string, PbxEntry>; start: number; end: number }
export type PbxNode = PbxString | PbxArray | PbxDict

const invalid = 'Cannot parse the Xcode project file'

export function parsePbx(text: string): PbxDict {
  let position = 0
  const skip = () => {
    const blank = /(?:\s+|\/\*[\s\S]*?\*\/|\/\/[^\n]*)+/uy
    blank.lastIndex = position
    if (blank.exec(text)) position = blank.lastIndex
  }
  const expect = (character: string) => { skip(); requireValue(text[position] === character, invalid); return position++ }
  const string = (): PbxString => {
    skip()
    const start = position
    if (text[position] === '"') {
      const quoted = /"((?:\\[\s\S]|[^"\\])*)"/uy
      quoted.lastIndex = position
      const match = quoted.exec(text)
      requireValue(match, invalid)
      position = quoted.lastIndex
      return { type: 'string', value: match[1]!.replace(/\\([\s\S])/gu, (_, next: string) => next === 'n' ? '\n' : next === 't' ? '\t' : next), start, end: position }
    }
    const bare = /<[^>]*>|[A-Za-z0-9_$/:.\-+@]+/uy
    bare.lastIndex = position
    const match = bare.exec(text)
    requireValue(match, invalid)
    position = bare.lastIndex
    return { type: 'string', value: match[0], start, end: position }
  }
  const node = (depth: number): PbxNode => {
    requireValue(depth < 64, invalid)
    skip()
    const start = position
    if (text[position] === '{') {
      position++
      const entries = new Map<string, PbxEntry>()
      for (skip(); text[position] !== '}'; skip()) {
        const key = string()
        expect('=')
        const value = node(depth + 1)
        const semicolon = expect(';')
        entries.set(key.value, { key: key.value, value, start: key.start, end: semicolon + 1 })
      }
      return { type: 'dict', entries, start, end: position++ }
    }
    if (text[position] === '(') {
      position++
      const items: PbxNode[] = []
      for (skip(); text[position] !== ')'; skip()) {
        items.push(node(depth + 1))
        skip()
        if (text[position] === ',') position++
        else requireValue(text[position] === ')', invalid)
      }
      return { type: 'array', items, start, end: position++ }
    }
    return string()
  }
  const root = node(0)
  requireValue(root.type === 'dict', invalid)
  return root
}

export const dictAt = (dict: PbxDict, key: string): PbxDict | undefined => { const value = dict.entries.get(key)?.value; return value?.type === 'dict' ? value : undefined }
export const arrayAt = (dict: PbxDict, key: string): PbxArray | undefined => { const value = dict.entries.get(key)?.value; return value?.type === 'array' ? value : undefined }
export const stringAt = (dict: PbxDict, key: string): string | undefined => { const value = dict.entries.get(key)?.value; return value?.type === 'string' ? value.value : undefined }
export const stringsAt = (dict: PbxDict, key: string): string[] => arrayAt(dict, key)?.items.flatMap(item => item.type === 'string' ? [item.value] : []) ?? []

export const pbxQuote = (value: string) => /^[A-Za-z0-9_$/.]+$/u.test(value) ? value : `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

const lineStart = (text: string, position: number) => text.lastIndexOf('\n', position - 1) + 1

/** Adds one item (with its comment) at the end of an array. */
export function appendItem(text: string, array: PbxArray, item: string): string {
  const start = lineStart(text, array.end), indent = text.slice(start, array.end)
  const multiline = /^\s*$/u.test(indent) && start > array.start
  const last = array.items.at(-1)
  // Xcode always writes a trailing comma; a hand-edited list may not have one.
  const comma = last && !/^(?:\s|\/\*[\s\S]*?\*\/)*,/u.test(text.slice(last.end, array.end)) ? ',' : ''
  const at = multiline ? start : array.end
  const addition = multiline ? `${indent}\t${item},\n` : ` ${item},`
  const result = text.slice(0, at) + addition + text.slice(at)
  if (!comma) return result
  const comment = /^[ \t]*\/\*[\s\S]*?\*\//u.exec(text.slice(last!.end))?.[0].length ?? 0
  return result.slice(0, last!.end + comment) + comma + result.slice(last!.end + comment)
}

/** Removes an array item or object entry together with its comment, separator and line. */
export function removeSpan(text: string, start: number, end: number): string {
  const trailing = /^(?:[ \t]*\/\*[^\n]*?\*\/)?[ \t]*,?[ \t]*(?:\r?\n)?/u.exec(text.slice(end))![0].length
  const from = lineStart(text, start)
  return text.slice(0, /^[ \t]*$/u.test(text.slice(from, start)) ? from : start) + text.slice(end + trailing)
}

/** Adds an object definition to its `isa` section, creating the section when the project has none yet. */
export function addObject(text: string, isa: string, definition: string): string {
  const marker = `/* End ${isa} section */`, at = text.indexOf(marker)
  if (at >= 0) return text.slice(0, at) + definition + text.slice(at)
  const objects = dictAt(parsePbx(text), 'objects')
  requireValue(objects, invalid)
  const end = lineStart(text, objects.end)
  return `${text.slice(0, end)}\n/* Begin ${isa} section */\n${definition}${marker}\n${text.slice(end)}`
}
