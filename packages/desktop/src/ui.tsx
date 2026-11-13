import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Channel, invoke } from '@tauri-apps/api/core'
import {
  canStartGeneration,
  documentationFiles,
  emptyPreferences,
  findFrameworkRecipe,
  findRecipe,
  formaMetadataCompatible,
  loadPreferences,
  savePreferences,
  validateParentDirectory,
  validateProjectName,
  type AppPreferences,
  type Catalog,
  type ProjectRecord,
  type Theme,
} from './model.js'

type Page = 'home' | 'create' | 'templates' | 'projects' | 'settings' | 'generation' | 'result'
type WizardStep = 'details' | 'stack' | 'design' | 'docs' | 'review'
type RecipeId = 'FE-01' | 'FE-02'
type Documentation = 'minimal' | 'standard' | 'full'
type Selection = {
  projectName: string
  parentDirectory: string
  recipeId: RecipeId
  documentation: Documentation
  templateId?: string
  templateVariantId?: string
}
type Runtime = {
  mode: 'system' | 'bundled'
  internalDevelopmentMode: boolean
  available: boolean
  version?: string
  message: string
}
type Plan = {
  recipeId: string
  recipeStatus: string
  targetPath: string
  executionAvailable: boolean
  executesDependencyLifecycleScripts: boolean
  expectedWrites: string[]
  networkAccess: string[]
  warnings: string[]
  steps: { id: string; readableSummary: string; sideEffects: string[] }[]
}
type Doctor = {
  ready: boolean
  tools: { id: string; available: boolean; version?: string; message: string }[]
  target: { path: string; available: boolean; message: string }
}
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
type DesktopError = { code?: string; message?: string; nextAction?: string; targetModified?: boolean }

const WIZARD_STEPS: { id: WizardStep; label: string; hint: string }[] = [
  { id: 'details', label: 'Project details', hint: 'Name and destination' },
  { id: 'stack', label: 'Framework', hint: 'Catalog-backed choices' },
  { id: 'design', label: 'Tools and template', hint: 'Styling, npm, Forma' },
  { id: 'docs', label: 'Documentation', hint: 'Generated file set' },
  { id: 'review', label: 'Review and create', hint: 'Plan, checks, consent' },
]

function errorDetail(error: unknown): DesktopError {
  if (typeof error === 'object' && error !== null) return error as DesktopError
  return { message: typeof error === 'string' ? error : 'Desktop command failed.' }
}

function pathPreview(parent: string, name: string): string {
  return `${parent.replace(/[\\/]+$/, '')}\\${name}`
}

function displayName(id: string): string {
  return id.replace(/^frontend\./, '').replace(/^styling\./, '').replaceAll('-', ' ')
}

function formatStatus(status: string): string {
  return status.replaceAll('-', ' ')
}

function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  return <span className={`status-pill ${tone}`}>{children}</span>
}

function ErrorNotice({ error, onDismiss }: { error: DesktopError; onDismiss?: () => void }) {
  return <div className="notice notice-error" role="alert">
    <div>
      <strong>{error.code ?? 'ACTION_FAILED'} · {error.message ?? 'Desktop command failed.'}</strong>
      {error.nextAction && <p>Next: {error.nextAction}</p>}
      {error.targetModified && <p>Destination may have changed. Do not overwrite it; inspect the target and recovery state before retrying.</p>}
    </div>
    {onDismiss && <button className="icon-button" aria-label="Dismiss error" onClick={onDismiss}>×</button>}
  </div>
}

function App() {
  const [preferences, setPreferences] = useState<AppPreferences>(() => {
    try { return loadPreferences(window.localStorage) } catch { return emptyPreferences() }
  })
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [vscodeAvailable, setVscodeAvailable] = useState(false)
  const [page, setPage] = useState<Page>('home')
  const [step, setStep] = useState<WizardStep>('details')
  const [projectName, setProjectName] = useState('my-project')
  const [parentDirectory, setParentDirectory] = useState('')
  const [frontendId, setFrontendId] = useState('frontend.react-vite')
  const [stylingId, setStylingId] = useState('styling.css')
  const [managerId, setManagerId] = useState('npm')
  const [templateId, setTemplateId] = useState('')
  const [templateVariantId, setTemplateVariantId] = useState('')
  const [documentation, setDocumentation] = useState<Documentation>('minimal')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [consent, setConsent] = useState(false)
  const [allowPlanned, setAllowPlanned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cancelRequested, setCancelRequested] = useState(false)
  const [invocationId, setInvocationId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<string | null>(null)
  const [events, setEvents] = useState<JobEvent[]>([])
  const [commandError, setCommandError] = useState<DesktopError | null>(null)
  const [recovery, setRecovery] = useState<unknown>(null)
  const [directorySetting, setDirectorySetting] = useState(preferences.defaultParentDirectory)
  const [storageWarning, setStorageWarning] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)
  const invocationRef = useRef<string | null>(null)
  const terminalEventRef = useRef<JobEvent | null>(null)
  const activeProjectRef = useRef<{ name: string; path: string; recipeId: string } | null>(null)

  const recipe = useMemo(() => templateId
    ? findFrameworkRecipe(catalog, frontendId, managerId)
    : findRecipe(catalog, frontendId, stylingId, managerId), [catalog, frontendId, stylingId, managerId, templateId])
  const frontendAdapters = catalog?.adapters.filter((adapter) => adapter.kind === 'frontend') ?? []
  const stylingAdapters = catalog?.adapters.filter((adapter) => adapter.kind === 'styling') ?? []
  const backendAdapters = catalog?.adapters.filter((adapter) => adapter.kind === 'backend') ?? []
  const databaseAdapters = catalog?.adapters.filter((adapter) => adapter.kind === 'database') ?? []
  const selectedFrontend = frontendAdapters.find((adapter) => adapter.id === frontendId)
  const activeTemplate = catalog?.forma.templates.find((template) => template.id === templateId)
  const selectedVariant = activeTemplate?.variants.find((variant) => variant.id === templateVariantId)
  const nameError = validateProjectName(projectName)
  const parentError = validateParentDirectory(parentDirectory)
  const settingsDirectoryError = directorySetting ? validateParentDirectory(directorySetting) : null
  const templateError = activeTemplate && catalog && !formaMetadataCompatible(activeTemplate, frontendId, catalog)
    ? 'This Forma metadata entry does not declare compatibility with the selected framework.'
    : null
  const selection = useMemo<Selection | null>(() => {
    if (!recipe || (recipe.id !== 'FE-01' && recipe.id !== 'FE-02')) return null
    return {
      projectName,
      parentDirectory,
      recipeId: recipe.id,
      documentation,
      ...(templateId ? { templateId, ...(templateVariantId ? { templateVariantId } : {}) } : {}),
    }
  }, [recipe, projectName, parentDirectory, documentation, templateId, templateVariantId])
  const currentStepIndex = WIZARD_STEPS.findIndex((item) => item.id === step)
  const canUsePlanned = Boolean(runtime?.internalDevelopmentMode)
  const canGenerate = canStartGeneration({
    busy,
    invocationActive: Boolean(invocationId),
    hasSelection: Boolean(selection),
    planAvailable: Boolean(plan),
    doctorReady: Boolean(doctor?.ready),
    lifecycleConsent: consent,
    executionAvailable: Boolean(plan?.executionAvailable),
    internalDevelopmentMode: canUsePlanned,
    allowPlanned,
  })

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme
  }, [preferences.theme])

  useEffect(() => {
    let mounted = true
    void invoke<Catalog>('get_catalog').then((value) => { if (mounted) setCatalog(value) }).catch((cause: unknown) => {
      if (mounted) setCommandError(errorDetail(cause))
    })
    void invoke<Runtime>('get_runtime_status').then((value) => { if (mounted) setRuntime(value) }).catch((cause: unknown) => {
      if (mounted) setCommandError(errorDetail(cause))
    })
    void invoke<boolean>('get_vscode_status').then((value) => { if (mounted) setVscodeAvailable(value) }).catch(() => {
      if (mounted) setVscodeAvailable(false)
    })
    return () => { mounted = false }
  }, [])

  function savePreferences(next: AppPreferences): boolean {
    setPreferences(next)
    try {
      const saved = savePreferencesToStorage(next)
      setStorageWarning(!saved)
      return saved
    } catch {
      setStorageWarning(true)
      return false
    }
  }

  function invalidateReview() {
    setPlan(null)
    setDoctor(null)
    setConsent(false)
    setAllowPlanned(false)
    setCommandError(null)
  }

  function startWizard(initialTemplate = '') {
    const template = catalog?.forma.templates.find((item) => item.id === initialTemplate)
    const defaultRecipe = catalog?.recipes.find((item) => item.id === 'FE-01' && (!template || template.testedFrameworks.includes(item.frontend)))
      ?? catalog?.recipes.find((item) => item.id === 'FE-02' && (!template || template.testedFrameworks.includes(item.frontend)))
      ?? catalog?.recipes.find((item) => item.id === 'FE-01')
    setProjectName('my-project')
    setParentDirectory(preferences.defaultParentDirectory)
    setFrontendId(defaultRecipe?.frontend ?? 'frontend.react-vite')
    setStylingId(defaultRecipe?.styling ?? 'styling.css')
    setManagerId(defaultRecipe?.manager ?? 'npm')
    setTemplateId(initialTemplate)
    setTemplateVariantId('')
    setDocumentation('minimal')
    setStep('details')
    setPage('create')
    setEvents([])
    setJobStatus(null)
    setRecovery(null)
    invalidateReview()
  }

  function navigate(next: Page) {
    if (busy || invocationId) return
    setCommandError(null)
    setPage(next)
  }

  function buildSelection(): Selection | null {
    if (!recipe || (recipe.id !== 'FE-01' && recipe.id !== 'FE-02')) return null
    return {
      projectName,
      parentDirectory,
      recipeId: recipe.id,
      documentation,
      ...(templateId ? { templateId, ...(templateVariantId ? { templateVariantId } : {}) } : {}),
    }
  }

  async function loadReview() {
    const currentSelection = buildSelection()
    if (!currentSelection || nameError || parentError || templateError) return
    setBusy(true)
    setCommandError(null)
    setPlan(null)
    setDoctor(null)
    setConsent(false)
    setStep('review')
    try {
      const [nextPlan, nextDoctor] = await Promise.all([
        invoke<Plan>('resolve_plan', { selection: currentSelection }),
        invoke<Doctor>('run_environment_doctor', { selection: currentSelection }),
      ])
      setPlan(nextPlan)
      setDoctor(nextDoctor)
    } catch (cause) {
      setCommandError(errorDetail(cause))
    } finally {
      setBusy(false)
    }
  }

  async function runDoctorAgain() {
    const currentSelection = buildSelection()
    if (!currentSelection) return
    setBusy(true)
    setCommandError(null)
    try {
      setDoctor(await invoke<Doctor>('run_environment_doctor', { selection: currentSelection }))
    } catch (cause) {
      setCommandError(errorDetail(cause))
    } finally {
      setBusy(false)
    }
  }

  function recordGeneratedProject(event: JobEvent) {
    if ((event.status !== 'completed' && event.status !== 'partial') || !activeProjectRef.current) return
    const current = activeProjectRef.current
    const record: ProjectRecord = {
      ...current,
      status: event.status,
      createdAt: new Date().toISOString(),
    }
    const next: AppPreferences = {
      ...preferences,
      projects: [record, ...preferences.projects.filter((project) => project.path.toLowerCase() !== record.path.toLowerCase())].slice(0, 30),
    }
    savePreferences(next)
  }

  function acceptTerminalEvent(event: JobEvent) {
    terminalEventRef.current = event
    setJobStatus(event.status ?? 'failed')
    setInvocationId(null)
    invocationRef.current = null
    setCancelRequested(false)
    setConsent(false)
    setBusy(false)
    recordGeneratedProject(event)
    setPage('result')
  }

  async function startGeneration() {
    const currentSelection = buildSelection()
    if (!canGenerate || !currentSelection || !plan) return
    setBusy(true)
    setCommandError(null)
    setEvents([])
    setJobStatus(null)
    setRecovery(null)
    setCancelRequested(false)
    terminalEventRef.current = null
    invocationRef.current = null
    activeProjectRef.current = { name: projectName, path: plan.targetPath, recipeId: plan.recipeId }
    setPage('generation')
    const channel = new Channel<DesktopEvent>()
    channel.onmessage = ({ invocationId: eventInvocation, event }) => {
      if (invocationRef.current && invocationRef.current !== eventInvocation) return
      setEvents((current) => [...current.slice(-99), event])
      if (event.type === 'job-finished') acceptTerminalEvent(event)
    }
    try {
      const id = await invoke<string>('start_generation', {
        selection: currentSelection,
        lifecycleConsent: consent,
        allowPlanned,
        onEvent: channel,
      })
      invocationRef.current = id
      if (!terminalEventRef.current) setInvocationId(id)
    } catch (cause) {
      setCommandError(errorDetail(cause))
      setStep('review')
      setPage('create')
    } finally {
      setBusy(false)
    }
  }

  async function cancelGeneration() {
    if (!invocationId || cancelRequested) return
    setCancelRequested(true)
    try {
      await invoke('cancel_generation', { invocationId })
    } catch (cause) {
      setCancelRequested(false)
      setCommandError(errorDetail(cause))
    }
  }

  async function inspectRecovery() {
    setBusy(true)
    setCommandError(null)
    try {
      setRecovery(await invoke('inspect_recovery'))
    } catch (cause) {
      setCommandError(errorDetail(cause))
    } finally {
      setBusy(false)
    }
  }

  async function openProject(path: string, command: 'open_project_folder' | 'open_project_in_vscode') {
    setCommandError(null)
    try {
      await invoke(command, { path })
    } catch (cause) {
      setCommandError(errorDetail(cause))
    }
  }

  function chooseTheme(theme: Theme) {
    savePreferences({ ...preferences, theme })
  }

  function saveSettings() {
    if (!savePreferences({ ...preferences, defaultParentDirectory: directorySetting })) {
      setSettingsSaved(false)
      return
    }
    setSettingsSaved(true)
    window.setTimeout(() => setSettingsSaved(false), 2200)
  }

  function createSelectionError(): string | null {
    if (!recipe) return 'Choose a framework, styling option, and package manager combination present in the recipe catalog.'
    if (!nameError && !parentError && !templateError) return null
    return nameError ?? parentError ?? templateError
  }

  const currentProject = activeProjectRef.current
  const hasGeneratedProject = jobStatus === 'completed' || jobStatus === 'partial'
  const jobTone = jobStatus === 'completed' ? 'good' : jobStatus === 'partial' ? 'warn' : jobStatus === 'cancelled' ? 'neutral' : 'bad'
  const resultClass = jobStatus === 'completed' ? 'completed' : jobStatus === 'partial' ? 'partial' : jobStatus === 'cancelled' ? 'cancelled' : 'failed'

  return <div className="app-frame">
    <aside className="sidebar">
      <button className="brand" disabled={busy || Boolean(invocationId)} onClick={() => navigate('home')} aria-label="Project Generator home">
        <span className="brand-mark">PG</span>
        <span><strong>Project Generator</strong><small>LOCAL DESKTOP</small></span>
      </button>
      <nav className="primary-nav" aria-label="Main navigation">
        {([
          ['home', '⌂', 'Overview'], ['create', '+', 'Create project'], ['templates', '◈', 'Forma gallery'], ['projects', '▤', 'Recent projects'], ['settings', '⚙', 'Settings'],
        ] as [Page, string, string][]).map(([target, icon, label]) => <button
          key={target}
          className={page === target ? 'nav-item active' : 'nav-item'}
          aria-current={page === target ? 'page' : undefined}
          disabled={(!catalog && target !== 'settings') || busy || Boolean(invocationId)}
          onClick={() => target === 'create' ? startWizard() : navigate(target)}
        ><span className="nav-icon" aria-hidden="true">{icon}</span>{label}</button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="engine-mini">
          <span className={runtime?.available ? 'engine-indicator online' : 'engine-indicator'} />
          <span><strong>{runtime?.available ? 'Engine ready' : 'Checking engine'}</strong><small>{runtime?.mode === 'bundled' ? 'Bundled runtime' : 'System runtime'}</small></span>
        </div>
        <p>Internal development build<br />No release approval</p>
      </div>
    </aside>

    <main className="main-area">
      <header className="page-topbar">
        <div className="breadcrumbs"><span>Project Generator</span><span aria-hidden="true">/</span><strong>{page === 'create' ? 'New project' : page === 'home' ? 'Overview' : page === 'templates' ? 'Forma gallery' : page === 'projects' ? 'Recent projects' : page === 'settings' ? 'Settings' : page === 'generation' ? 'Generating' : 'Project result'}</strong></div>
        <div className="topbar-right"><StatusPill tone="warn">LOCAL ONLY · NOT RELEASE APPROVED</StatusPill><span className="avatar" aria-label="Local user">L</span></div>
      </header>

      {runtime?.internalDevelopmentMode && <div className="internal-banner" role="status">
        <strong>Internal debug build.</strong> Planned-recipe override is evidence-only. It does not promote FE/FM recipes or authorize release.
      </div>}
      {commandError && <ErrorNotice error={commandError} onDismiss={() => setCommandError(null)} />}
      {storageWarning && <div className="notice notice-warn" role="status"><span>Local settings could not be saved. Check app storage permissions.</span><button className="icon-button" aria-label="Dismiss storage warning" onClick={() => setStorageWarning(false)}>×</button></div>}

      {!catalog && page !== 'settings' && <section className="loading-card" role="status"><span className="spinner" /> Loading the packaged adapter catalog…</section>}

      {page === 'home' && <section className="page-content" aria-labelledby="home-title">
        <div className="hero-row">
          <div><p className="eyebrow">YOUR LOCAL PROJECT WORKSPACE</p><h1 id="home-title">Start something new.</h1><p className="lead">Choose a catalog-backed frontend, review every step, then create a new project in a folder you control.</p></div>
          <button className="button primary-button hero-action" disabled={!catalog} onClick={() => startWizard()}><span aria-hidden="true">＋</span> Create project</button>
        </div>

        <div className="overview-grid">
          <article className="overview-card engine-card">
            <div className="card-icon purple-icon" aria-hidden="true">⌘</div>
            <div><p className="eyebrow">APPLICATION ENGINE</p><h2>{runtime?.available ? 'Ready to plan' : 'Runtime needs attention'}</h2><p>{runtime?.message ?? 'Checking the selected Node.js runtime…'}</p>{runtime?.version && <span className="subtle-tag">Node {runtime.version}</span>}</div>
          </article>
          <article className="overview-card">
            <div className="card-icon green-icon" aria-hidden="true">✓</div>
            <div><p className="eyebrow">GENERATION CHECKS</p><h2>Checked per project</h2><p>Node, npm, and destination checks run after you choose a stack. Nothing installs during planning.</p></div>
          </article>
          <article className="overview-card">
            <div className="card-icon amber-icon" aria-hidden="true">!</div>
            <div><p className="eyebrow">RECIPE STATUS</p><h2>{catalog?.recipes.length ?? 0} planned recipes</h2><p>All current recipes remain unavailable for normal generation pending independent review.</p></div>
          </article>
        </div>

        <section className="content-section" aria-labelledby="recent-home-title">
          <div className="section-title-row"><div><p className="eyebrow">YOUR WORK</p><h2 id="recent-home-title">Recent projects</h2></div><button className="text-button" onClick={() => navigate('projects')}>View history <span aria-hidden="true">→</span></button></div>
          {preferences.projects.length === 0 ? <div className="empty-state">
            <div className="empty-illustration" aria-hidden="true"><span>⌘</span><i>+</i></div>
            <h3>No projects yet</h3><p>Projects you generate will appear here. The app never scans your folders.</p>
            <button className="button secondary-button" disabled={!catalog} onClick={() => startWizard()}>Create your first project</button>
          </div> : <ProjectList projects={preferences.projects.slice(0, 3)} vscodeAvailable={vscodeAvailable} onOpen={openProject} />}
        </section>

        <section className="promo-card">
          <div className="promo-mark" aria-hidden="true">F</div><div><p className="eyebrow">OPTIONAL STARTING POINT</p><h2>Explore Forma templates</h2><p>Browse pinned metadata and declared framework compatibility. Forma compatibility does not mean Project Generator support.</p></div><button className="button secondary-button" onClick={() => navigate('templates')}>Browse gallery <span aria-hidden="true">→</span></button>
        </section>

        <section className="recovery-strip"><div><strong>Need to inspect an interrupted run?</strong><p>Read-only recovery inspection does not apply changes.</p></div><button className="button quiet-button" disabled={busy} onClick={() => void inspectRecovery()}>Inspect recovery</button></section>
        {recovery !== null && <RecoveryDetails value={recovery} />}
      </section>}

      {page === 'create' && <section className="page-content wizard-page" aria-labelledby="wizard-title">
        <div className="wizard-heading"><div><p className="eyebrow">NEW PROJECT · STEP {currentStepIndex + 1} OF {WIZARD_STEPS.length}</p><h1 id="wizard-title">Build your project setup</h1><p className="lead">Choose only from adapters and combinations present in the packaged catalog.</p></div><button className="button quiet-button" disabled={busy} onClick={() => navigate('home')}>Save for later</button></div>
        <div className="wizard-layout">
          <nav className="step-nav" aria-label="Project setup steps">
            {WIZARD_STEPS.map((item, index) => <button key={item.id} className={`step-nav-item ${step === item.id ? 'selected' : ''} ${index < currentStepIndex ? 'visited' : ''}`} disabled={busy || index > currentStepIndex} onClick={() => setStep(item.id)} aria-current={step === item.id ? 'step' : undefined}>
              <span className="step-number">{index < currentStepIndex ? '✓' : index + 1}</span><span><strong>{item.label}</strong><small>{item.hint}</small></span>
            </button>)}
            <div className="step-nav-note"><strong>New folders only</strong><p>Planning and navigation do not write to your destination.</p></div>
          </nav>
          <div className="wizard-main">
            {step === 'details' && <section className="wizard-card" aria-labelledby="details-title">
              <div className="section-title-row"><div><p className="eyebrow">01 · PROJECT</p><h2 id="details-title">Where should we create it?</h2></div><StatusPill>Required</StatusPill></div>
              <p className="section-intro">We create one new folder inside your destination. Existing projects are never modified.</p>
              <label className="field-label" htmlFor="project-name">Project folder name</label>
              <input id="project-name" className="text-input" disabled={busy} value={projectName} maxLength={100} autoComplete="off" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? 'project-name-error' : 'project-name-help'} onChange={(event) => { setProjectName(event.target.value); invalidateReview() }} />
              {nameError ? <p id="project-name-error" className="field-error">{nameError}</p> : <p id="project-name-help" className="field-help">Lowercase npm-safe name. Avoid spaces; use hyphens.</p>}
              <label className="field-label" htmlFor="project-parent">Parent folder</label>
              <input id="project-parent" className="text-input mono-input" disabled={busy} value={parentDirectory} maxLength={220} placeholder="C:\Users\you\Projects" autoComplete="off" aria-invalid={Boolean(parentError)} aria-describedby={parentError ? 'project-parent-error' : 'project-parent-help'} onChange={(event) => { setParentDirectory(event.target.value); invalidateReview() }} />
              {parentError ? <p id="project-parent-error" className="field-error">{parentError}</p> : <p id="project-parent-help" className="field-help">Choose an existing local Windows folder. Network and device paths are blocked.</p>}
              <div className="path-preview"><span className="preview-icon" aria-hidden="true">↳</span><div><small>NEW PROJECT LOCATION</small><code>{parentDirectory ? pathPreview(parentDirectory, projectName || 'project-name') : 'Choose a parent folder to preview destination'}</code></div></div>
              <div className="wizard-actions"><span /> <button className="button primary-button" disabled={Boolean(nameError || parentError || busy)} onClick={() => setStep('stack')}>Choose framework <span aria-hidden="true">→</span></button></div>
            </section>}

            {step === 'stack' && <section className="wizard-card" aria-labelledby="stack-title">
              <div className="section-title-row"><div><p className="eyebrow">02 · FRAMEWORK</p><h2 id="stack-title">Choose a project type</h2></div><StatusPill tone="warn">Planned recipes</StatusPill></div>
              <p className="section-intro">Framework options come from the packaged adapter catalog. Planned means browse and plan only in normal builds.</p>
              <fieldset className="choice-fieldset"><legend>Frontend framework</legend><div className="choice-grid">
                {frontendAdapters.map((adapter) => {
                  const adapterRecipe = catalog?.recipes.find((item) => item.frontend === adapter.id && (item.id === 'FE-01' || item.id === 'FE-02'))
                  const enabled = Boolean(adapterRecipe)
                  return <button type="button" key={adapter.id} className={`select-card ${frontendId === adapter.id ? 'chosen' : ''}`} disabled={!enabled || busy} onClick={() => {
                    if (!adapterRecipe) return
                    setFrontendId(adapter.id)
                    invalidateReview()
                  }} aria-pressed={frontendId === adapter.id}>
                    <span className="select-card-top"><span className="framework-monogram">{adapter.displayName.startsWith('Next') ? 'N' : 'R'}</span><StatusPill tone="warn">{adapterRecipe?.status ?? 'Catalog only'}</StatusPill></span>
                    <strong>{adapter.displayName}</strong><small>{adapterRecipe ? `${adapterRecipe.id} · TypeScript · ${adapterRecipe.manager}` : 'No desktop recipe maps to this adapter.'}</small>
                  </button>
                })}
              </div></fieldset>
              <div className="unsupported-grid">
                <UnsupportedGroup title="Other frameworks" description="Vue, Angular, Nuxt, and other future frameworks are not in the packaged adapter catalog." entries={[]} />
                <UnsupportedGroup title="Backend" description="No backend adapters are implemented in this phase." entries={backendAdapters.map((adapter) => adapter.displayName)} />
                <UnsupportedGroup title="Database" description="No database adapters or migration tools are implemented." entries={databaseAdapters.map((adapter) => adapter.displayName)} />
                <UnsupportedGroup title="Full-stack / mobile" description="Outside current frontend-only generator scope." entries={[]} />
              </div>
              <div className="wizard-actions"><button className="button secondary-button" disabled={busy} onClick={() => setStep('details')}>Back</button><button className="button primary-button" disabled={!selectedFrontend || busy} onClick={() => setStep('design')}>Choose tools <span aria-hidden="true">→</span></button></div>
            </section>}

            {step === 'design' && <section className="wizard-card" aria-labelledby="design-title">
              <div className="section-title-row"><div><p className="eyebrow">03 · TOOLING</p><h2 id="design-title">Styling and starting template</h2></div><StatusPill>Catalog-backed</StatusPill></div>
              <p className="section-intro">Only combinations with an existing recipe can be selected. Framework changes never silently replace your styling choice.</p>
              {!templateId ? <fieldset className="choice-fieldset"><legend>Styling</legend><div className="compact-choice-grid">
                {stylingAdapters.map((adapter) => {
                  const compatible = adapter.compatibleWith.includes(frontendId)
                  const matches = Boolean(catalog?.recipes.some((item) => item.frontend === frontendId && item.styling === adapter.id && item.manager === managerId && (item.id === 'FE-01' || item.id === 'FE-02')))
                  const enabled = compatible && matches
                  return <button type="button" key={adapter.id} className={`compact-choice ${stylingId === adapter.id ? 'chosen' : ''}`} disabled={!enabled || busy} onClick={() => { setStylingId(adapter.id); invalidateReview() }} aria-pressed={stylingId === adapter.id}>
                    <span className="radio-dot" aria-hidden="true" /><span><strong>{adapter.displayName}</strong><small>{enabled ? `Compatible with ${selectedFrontend?.displayName ?? 'selected framework'}` : compatible ? 'No compatible recipe is cataloged.' : `Not compatible with ${selectedFrontend?.displayName ?? 'selected framework'}.`}</small></span>
                  </button>
                })}
              </div>{!recipe && <p className="field-error">Current framework and styling selection has no catalog recipe. Select a compatible style.</p>}</fieldset>
                : <div className="template-style-note"><strong>{activeTemplate?.name ?? 'Forma template'} supplies its own styling.</strong><span>The separate styling adapter is omitted from this selection. Clear the template below if you want to choose a catalog styling option.</span></div>}

              <fieldset className="choice-fieldset manager-fieldset"><legend>Package manager</legend><div className="manager-row">
                {['npm', 'pnpm', 'Yarn', 'Bun'].map((manager) => {
                  const normalized = manager.toLowerCase()
                  const available = Boolean(selectedFrontend?.packageManagers.includes(normalized) && (templateId
                    ? findFrameworkRecipe(catalog, frontendId, normalized)
                    : catalog?.recipes.some((item) => item.frontend === frontendId && item.styling === stylingId && item.manager === normalized && (item.id === 'FE-01' || item.id === 'FE-02'))))
                  return <button type="button" className={`manager-choice ${managerId === normalized ? 'chosen' : ''}`} key={manager} disabled={!available || busy} onClick={() => { setManagerId(normalized); invalidateReview() }} aria-pressed={managerId === normalized}>
                    <strong>{manager}</strong>{available ? <small>Catalog default</small> : <small>Not supported</small>}
                  </button>
                })}
              </div><p className="field-help">Node recipes use npm by default. Other managers remain disabled until catalog support exists.</p></fieldset>

              <fieldset className="choice-fieldset forma-picker"><legend>Forma template <span className="optional-label">Optional</span></legend>
                <button type="button" className={`template-select-row ${templateId === '' ? 'chosen' : ''}`} onClick={() => { setTemplateId(''); setTemplateVariantId(''); invalidateReview() }} aria-pressed={templateId === ''}>
                  <span className="radio-dot" aria-hidden="true" /><span><strong>Start with framework scaffold</strong><small>No Forma files will be fetched.</small></span>
                </button>
                <div className="mini-template-grid">
                  {catalog?.forma.templates.map((template) => {
                    const metadataCompatible = formaMetadataCompatible(template, frontendId, catalog)
                    const usableRecipe = Boolean(findFrameworkRecipe(catalog, frontendId, managerId))
                    const enabled = metadataCompatible && usableRecipe
                    const defaultVariant = template.variants.find((variant) => variant.default) ?? template.variants[0]
                    return <button type="button" className={`mini-template ${templateId === template.id ? 'chosen' : ''}`} key={template.id} disabled={!enabled || busy} onClick={() => { setTemplateId(template.id); setTemplateVariantId(''); invalidateReview() }} aria-pressed={templateId === template.id}>
                      <span className="mini-template-swatch" style={{ background: defaultVariant && /^\d{1,3} \d{1,3}% \d{1,3}%$/.test(defaultVariant.accent) ? `hsl(${defaultVariant.accent})` : 'var(--accent)' }} />
                      <strong>{template.name}</strong><small>{enabled ? 'Forma metadata compatible' : 'Not compatible with this catalog recipe'}</small>
                    </button>
                  })}
                </div>
                {activeTemplate && <div className="variant-row"><label htmlFor="forma-variant">Color variant</label><select id="forma-variant" className="select-input" disabled={busy} value={templateVariantId} onChange={(event) => { setTemplateVariantId(event.target.value); invalidateReview() }}>
                  <option value="">Default · {activeTemplate.variants.find((variant) => variant.default)?.name ?? 'template default'}</option>
                  {activeTemplate.variants.filter((variant) => !variant.default).map((variant) => <option value={variant.id} key={variant.id}>{variant.name}</option>)}
                </select></div>}
                <p className="form-note">Forma compatibility is metadata from a pinned external snapshot, not Project Generator support. Private source fetch uses your configured Git credentials only after generation starts.</p>
              </fieldset>
              <div className="wizard-actions"><button className="button secondary-button" disabled={busy} onClick={() => setStep('stack')}>Back</button><button className="button primary-button" disabled={!recipe || Boolean(templateError) || busy} onClick={() => setStep('docs')}>Documentation <span aria-hidden="true">→</span></button></div>
            </section>}

            {step === 'docs' && <section className="wizard-card" aria-labelledby="docs-title">
              <div className="section-title-row"><div><p className="eyebrow">04 · DOCUMENTATION</p><h2 id="docs-title">Choose generated project docs</h2></div><StatusPill>Preview</StatusPill></div>
              <p className="section-intro">These files are generated under the new project only. Existing files are never scanned or indexed.</p>
              <div className="docs-options" role="radiogroup" aria-label="Documentation level">
                {([
                  ['minimal', 'Minimal', 'README and setup guide.'],
                  ['standard', 'Standard', 'Adds agent instructions, architecture, and testing guide.'],
                  ['full', 'Full', 'Adds project brief, design, decisions, and QA starter docs.'],
                ] as [Documentation, string, string][]).map(([value, title, description]) => <button type="button" role="radio" aria-checked={documentation === value} key={value} className={`docs-card ${documentation === value ? 'chosen' : ''}`} disabled={busy} onClick={() => { setDocumentation(value); invalidateReview() }}>
                  <span className="radio-dot" aria-hidden="true" /><span><strong>{title}</strong><small>{description}</small><span className="file-count">{documentationFiles(value).length} files</span></span>
                </button>)}
              </div>
              <div className="file-preview"><div className="file-preview-heading"><strong>Included files</strong><span>{documentationFiles(documentation).length} files</span></div><ul>{documentationFiles(documentation).map((file) => <li key={file}><span className="file-glyph" aria-hidden="true">▤</span><code>{file}</code></li>)}</ul></div>
              <div className="wizard-actions"><button className="button secondary-button" disabled={busy} onClick={() => setStep('design')}>Back</button><button className="button primary-button" disabled={Boolean(createSelectionError()) || busy} onClick={() => void loadReview()}>Review configuration <span aria-hidden="true">→</span></button></div>
            </section>}

            {step === 'review' && <section className="wizard-card review-card" aria-labelledby="review-title">
              <div className="section-title-row"><div><p className="eyebrow">05 · FINAL REVIEW</p><h2 id="review-title">Review before creating</h2></div>{plan && <StatusPill tone={plan.executionAvailable ? 'good' : 'warn'}>{plan.recipeStatus.toUpperCase()}</StatusPill>}</div>
              {busy && <div className="inline-loading" role="status"><span className="spinner" /> Resolving read-only plan and checking prerequisites…</div>}
              {!busy && !plan && <div className="review-empty"><p>{commandError ? 'Review could not be completed.' : 'Resolve the configuration to load current plan and environment checks.'}</p><button className="button secondary-button" disabled={!selection} onClick={() => void loadReview()}>Resolve plan and run checks</button></div>}
              {plan && <>
                <div className="stack-summary"><div><small>PROJECT</small><strong>{projectName}</strong><code>{plan.targetPath}</code></div><div><small>STACK</small><strong>{selectedFrontend?.displayName ?? frontendId} + {activeTemplate ? 'Forma-managed styling' : stylingAdapters.find((adapter) => adapter.id === stylingId)?.displayName ?? stylingId}</strong><span>{plan.recipeId} · TypeScript · {managerId} · {documentation} docs</span></div>{activeTemplate && <div><small>FORMA TEMPLATE</small><strong>{activeTemplate.name}</strong><span>{selectedVariant?.name ?? activeTemplate.variants.find((variant) => variant.default)?.name ?? 'Default'} variant · planned integration</span></div>}</div>

                <div className="review-section"><div className="review-section-heading"><div><span className="review-icon" aria-hidden="true">✓</span><h3>Environment checks</h3></div><StatusPill tone={doctor?.ready ? 'good' : 'bad'}>{doctor?.ready ? 'READY' : 'BLOCKED'}</StatusPill></div>
                  {doctor?.tools.filter((tool) => tool.id !== 'target').map((tool) => <div className="doctor-row" key={tool.id}><span className={tool.available ? 'check-state ok' : 'check-state missing'} aria-hidden="true">{tool.available ? '✓' : '!'}</span><div><strong>{tool.id}{tool.version ? ` · ${tool.version}` : ''}</strong><small>{tool.message}</small></div><span className={tool.available ? 'doctor-status ok' : 'doctor-status missing'}>{tool.available ? 'Ready' : 'Required'}</span></div>)}
                  {doctor && <div className="doctor-row"><span className={doctor.target.available ? 'check-state ok' : 'check-state missing'} aria-hidden="true">{doctor.target.available ? '✓' : '!'}</span><div><strong>Destination</strong><small>{doctor.target.message}</small></div><span className={doctor.target.available ? 'doctor-status ok' : 'doctor-status missing'}>{doctor.target.available ? 'Available' : 'Blocked'}</span></div>}
                  <button className="text-button refresh-button" disabled={busy} onClick={() => void runDoctorAgain()}>Run checks again</button>
                </div>

                <div className="review-section"><div className="review-section-heading"><div><span className="review-icon" aria-hidden="true">↗</span><h3>What will happen</h3></div></div>
                  <ol className="plan-steps">{plan.steps.map((item) => <li key={item.id}><span className="plan-step-id">{item.id}</span><div><strong>{item.readableSummary}</strong>{item.sideEffects.length > 0 && <ul>{item.sideEffects.map((effect) => <li key={effect}>{effect}</li>)}</ul>}</div></li>)}</ol>
                </div>

                <div className="review-section"><div className="review-section-heading"><div><span className="review-icon" aria-hidden="true">▤</span><h3>Files and network</h3></div></div>
                  <details className="disclosure-details"><summary>Expected project files ({plan.expectedWrites.length})</summary><ul className="compact-list">{plan.expectedWrites.map((file) => <li key={file}><code>{file}</code></li>)}</ul></details>
                  <details className="disclosure-details"><summary>Network operations ({plan.networkAccess.length})</summary><ul className="compact-list">{plan.networkAccess.map((host) => <li key={host}>{host}</li>)}</ul></details>
                </div>

                {plan.warnings.length > 0 && <div className="risk-box"><strong>Risks and limitations</strong><ul>{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
                <div className="consent-box"><p className="eyebrow">YOUR APPROVAL REQUIRED</p><strong>Dependency lifecycle scripts run without a sandbox.</strong><p>npm installation can execute third-party scripts with your Windows user permissions. Process supervision does not sandbox those scripts. Network access and generated validation commands are listed above.</p>
                  <label className="check-line"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I understand and consent to lifecycle scripts running unsandboxed for this generation.</span></label>
                </div>
                {canUsePlanned && !plan.executionAvailable && <label className="internal-consent"><input type="checkbox" checked={allowPlanned} onChange={(event) => setAllowPlanned(event.target.checked)} /><span><strong>Internal evidence run only:</strong> allow this planned recipe. Recipe remains unavailable in normal builds and is not promoted.</span></label>}
                {!plan.executionAvailable && !canUsePlanned && <div className="blocked-callout"><strong>Generation unavailable in normal builds.</strong><span>This recipe remains planned pending independent acceptance and review.</span></div>}
                <div className="wizard-actions"><button className="button secondary-button" disabled={busy} onClick={() => { setConsent(false); setStep('docs') }}>Back to setup</button><button className="button primary-button" disabled={!canGenerate} onClick={() => void startGeneration()}>{busy ? 'Starting…' : 'Create project'} <span aria-hidden="true">→</span></button></div>
                {!consent && <p className="footer-hint">Generation stays blocked until you affirm the lifecycle-script consent above.</p>}
              </>}
            </section>}
          </div>
        </div>
      </section>}

      {page === 'templates' && <section className="page-content" aria-labelledby="templates-title">
        <div className="page-heading"><div><p className="eyebrow">PINNED FORMA METADATA</p><h1 id="templates-title">Forma gallery</h1><p className="lead">Browse templates from the packaged catalog. No private source is fetched until an explicitly consented generation starts.</p></div></div>
        <div className="gallery-note"><strong>Compatibility is not support.</strong> Framework compatibility below comes from Forma's pinned metadata. Every Project Generator recipe remains planned; gallery browsing makes no network requests.</div>
        <div className="template-grid">{catalog?.forma.templates.map((template) => {
          const defaultVariant = template.variants.find((variant) => variant.default) ?? template.variants[0]
          const compatNames = template.testedFrameworks.map((id) => frontendAdapters.find((adapter) => adapter.id === id)?.displayName ?? displayName(id))
          return <article className="template-card" key={template.id}>
            <div className="template-art" aria-label="Metadata illustration; no live template preview" style={{ '--template-accent': defaultVariant && /^\d{1,3} \d{1,3}% \d{1,3}%$/.test(defaultVariant.accent) ? `hsl(${defaultVariant.accent})` : 'var(--accent)' } as CSSProperties}>
              <div className="art-window"><span /><span /><span /><div className="art-sidebar" /><div className="art-line line-one" /><div className="art-line line-two" /><div className="art-chart" /></div>
              <span className="art-category">NO LIVE PREVIEW</span>
            </div>
            <div className="template-card-body"><div className="template-title"><div><h2>{template.name}</h2><span className="template-version">v{template.version} · {template.license}</span></div><StatusPill tone="warn">PLANNED</StatusPill></div>
              <p>{template.description}</p><div className="template-tags">{template.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <div className="template-meta"><small>Category · {template.category.replaceAll('-', ' ')}</small><small>FORMA metadata compatibility</small><strong>{compatNames.join(' · ') || 'No declared framework'}</strong><small>SHA-256 · {template.contentHash.slice(0, 16)}…</small></div>
              <div className="variant-swatches" aria-label="Color variants">{template.variants.map((variant) => <span key={variant.id} title={variant.name} className="variant-swatch" style={{ background: /^\d{1,3} \d{1,3}% \d{1,3}%$/.test(variant.accent) ? `hsl(${variant.accent})` : 'var(--accent)' }} />)}<small>{template.variants.map((variant) => variant.name).join(' · ')}</small></div>
              <button className="button secondary-button template-cta" disabled={!catalog} onClick={() => startWizard(template.id)}>Use this template <span aria-hidden="true">→</span></button>
            </div>
          </article>
        })}</div>
        {catalog && <p className="catalog-pin">Catalog commit <code>{catalog.forma.commitSha}</code> · Metadata only; no live preview is packaged.</p>}
      </section>}

      {page === 'projects' && <section className="page-content" aria-labelledby="projects-title">
        <div className="page-heading"><div><p className="eyebrow">LOCAL METADATA ONLY</p><h1 id="projects-title">Recent projects</h1><p className="lead">Only projects generated by this app appear here. Project folders are never indexed.</p></div><button className="button primary-button" disabled={!catalog} onClick={() => startWizard()}>＋ Create project</button></div>
        {preferences.projects.length === 0 ? <div className="empty-state large-empty"><div className="empty-illustration" aria-hidden="true"><span>▤</span></div><h2>No generated projects yet</h2><p>Once generation completes, project name, location, recipe, and result status are stored locally.</p><button className="button primary-button" disabled={!catalog} onClick={() => startWizard()}>Create project</button></div> : <ProjectList projects={preferences.projects} vscodeAvailable={vscodeAvailable} onOpen={openProject} />}
      </section>}

      {page === 'settings' && <section className="page-content settings-page" aria-labelledby="settings-title">
        <div className="page-heading"><div><p className="eyebrow">LOCAL PREFERENCES</p><h1 id="settings-title">Settings</h1><p className="lead">Basic app preferences. No credentials, generation logs, or folder index are stored.</p></div></div>
        <section className="settings-card"><div className="settings-card-heading"><div><h2>Appearance</h2><p>Choose how Project Generator looks on this device.</p></div></div>
          <div className="theme-options" role="radiogroup" aria-label="Color theme">{(['system', 'light', 'dark'] as Theme[]).map((theme) => <button type="button" role="radio" aria-checked={preferences.theme === theme} className={`theme-option ${preferences.theme === theme ? 'selected' : ''}`} key={theme} onClick={() => chooseTheme(theme)}><span className={`theme-preview ${theme}`} aria-hidden="true"><i /><i /><i /></span><strong>{theme.charAt(0).toUpperCase() + theme.slice(1)}</strong>{preferences.theme === theme && <span className="theme-check" aria-hidden="true">✓</span>}</button>)}</div>
        </section>
        <section className="settings-card"><div className="settings-card-heading"><div><h2>Default project location</h2><p>Used to prefill the destination in the create wizard. Must be an existing local folder.</p></div></div>
          <label className="field-label" htmlFor="settings-directory">Parent folder</label><input id="settings-directory" className="text-input mono-input" value={directorySetting} maxLength={220} placeholder="C:\Users\you\Projects" onChange={(event) => { setDirectorySetting(event.target.value); setSettingsSaved(false) }} />
          {settingsDirectoryError && <p className="field-error">{settingsDirectoryError}</p>}
          <div className="settings-actions"><span>{settingsSaved ? <span className="save-confirmation" role="status">Saved locally</span> : ''}</span><button className="button primary-button" disabled={Boolean(settingsDirectoryError)} onClick={saveSettings}>Save settings</button></div>
        </section>
        <section className="settings-card storage-card"><div className="card-icon purple-icon" aria-hidden="true">⌂</div><div><h2>Local data</h2><p>Only appearance, default location, and metadata for generated projects are stored in local app storage. No project contents, credentials, or process logs are saved. History can be cleared from this device.</p><button className="button danger-button" disabled={preferences.projects.length === 0} onClick={() => {
          if (!confirmClearHistory) { setConfirmClearHistory(true); return }
          savePreferences({ ...preferences, projects: [] })
          setConfirmClearHistory(false)
        }}>{confirmClearHistory ? 'Confirm clear history' : 'Clear project history'}</button>{confirmClearHistory && <span className="field-help" role="status">Click again to remove local project metadata.</span>}</div></section>
      </section>}

      {page === 'generation' && <section className="page-content generation-page" aria-labelledby="generation-title">
        <div className="generation-heading"><div className="generation-spinner"><span className="spinner" /></div><p className="eyebrow">GENERATION IN PROGRESS</p><h1 id="generation-title">Creating {currentProject?.name ?? 'your project'}</h1><p className="lead">Keep this window open. Progress comes from the CLI event stream; process output and logs are not shown.</p></div>
        <div className="generation-target"><span className="target-icon" aria-hidden="true">↳</span><div><small>DESTINATION</small><code>{currentProject?.path}</code></div><StatusPill tone="warn">{cancelRequested ? 'Stopping' : invocationId ? 'Running' : 'Starting'}</StatusPill></div>
        <section className="activity-card" aria-labelledby="activity-title"><div className="section-title-row"><div><p className="eyebrow">LIVE JSONL EVENTS</p><h2 id="activity-title">Activity</h2></div><span className="event-count">{events.length} events</span></div>
          {events.length === 0 ? <div className="activity-empty" role="status"><span className="spinner" /> Waiting for CLI progress…</div> : <ol className="activity-list" aria-live="polite" aria-relevant="additions">{events.map((event) => <li className={`activity-event ${event.type === 'error' ? 'event-error' : ''}`} key={`${event.jobId}-${event.sequence}`}><span className="event-marker" aria-hidden="true">{event.type === 'job-finished' ? '✓' : event.type === 'error' ? '!' : '·'}</span><div><div className="event-heading"><strong>{formatStatus(event.stageId ?? event.type)}</strong>{event.percent !== undefined && <span>{event.percent}%</span>}</div><p>{event.message}</p>{event.code && <code>{event.code}</code>}</div></li>)}</ol>}
        </section>
        <div className="cancel-row"><p>Generation writes only to owned staging and commits only if destination remains absent.</p><button className="button danger-button" disabled={!invocationId || cancelRequested} onClick={() => void cancelGeneration()}>{cancelRequested ? 'Stopping…' : 'Cancel generation'}</button></div>
      </section>}

      {page === 'result' && <section className="page-content result-page" aria-labelledby="result-title">
        <div className={`result-hero ${resultClass}`}><span className="result-symbol" aria-hidden="true">{jobStatus === 'completed' ? '✓' : jobStatus === 'partial' ? '!' : jobStatus === 'cancelled' ? '–' : '×'}</span><p className="eyebrow">GENERATION RESULT</p><h1 id="result-title">{jobStatus === 'completed' ? 'Project checks passed' : jobStatus === 'partial' ? 'Project created with cleanup attention' : jobStatus === 'cancelled' ? 'Generation cancelled' : 'Generation did not complete'}</h1><p>{jobStatus === 'completed' ? 'The generated project passed the checks reported below.' : jobStatus === 'partial' ? 'A project was finalized, but staging cleanup needs manual attention.' : jobStatus === 'cancelled' ? 'Cancellation completed. Check recovery state before retrying.' : 'Do not assume the destination is untouched. Inspect the folder and recovery state before retrying.'}</p>
          <div className="result-caveat"><strong>Recipe remains planned.</strong> This internal evidence run does not promote FE/FM recipes, verify independent acceptance, or approve public release.</div>
        </div>
        {currentProject && <div className="result-project-card"><div className="result-project-icon" aria-hidden="true">⌘</div><div className="result-project-details"><p className="eyebrow">{jobStatus === 'completed' ? 'GENERATED PROJECT' : 'REQUESTED DESTINATION'}</p><h2>{currentProject.name}</h2><code>{currentProject.path}</code><div className="result-tags"><span>{currentProject.recipeId}</span><span>{jobStatus ? formatStatus(jobStatus) : 'Unknown status'}</span></div></div><div className="result-actions">{hasGeneratedProject && <><button className="button primary-button" onClick={() => void openProject(currentProject.path, 'open_project_folder')}>Open folder</button>{vscodeAvailable && <button className="button secondary-button" onClick={() => void openProject(currentProject.path, 'open_project_in_vscode')}>Open in VS Code</button>}</>}</div></div>}
        <section className="result-section"><div className="section-title-row"><div><p className="eyebrow">CLI VALIDATION EVENTS</p><h2>Validation results</h2></div><StatusPill tone={jobTone}>{jobStatus ? formatStatus(jobStatus).toUpperCase() : 'UNKNOWN'}</StatusPill></div>
          {events.filter((event) => event.type === 'validation').length === 0 ? <p className="empty-inline">No validation results were reported before this job ended.</p> : <ul className="validation-list">{events.filter((event) => event.type === 'validation').map((event) => <li key={`${event.jobId}-${event.sequence}`}><span className={`validation-icon ${event.stageStatus === 'passed' ? 'ok' : event.stageStatus === 'failed' ? 'fail' : 'skip'}`} aria-hidden="true">{event.stageStatus === 'passed' ? '✓' : event.stageStatus === 'failed' ? '!' : '–'}</span><span>{event.message}</span><StatusPill tone={event.stageStatus === 'passed' ? 'good' : event.stageStatus === 'failed' ? 'bad' : 'neutral'}>{event.stageStatus ?? 'reported'}</StatusPill></li>)}</ul>}
        </section>
        {events.some((event) => event.type === 'error' || event.type === 'warning') && <section className="result-section"><div className="section-title-row"><div><p className="eyebrow">ACTION NEEDED</p><h2>Generation notes</h2></div></div><ul className="result-notes">{events.filter((event) => event.type === 'error' || event.type === 'warning').map((event) => <li key={`${event.jobId}-${event.sequence}`}><strong>{event.code ?? event.type}</strong><p>{event.message}</p></li>)}</ul></section>}
        <section className="result-section result-next"><div><h2>What next?</h2><p>Check local recovery state before retrying a cancelled or failed generation. No automatic retry runs.</p></div><div className="button-row"><button className="button secondary-button" disabled={busy} onClick={() => void inspectRecovery()}>Inspect recovery</button><button className="button secondary-button" onClick={() => { invalidateReview(); setStep('review'); setPage('create') }}>Review setup again</button><button className="button primary-button" disabled={!catalog} onClick={() => startWizard()}>Create another</button></div></section>
        {recovery !== null && <RecoveryDetails value={recovery} />}
      </section>}

      <footer className="app-footer"><span>Project Generator · Phase 03 local UI MVP</span><span>FE-01 / FE-02 / FM-01 / FM-02 remain planned · no sandbox or release claim</span></footer>
    </main>
  </div>
}

function savePreferencesToStorage(preferences: AppPreferences): boolean {
  return savePreferences(window.localStorage, preferences)
}

function UnsupportedGroup({ title, description, entries }: { title: string; description: string; entries: string[] }) {
  return <section className="unsupported-card" aria-label={`${title} unavailable`}><div className="unsupported-mark" aria-hidden="true">⌁</div><div><strong>{title}</strong><p>{entries.length ? `${entries.join(', ')} are cataloged but have no executable recipe.` : description}</p><span>Unavailable in this phase</span></div></section>
}

function ProjectList({ projects, vscodeAvailable, onOpen }: { projects: ProjectRecord[]; vscodeAvailable: boolean; onOpen: (path: string, command: 'open_project_folder' | 'open_project_in_vscode') => void }) {
  return <div className="project-list">{projects.map((project) => <article className="project-row" key={`${project.path}-${project.createdAt}`}>
    <div className="project-type-mark" aria-hidden="true">{project.recipeId === 'FE-02' ? 'N' : 'R'}</div><div className="project-row-main"><strong>{project.name}</strong><code>{project.path}</code><div className="project-row-meta"><span>{project.recipeId}</span><span>·</span><span>{new Date(project.createdAt).toLocaleString()}</span></div></div>
    <div className="project-row-status"><StatusPill tone={project.status === 'completed' ? 'good' : 'warn'}>{project.status === 'completed' ? 'Checks passed' : 'Cleanup attention'}</StatusPill><div className="project-row-actions"><button className="button small-button secondary-button" onClick={() => onOpen(project.path, 'open_project_folder')}>Open folder</button>{vscodeAvailable && <button className="button small-button quiet-button" onClick={() => onOpen(project.path, 'open_project_in_vscode')}>VS Code</button>}</div></div>
  </article>)}</div>
}

function RecoveryDetails({ value }: { value: unknown }) {
  return <details className="recovery-details"><summary>Recovery inspection result</summary><p>Read-only CLI report. No recovery action was applied.</p><pre>{JSON.stringify(value, null, 2)}</pre></details>
}

export default App
