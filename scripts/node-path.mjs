import { delimiter, dirname } from 'node:path'

export function withNodeOnPath(environment, executablePath) {
  const env = { ...environment }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  env[pathKey] = [dirname(executablePath), env[pathKey]].filter(Boolean).join(delimiter)
  return env
}
