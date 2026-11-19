process.env.PG_NATIVE_E2E_PHASE = '07B'
if (process.argv.includes('--success-only')) process.env.PG_NATIVE_E2E_FLOW = 'success-only'
await import('./phase-07a-native-e2e.mjs')
