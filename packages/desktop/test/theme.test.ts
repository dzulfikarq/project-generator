import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')

function tokens(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1]
  assert.ok(block, `Missing CSS token scope: ${selector}`)
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]))
}

const light = tokens(':root')
const dark = { ...light, ...tokens(':root[data-theme="dark"]') }

function color(token: string, palette: Record<string, string>): string {
  const value = palette[token.replace(/^--/, '')]
  assert.ok(value, `Missing ${token} token`)
  const reference = value.match(/^var\(--([\w-]+)\)$/)
  return reference ? color(reference[1], palette) : value
}

function contrast(first: string, second: string) {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/../g)?.map((channel) => parseInt(channel, 16) / 255)
    assert.equal(channels?.length, 3, `Expected hex color, got ${hex}`)
    const linear = channels!.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (high + 0.05) / (low + 0.05)
}

test('light and dark themes use requested brand tokens and centralized CSS colors', () => {
  assert.equal(light['color-charcoal'], '#2b2d31')
  assert.equal(light['color-off-white'], '#f7f5ef')
  assert.equal(light['color-silver'], '#d9dadc')
  assert.equal(light['color-yellow'], '#ffc93c')
  assert.equal(color('--sidebar-bg', light), '#2b2d31')
  assert.equal(color('--app-bg', light), '#f7f5ef')
  assert.equal(color('--app-bg', dark), '#2b2d31')
  assert.equal(color('--accent', dark), '#ffc93c')

  for (const line of css.split(/\r?\n/)) {
    if (/#[\da-f]{3,8}\b/i.test(line)) assert.match(line, /^\s*--[\w-]+:/, `Color literal outside design tokens: ${line}`)
  }
})

test('Geist font and typography tokens cover UI and technical text', () => {
  assert.match(light['font-sans'] ?? '', /^"Geist Variable"/)
  assert.match(light['font-mono'] ?? '', /^"Geist Mono Variable"/)
  assert.equal(light['font-caption'], '12px')
  assert.equal(light['font-body'], '14px')
  assert.equal(light['line-body'], '1.55')
  assert.equal(light['weight-semibold'], '600')
  assert.match(css, /code, pre, kbd, samp, \.mono-input\s*\{\s*font-family:\s*var\(--font-mono\)/)
})

test('line-height declarations reference defined typography tokens', () => {
  const lineHeights = [...css.matchAll(/line-height\s*:\s*([^;}]+)/g)].map(([, value]) => value.trim())
  assert.ok(lineHeights.length > 0)

  for (const value of lineHeights) {
    const token = value.match(/^var\(--([\w-]+)\)$/)?.[1]
    assert.ok(token && Object.hasOwn(light, token), `Invalid or undefined line-height token: ${value}`)
  }
})

test('dashboard empty state keeps its primary action inside the first viewport', () => {
  assert.match(css, /\.page-content\[aria-labelledby="home-title"\]\s+\.empty-state\s*\{[^}]*padding:\s*16px 24px;/)
})

test('body, muted, semantic status, accent, progress, and borders meet contrast thresholds', () => {
  for (const palette of [light, dark]) {
    const surface = color('--surface', palette)
    const sidebar = color('--sidebar-bg', palette)
    assert.ok(contrast(color('--text', palette), surface) >= 4.5, 'Primary text must meet WCAG AA')
    assert.ok(contrast(color('--muted', palette), surface) >= 4.5, 'Secondary text must meet WCAG AA')
    assert.ok(contrast(color('--accent-foreground', palette), color('--accent', palette)) >= 4.5, 'Accent text must meet WCAG AA')
    assert.ok(contrast(color('--accent-foreground', palette), color('--accent-hover', palette)) >= 4.5, 'Accent hover text must meet WCAG AA')
    assert.ok(contrast(color('--sidebar-text', palette), sidebar) >= 4.5, 'Sidebar text must meet WCAG AA')
    assert.ok(contrast(color('--sidebar-muted', palette), sidebar) >= 4.5, 'Sidebar secondary text must meet WCAG AA')
    assert.ok(contrast(color('--progress', palette), color('--app-bg', palette)) >= 3, 'Progress indicator must remain perceivable')
    assert.ok(contrast(color('--border', palette), surface) >= 3, 'Control boundary must meet non-text contrast')
    assert.ok(contrast(color('--disabled-text', palette), color('--disabled-bg', palette)) >= 4.5, 'Disabled text must remain readable')
    assert.ok(contrast(color('--disabled-border', palette), color('--disabled-bg', palette)) >= 3, 'Disabled control boundary must remain perceivable')
    assert.ok(contrast(color('--focus-ring', palette), surface) >= 3, 'Focus indicator must meet non-text contrast')
    assert.ok(contrast(color('--link', palette), surface) >= 4.5, 'Links must meet WCAG AA')

    for (const [foreground, background] of [['--green', '--green-soft'], ['--amber', '--amber-soft'], ['--red', '--red-soft']]) {
      assert.ok(contrast(color(foreground, palette), color(background, palette)) >= 4.5, `${foreground} must meet WCAG AA`)
    }
  }
})
