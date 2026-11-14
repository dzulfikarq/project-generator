export function defaultGoModulePath(projectName: string): string {
  return `example.com/${projectName}`
}

const reservedWindowsNames = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])

function isValidModuleElement(element: string): boolean {
  if (!element || element.startsWith('.') || element.endsWith('.') || !/^[A-Za-z0-9._~-]+$/.test(element)) return false

  const windowsName = element.split('.', 1)[0]!
  if (reservedWindowsNames.has(windowsName.toUpperCase()) || /~[0-9]+$/.test(windowsName)) return false
  return true
}

function isValidMajorSuffix(path: string): boolean {
  if (path.startsWith('gopkg.in/')) {
    const unstable = path.endsWith('-unstable')
    const suffix = unstable ? path.slice(0, -'-unstable'.length) : path
    const major = /\.v([0-9]+)$/.exec(suffix)?.[1]
    return major !== undefined && (major === '0' ? !unstable : !major.startsWith('0'))
  }

  const major = /^v([0-9.]+)$/.exec(path.split('/').at(-1)!)?.[1]
  return major === undefined || (!major.startsWith('0') && major !== '1' && !major.includes('.'))
}

// Mirrors golang.org/x/mod/module.CheckPath; 512 characters is the app's input limit.
export function isValidGoModulePath(value: string): boolean {
  if (!value || value.length > 512 || value.startsWith('/') || value.endsWith('/')) return false
  const parts = value.split('/')
  const domain = parts[0]!
  if (parts.some((part) => !isValidModuleElement(part))) return false
  if (!domain.includes('.') || domain.startsWith('-') || !/^[a-z0-9.-]+$/.test(domain)) return false
  return isValidMajorSuffix(value)
}
