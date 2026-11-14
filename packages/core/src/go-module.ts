export function defaultGoModulePath(projectName: string): string {
  return `example.com/${projectName}`
}

export function isValidGoModulePath(value: string): boolean {
  if (value.length > 512 || value !== value.toLowerCase() || value.startsWith('/') || value.endsWith('/')) return false
  const parts = value.split('/')
  if (parts.length < 2 || (!parts[0]!.includes('.') && parts[0] !== 'localhost')) return false
  if (parts.some((part) => !/^[a-z0-9][a-z0-9._~-]*$/.test(part) || part.endsWith('.') || part.includes('..'))) return false
  return !/^v\d+$/.test(parts.at(-1)!) || Number(parts.at(-1)!.slice(1)) >= 2
}
