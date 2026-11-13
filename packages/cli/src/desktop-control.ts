import { stdin } from 'node:process'
import type { Readable } from 'node:stream'

const MAX_CONTROL_BUFFER = 1024

export function isDesktopCancelMessage(line: string): boolean {
  try {
    const value: unknown = JSON.parse(line)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const message = value as Record<string, unknown>
    return Object.keys(message).length === 2
      && Object.hasOwn(message, 'schemaVersion')
      && Object.hasOwn(message, 'kind')
      && message.schemaVersion === 1
      && message.kind === 'cancel'
  } catch {
    return false
  }
}

export function listenForDesktopCancel(controller: AbortController, input: Readable = stdin): () => void {
  let pending = ''
  let oversized = false
  const onData = (chunk: Buffer | string): void => {
    for (const character of String(chunk)) {
      if (character === '\n') {
        if (!oversized && isDesktopCancelMessage(pending.trim())) controller.abort()
        pending = ''
        oversized = false
      } else if (pending.length < MAX_CONTROL_BUFFER) {
        pending += character
      } else {
        pending = ''
        oversized = true
      }
    }
  }
  input.setEncoding('utf8')
  input.on('data', onData)
  return () => input.removeListener('data', onData)
}
