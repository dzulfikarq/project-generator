import { useEffect, useMemo, useRef, useState } from 'react'
import { Channel, invoke } from '@tauri-apps/api/core'

type Recipe = { id: string; status: string; frontend: string; styling: string }
type Template = { id: string; name: string; variants: { id: string; name: string; default: boolean }[] }
type Catalog = { schemaVersion: number; recipes: Recipe[]; forma: { commitSha: string; templates: Template[] } }
type Selection = {
  projectName: string
  parentDirectory: string
  recipeId: 'FE-01' | 'FE-02'
  templateId?: string
  templateVariantId?: string
}
type Runtime = {
  schemaVersion: number
  mode: 'system' | 'bundled'
  internalDevelopmentMode: boolean
  available: boolean
  version?: string
  executablePath?: string
  message: string
}
type Plan = {
  recipeId: string
  recipeStatus: string
  targetPath: string
  executionAvailable: boolean
  executesDependencyLifecycleScripts: boolean
  warnings: string[]
  steps: { id: string; readableSummary: string; sideEffects: string[] }[]
}
type Doctor = { schemaVersion: number; ready: boolean; tools: { id: string; available: boolean; version?: string; message: string }[]; target: { path: string; available: boolean; message: string } }
type JobEvent = {
  schemaVersion: 1
  jobId: string
  sequence: number
  type: string
  stageId?: string
  stageStatus?: string
  status?: string
  percent?: number
  message: string
  code?: string
}
type DesktopEvent = { schemaVersion: 1; invocationId: string; event: JobEvent }
type DesktopError = { schemaVersion?: number; code?: string; message?: string; nextAction?: string; targetModified?: boolean }

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return 'Desktop command failed. Check local recovery state before retrying.'
}

function errorDetail(error: unknown): DesktopError {
  return typeof error === 'object' && error !== null ? error as DesktopError : { message: errorMessage(error) }
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [recipeId, setRecipeId] = useState<Selection['recipeId']>('FE-01')
  const [projectName, setProjectName] = useState('my-project')
  const [parentDirectory, setParentDirectory] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [templateVariantId, setTemplateVariantId] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [consent, setConsent] = useState(false)
  const [allowPlanned, setAllowPlanned] = useState(false)
  const [invocationId, setInvocationId] = useState<string | null>(null)
  const [events, setEvents] = useState<JobEvent[]>([])
  const [recovery, setRecovery] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<DesktopError | null>(null)
  const completeBeforeStartReturns = useRef(false)

  const selection = useMemo<Selection>(() => ({
    projectName,
    parentDirectory,
    recipeId,
    ...(templateId ? { templateId, ...(templateVariantId ? { templateVariantId } : {}) } : {}),
  }), [projectName, parentDirectory, recipeId, templateId, templateVariantId])
  const activeTemplate = catalog?.forma.templates.find((template) => template.id === templateId)
  const selectedRecipe = catalog?.recipes.find((recipe) => recipe.id === recipeId)
  const canUsePlanned = Boolean(runtime?.internalDevelopmentMode)
  const planAllowsGeneration = Boolean(plan && (plan.executionAvailable || (canUsePlanned && allowPlanned)))
  const canGenerate = Boolean(!busy && !invocationId && plan && doctor?.ready && consent && planAllowsGeneration)

  useEffect(() => {
    void Promise.all([
      invoke<Catalog>('get_catalog').then(setCatalog).catch((cause: unknown) => setError(errorDetail(cause))),
      invoke<Runtime>('get_runtime_status').then(setRuntime).catch((cause: unknown) => setError(errorDetail(cause))),
    ])
  }, [])

  function invalidateReview() {
    setPlan(null)
    setDoctor(null)
    setConsent(false)
    setError(null)
  }

  async function loadPlan() {
    setBusy(true)
    setError(null)
    try {
      setPlan(await invoke<Plan>('resolve_plan', { selection }))
    } catch (cause) {
      setPlan(null)
      setError(errorDetail(cause))
    } finally {
      setBusy(false)
    }
  }

  async function runDoctor() {
    setBusy(true)
    setError(null)
    try {
      setDoctor(await invoke<Doctor>('run_environment_doctor', { selection }))
    } catch (cause) {
      setDoctor(null)
      setError(errorDetail(cause))
    } finally {
      setBusy(false)
    }
  }

  async function startGeneration() {
    if (!canGenerate) return
    setBusy(true)
    setError(null)
    setEvents([])
    completeBeforeStartReturns.current = false
    const channel = new Channel<DesktopEvent>()
    channel.onmessage = ({ invocationId: eventInvocation, event }) => {
      setEvents((current) => [...current.slice(-79), event])
      if (event.type === 'job-finished') {
        completeBeforeStartReturns.current = true
        setInvocationId((current) => current === eventInvocation ? null : current)
        setConsent(false)
      }
    }
    try {
      const id = await invoke<string>('start_generation', {
        selection,
        lifecycleConsent: consent,
        allowPlanned,
        onEvent: channel,
      })
      if (!completeBeforeStartReturns.current) setInvocationId(id)
      setConsent(false)
    } catch (cause) {
      setError(errorDetail(cause))
    } finally {
      setBusy(false)
    }
  }

  async function cancelGeneration() {
    if (!invocationId) return
    try {
      await invoke('cancel_generation', { invocationId })
    } catch (cause) {
      setError(errorDetail(cause))
    }
  }

  async function inspectRecovery() {
    setError(null)
    try {
      setRecovery(await invoke('inspect_recovery'))
    } catch (cause) {
      setError(errorDetail(cause))
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PROJECT GENERATOR / PHASE 02.6</p>
          <h1>Desktop runtime PoC</h1>
        </div>
        <span className="status-pill">INTERNAL — NOT FOR RELEASE</span>
      </header>

      {runtime?.internalDevelopmentMode && (
        <aside className="internal-banner" role="status">
          Internal debug build. Planned-recipe override is evidence-only; recipes remain unavailable in normal use.
        </aside>
      )}

      <section className="runtime-card" aria-labelledby="runtime-title">
        <div>
          <p className="eyebrow">APPLICATION ENGINE</p>
          <h2 id="runtime-title">{runtime?.mode === 'bundled' ? 'Bundled Node runtime' : 'System Node runtime'}</h2>
          <p>{runtime?.message ?? 'Checking selected runtime…'}</p>
        </div>
        <span className={runtime?.available ? 'status-dot ready' : 'status-dot blocked'}>
          {runtime?.available ? `READY ${runtime.version ?? ''}` : 'PREREQUISITE'}
        </span>
      </section>

      <div className="grid">
        <section className="panel" aria-labelledby="catalog-title">
          <div className="section-heading">
            <div><p className="eyebrow">READ ONLY</p><h2 id="catalog-title">Recipe catalog</h2></div>
            <span className="small-tag">all recipes planned</span>
          </div>
          {catalog ? <ul className="catalog-list">
            {catalog.recipes.map((recipe) => <li key={recipe.id}>
              <span><strong>{recipe.id}</strong> · {recipe.frontend.replace('frontend.', '')}</span>
              <span className="planned">{recipe.status.toUpperCase()}</span>
            </li>)}
          </ul> : <p className="muted">Catalog unavailable.</p>}
          <p className="muted">Forma pin: <code>{catalog?.forma.commitSha ?? 'loading'}</code></p>
        </section>

        <section className="panel form-panel" aria-labelledby="plan-title">
          <div className="section-heading">
            <div><p className="eyebrow">NO WRITES</p><h2 id="plan-title">Generation plan</h2></div>
            <span className="small-tag">preview only</span>
          </div>
          <label>Recipe
            <select value={recipeId} onChange={(event) => { setRecipeId(event.target.value as Selection['recipeId']); invalidateReview() }}>
              <option value="FE-01">FE-01 · React + Vite + CSS</option>
              <option value="FE-02">FE-02 · Next.js + Tailwind</option>
            </select>
          </label>
          <label>Project name
            <input value={projectName} maxLength={100} onChange={(event) => { setProjectName(event.target.value); invalidateReview() }} />
          </label>
          <label>New project parent folder
            <input value={parentDirectory} placeholder="C:\\Users\\you\\Projects" onChange={(event) => { setParentDirectory(event.target.value); invalidateReview() }} />
          </label>
          <label>Optional pinned Forma template
            <select value={templateId} onChange={(event) => { setTemplateId(event.target.value); setTemplateVariantId(''); invalidateReview() }}>
              <option value="">No Forma template</option>
              {catalog?.forma.templates.map((template) => <option key={template.id} value={template.id}>{template.name} · planned</option>)}
            </select>
          </label>
          {activeTemplate && <label>Forma variant
            <select value={templateVariantId} onChange={(event) => { setTemplateVariantId(event.target.value); invalidateReview() }}>
              <option value="">Template default</option>
              {activeTemplate.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}
            </select>
          </label>}
          <p className="muted">{selectedRecipe?.status === 'planned' ? 'Disabled in normal use. Internal debug override never changes recipe status.' : 'Recipe status comes from the reviewed catalog.'}</p>
          <div className="button-row">
            <button className="secondary" disabled={busy || Boolean(invocationId)} onClick={() => void loadPlan()}>Resolve plan</button>
            <button className="secondary" disabled={busy || Boolean(invocationId)} onClick={() => void runDoctor()}>Environment doctor</button>
          </div>
          {plan && <div className="result-block">
            <h3>{plan.recipeId} · {plan.recipeStatus.toUpperCase()}</h3>
            <p className="path-line">Target: <code>{plan.targetPath}</code></p>
            <ol>{plan.steps.map((step) => <li key={step.id}>{step.readableSummary}</li>)}</ol>
            {plan.warnings.map((warning) => <p className="warning-text" key={warning}>{warning}</p>)}
          </div>}
          {doctor && <div className="result-block">
            <h3>Environment doctor · {doctor.ready ? 'READY' : 'BLOCKED'}</h3>
            {doctor.tools.map((tool) => <p className="tool-row" key={tool.id}><strong>{tool.available ? 'PASS' : 'BLOCK'}</strong> {tool.id}{tool.version ? ` (${tool.version})` : ''} — {tool.message}</p>)}
            <p className="tool-row"><strong>{doctor.target.available ? 'PASS' : 'BLOCK'}</strong> target — {doctor.target.message}</p>
          </div>}
        </section>
      </div>

      <section className="panel generation-panel" aria-labelledby="generation-title">
        <div className="section-heading">
          <div><p className="eyebrow">AFFIRMATIVE CONSENT REQUIRED</p><h2 id="generation-title">Generation</h2></div>
          {invocationId && <span className="small-tag">JOB {invocationId.slice(0, 8)}</span>}
        </div>
        <div className="disclosure" role="note">
          <strong>Unsandboxed code execution.</strong> npm install can run third-party lifecycle scripts with your Windows user permissions. The Windows Job Object supervises process lifetime; it does not sandbox code. Forma private fetch invokes Git with configured Git/GCM authentication; this PoC does not isolate child processes from account-readable data.
        </div>
        <label className="check-row">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          I understand and consent to npm lifecycle scripts running unsandboxed as my user for this generation.
        </label>
        {canUsePlanned && <label className="check-row internal-check">
          <input type="checkbox" checked={allowPlanned} onChange={(event) => setAllowPlanned(event.target.checked)} />
          Internal evidence run: allow this planned recipe (no status promotion).
        </label>}
        <div className="button-row">
          <button className="primary" disabled={!canGenerate} onClick={() => void startGeneration()}>
            {busy ? 'Working…' : 'Start generation'}
          </button>
          {invocationId && <button className="danger" onClick={() => void cancelGeneration()}>Cancel job</button>}
          <button className="secondary" onClick={() => void inspectRecovery()}>Inspect recovery</button>
        </div>
        {!plan && <p className="muted">Resolve a plan first. No generation starts without lifecycle consent, ready prerequisites, and planned-recipe authorization.</p>}
        {events.length > 0 && <div className="result-block">
          <h3>Job progress</h3>
          <ol className="event-list" aria-live="polite" aria-relevant="additions text">{events.map((event, index) => <li key={`${event.jobId}-${event.sequence}-${index}`}>
            <span className="event-meta">{event.stageId ?? event.type}{event.percent !== undefined ? ` · ${event.percent}%` : ''}</span>
            <span>{event.message}</span>
            {event.code && <code>{event.code}</code>}
          </li>)}</ol>
        </div>}
        {error && <div className="error-box" role="alert">
          <strong>{error.code ?? 'DESKTOP_ERROR'}: {error.message ?? errorMessage(error)}</strong>
          {error.nextAction && <p>Next: {error.nextAction}</p>}
          {error.targetModified && <p>Destination may have changed. Do not overwrite it; inspect both target and recovery state.</p>}
        </div>}
        {recovery !== null && <details className="result-block" open>
          <summary>Recovery inspection</summary>
          <pre>{JSON.stringify(recovery, null, 2)}</pre>
        </details>}
      </section>

      <footer>Internal packaging PoC · FE-01 / FE-02 / FM-01 / FM-02 remain planned · no sandbox or release claim</footer>
    </main>
  )
}
