import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Channel, invoke } from '@tauri-apps/api/core'
import {
  canStartGeneration,
  backendDatabaseOptions,
  backendOrmOptions,
  documentationFiles,
  emptyPreferences,
  filterFormaTemplates,
  findFrameworkRecipe,
  findBackendRecipe,
  findRecipe,
  formaMetadataCompatible,
  loadPreferences,
  retainCompatibleStyling,
  savePreferences,
  validateGoModulePath,
  validateParentDirectory,
  validateProjectName,
  type AppPreferences,
  type Catalog,
  type ProjectRecord,
  type Theme,
} from './model.js'

type Page = 'home' | 'create' | 'frameworks' | 'templates' | 'projects' | 'environment' | 'settings' | 'generation' | 'result'
type WizardStep = 'details' | 'stack' | 'design' | 'docs' | 'review'
type RecipeId = 'FE-01' | 'FE-02' | 'FE-03' | 'FE-04' | 'FE-05' | 'FE-06' | 'FE-07' | 'FE-08' | 'FE-09' | 'FE-10' | 'FE-11' | 'FE-12' | 'FE-13' | 'FE-14' | 'FE-15' | 'BE-01' | 'BE-02' | 'BE-03' | 'BE-04' | 'BE-05' | 'BE-06' | 'BE-07' | 'BE-08' | 'BE-09'
function isRecipeId(value: string): value is RecipeId {
  return ['FE-01', 'FE-02', 'FE-03', 'FE-04', 'FE-05', 'FE-06', 'FE-07', 'FE-08', 'FE-09', 'FE-10', 'FE-11', 'FE-12', 'FE-13', 'FE-14', 'FE-15', 'BE-01', 'BE-02', 'BE-03', 'BE-04', 'BE-05', 'BE-06', 'BE-07', 'BE-08', 'BE-09'].includes(value)
}
type Documentation = 'minimal' | 'standard' | 'full'
type Selection = {
  projectName: string
  parentDirectory: string
  recipeId: RecipeId
  modulePath?: string
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
  requiresDependencyConsent: boolean
  requiresNetworkConsent: boolean
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
  { id: 'design', label: 'Tools and template', hint: 'Styling, package manager, Forma' },
  { id: 'docs', label: 'Documentation', hint: 'Generated file set' },
  { id: 'review', label: 'Review and create', hint: 'Plan, checks, consent' },
]

const PAGE_LABELS: Record<Page, string> = {
  home: 'Overview',
  create: 'Create project',
  frameworks: 'Framework catalog',
  templates: 'Forma gallery',
  projects: 'Recent projects',
  environment: 'Environment Doctor',
  settings: 'Settings',
  generation: 'Generation progress',
  result: 'Project result',
}

function ForgeIcon({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path d="M24 3.5 26.7 11l7.8 2.8-7.8 2.8L24 24l-2.7-7.4-7.8-2.8 7.8-2.8L24 3.5Z" fill="currentColor" />
    <path d="M12 22h25l6 6H30l-4.5 5H35l4 9H9l4-9h9.5L18 28H5l7-6Z" fill="currentColor" />
  </svg>
}

type SidebarIconName = 'home' | 'create' | 'catalog' | 'templates' | 'projects' | 'doctor' | 'settings'

const SIDEBAR_GROUPS: { id: string; label: string; items: [Page, SidebarIconName, string][] }[] = [
  { id: 'workspace', label: 'WORKSPACE', items: [['home', 'home', 'Overview'], ['projects', 'projects', 'Recent projects']] },
  { id: 'create', label: 'CREATE', items: [['create', 'create', 'Create project']] },
  { id: 'catalog', label: 'CATALOG', items: [['frameworks', 'catalog', 'Framework catalog'], ['templates', 'templates', 'Forma templates']] },
  { id: 'tools', label: 'TOOLS', items: [['environment', 'doctor', 'Environment Doctor']] },
  { id: 'preferences', label: 'PREFERENCES', items: [['settings', 'settings', 'Settings']] },
]

function SidebarIcon({ name }: { name: SidebarIconName }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {name === 'home' && <><path d="m3.5 10 8.5-7 8.5 7" /><path d="M5.5 9.5v11h13v-11M9.5 20.5v-6h5v6" /></>}
    {name === 'create' && <path d="M12 5v14M5 12h14" />}
    {name === 'catalog' && <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />}
    {name === 'templates' && <><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></>}
    {name === 'projects' && <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>}
    {name === 'doctor' && <path d="M3 12h4l3-7 4 14 3-7h4" />}
    {name === 'settings' && <><path d="m9.9 3 .6 2.2 1.5.9 2.3-.6 1.9 3.3-1.7 1.7v1.8l1.7 1.7-1.9 3.3-2.3-.6-1.5.9L9.9 20H6.1l-.6-2.2-1.5-.9-2.3.6-1.9-3.3 1.7-1.7v-1.8L-.2 9l1.9-3.3 2.3.6 1.5-.9L6.1 3z" transform="translate(2 0.5)" /><circle cx="12" cy="12" r="3" /> </>}
  </svg>
}

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
  const [projectType, setProjectType] = useState<'frontend' | 'backend'>('frontend')
  const [backendId, setBackendId] = useState('backend.express')
  const [databaseId, setDatabaseId] = useState('database.none')
  const [ormId, setOrmId] = useState('data-access.none')
  const [modulePath, setModulePath] = useState('example.com/my-project')
  const [frontendId, setFrontendId] = useState('frontend.react-vite')
  const [stylingId, setStylingId] = useState('styling.css')
  const [managerId, setManagerId] = useState('npm')
  const [templateId, setTemplateId] = useState('')
  const [templateVariantId, setTemplateVariantId] = useState('')
  const [documentation, setDocumentation] = useState<Documentation>('minimal')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [consent, setConsent] = useState(false)
  const [moduleDownloadConsent, setModuleDownloadConsent] = useState(false)
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
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateCategory, setTemplateCategory] = useState('all')
  const [templateFramework, setTemplateFramework] = useState('all')
  const [runtimeBusy, setRuntimeBusy] = useState(false)
  const invocationRef = useRef<string | null>(null)
  const terminalEventRef = useRef<JobEvent | null>(null)
  const activeProjectRef = useRef<{ name: string; path: string; recipeId: string } | null>(null)

  const recipe = useMemo(() => projectType === 'backend'
    ? findBackendRecipe(catalog, backendId, managerId, databaseId, ormId)
    : templateId
      ? findFrameworkRecipe(catalog, frontendId, managerId)
    : findRecipe(catalog, frontendId, stylingId, managerId), [catalog, frontendId, stylingId, managerId, templateId, projectType, backendId, databaseId, ormId])
  const frontendAdapters = catalog?.adapters.filter((adapter) => adapter.kind === 'frontend') ?? []
  const stylingAdapters = catalog?.adapters.filter((adapter) => adapter.kind === 'styling') ?? []
  const backendAdapters = catalog?.adapters.filter((adapter) => adapter.kind === 'backend') ?? []
  const databaseAdapters = catalog?.databaseAdapters ?? catalog?.adapters.filter((adapter) => adapter.kind === 'database') ?? []
  const ormAdapters = catalog?.ormAdapters ?? catalog?.adapters.filter((adapter) => adapter.kind === 'data-access') ?? []
  const formaTemplates = catalog?.forma.templates ?? []
  const templateCategories = [...new Set(formaTemplates.map((template) => template.category))].sort()
  const filteredTemplates = filterFormaTemplates(formaTemplates, templateSearch, templateCategory, templateFramework)
  const selectedFrontend = projectType === 'frontend' ? frontendAdapters.find((adapter) => adapter.id === frontendId) : undefined
  const selectedBackend = backendAdapters.find((adapter) => adapter.id === backendId)
  const databaseOptions = backendDatabaseOptions(catalog, backendId, managerId)
  const ormOptions = backendOrmOptions(catalog, backendId, managerId, databaseId)
  const activeTemplate = catalog?.forma.templates.find((template) => template.id === templateId)
  const selectedVariant = activeTemplate?.variants.find((variant) => variant.id === templateVariantId)
  const nameError = validateProjectName(projectName)
  const modulePathError = selectedBackend?.id === 'backend.go-net-http' || selectedBackend?.id === 'backend.go-gin' ? validateGoModulePath(modulePath) : null
  const parentError = validateParentDirectory(parentDirectory)
  const parentFieldError = parentDirectory ? parentError : null
  const settingsDirectoryError = directorySetting ? validateParentDirectory(directorySetting) : null
  const templateError = activeTemplate && catalog && !formaMetadataCompatible(activeTemplate, frontendId, catalog)
    ? 'This Forma metadata entry does not declare compatibility with the selected framework.'
    : null
  const selection = useMemo<Selection | null>(() => {
    if (!recipe || !isRecipeId(recipe.id)) return null
    return {
      projectName,
      parentDirectory,
      recipeId: recipe.id,
      ...(recipe.id === 'BE-02' || recipe.id === 'BE-04' ? { modulePath } : {}),
      documentation,
      ...(templateId ? { templateId, ...(templateVariantId ? { templateVariantId } : {}) } : {}),
    }
  }, [recipe, projectName, parentDirectory, documentation, templateId, templateVariantId, modulePath])
  const currentStepIndex = WIZARD_STEPS.findIndex((item) => item.id === step)
  const canUsePlanned = Boolean(runtime?.internalDevelopmentMode)
  const canGenerate = canStartGeneration({
    busy,
    invocationActive: Boolean(invocationId),
    hasSelection: Boolean(selection),
    planAvailable: Boolean(plan),
    doctorReady: Boolean(doctor?.ready),
    lifecycleConsent: consent || !Boolean(plan?.requiresDependencyConsent),
    networkConsent: moduleDownloadConsent || !Boolean(plan?.requiresNetworkConsent),
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
    setModuleDownloadConsent(false)
    setAllowPlanned(false)
    setCommandError(null)
  }

  function startWizard(initialTemplate = '') {
    const template = catalog?.forma.templates.find((item) => item.id === initialTemplate)
    const defaultRecipe = catalog?.recipes.find((item) => item.id === 'FE-01' && (!template || template.testedFrameworks.includes(item.frontend ?? '')))
      ?? catalog?.recipes.find((item) => item.id === 'FE-02' && (!template || template.testedFrameworks.includes(item.frontend ?? '')))
      ?? catalog?.recipes.find((item) => item.id === 'FE-01')
    setProjectName('my-project')
    setModulePath('example.com/my-project')
    setParentDirectory(preferences.defaultParentDirectory)
    setProjectType('frontend')
    setBackendId('backend.express')
    setDatabaseId('database.none')
    setOrmId('data-access.none')
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

  function startWizardForFramework(frontend: string) {
    const targetRecipe = catalog?.recipes.find((item) => item.frontend === frontend && item.id.startsWith('FE-'))
    if (!targetRecipe) return
    startWizard()
    setProjectType('frontend')
    setFrontendId(frontend)
    setStylingId(targetRecipe.styling ?? '')
    setManagerId(targetRecipe.manager)
  }

  function navigate(next: Page) {
    if (busy || invocationId) return
    setCommandError(null)
    setPage(next)
  }

  function buildSelection(): Selection | null {
    if (!recipe || !isRecipeId(recipe.id)) return null
    return {
      projectName,
      parentDirectory,
      recipeId: recipe.id,
      ...(recipe.id === 'BE-02' || recipe.id === 'BE-04' ? { modulePath } : {}),
      documentation,
      ...(templateId ? { templateId, ...(templateVariantId ? { templateVariantId } : {}) } : {}),
    }
  }

  async function loadReview() {
    const currentSelection = buildSelection()
    if (!currentSelection || nameError || parentError || templateError || modulePathError) return
    setBusy(true)
    setCommandError(null)
    setPlan(null)
    setDoctor(null)
    setConsent(false)
    setModuleDownloadConsent(false)
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

  async function refreshRuntime() {
    setRuntimeBusy(true)
    setCommandError(null)
    try {
      setRuntime(await invoke<Runtime>('get_runtime_status'))
    } catch (cause) {
      setCommandError(errorDetail(cause))
    } finally {
      setRuntimeBusy(false)
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
    setModuleDownloadConsent(false)
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
        moduleDownloadConsent,
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
    if (!recipe) return 'Choose a project type and a compatible catalog recipe.'
    if (!nameError && !parentError && !templateError && !modulePathError) return null
    return nameError ?? parentError ?? templateError ?? modulePathError
  }

  const currentProject = activeProjectRef.current
  const hasGeneratedProject = jobStatus === 'completed' || jobStatus === 'partial'
  const jobTone = jobStatus === 'completed' ? 'good' : jobStatus === 'partial' ? 'warn' : jobStatus === 'cancelled' ? 'neutral' : 'bad'
  const resultClass = jobStatus === 'completed' ? 'completed' : jobStatus === 'partial' ? 'partial' : jobStatus === 'cancelled' ? 'cancelled' : 'failed'

  return <div className="app-frame">
    <aside className="sidebar">
      <button className="brand" disabled={busy || Boolean(invocationId)} onClick={() => navigate('home')} aria-label="FormaForge home">
        <span className="brand-mark"><ForgeIcon /></span>
        <span><strong>FormaForge</strong><small>PROJECT GENERATOR</small></span>
      </button>
      <nav className="primary-nav" aria-label="Main navigation">
        {SIDEBAR_GROUPS.map(({ id, label, items }) => <div className={`nav-group nav-group-${id}`} role="group" aria-label={label} key={id}>
          <span className="nav-group-label" aria-hidden="true">{label}</span>
          <div className="nav-group-items">{items.map(([target, icon, itemLabel]) => <button
            key={target}
            className={page === target ? 'nav-item active' : 'nav-item'}
            aria-label={itemLabel}
            aria-current={page === target ? 'page' : undefined}
            disabled={(!catalog && target !== 'settings') || busy || Boolean(invocationId)}
            onClick={() => target === 'create' ? startWizard() : navigate(target)}
          ><span className="nav-icon"><SidebarIcon name={icon} /></span>{itemLabel}</button>)}</div>
        </div>)}
      </nav>
      <div className="sidebar-bottom">
        <p className="sidebar-section-label">RUNTIME STATUS</p>
        <div className="engine-mini" role="status" aria-label="Application engine status">
          <span className={runtime?.available ? 'engine-indicator online' : 'engine-indicator'} />
          <span><strong>{runtime?.available ? 'Engine ready' : 'Checking engine'}</strong><small>{runtime?.mode === 'bundled' ? 'Bundled runtime' : 'System runtime'}</small></span>
        </div>
        <div className="sidebar-meta"><span className="sidebar-build-badge">LOCAL DEVELOPMENT</span><p>No release approval</p></div>
      </div>
    </aside>

    <main className="main-area">
      <header className="page-topbar">
        <div className="breadcrumbs"><span>FormaForge</span><span aria-hidden="true">/</span><strong>{PAGE_LABELS[page]}</strong></div>
        <div className="topbar-right"><span className="internal-badge"><span aria-hidden="true">⚒</span> Local development · internal use</span></div>
      </header>

      {commandError && <ErrorNotice error={commandError} onDismiss={() => setCommandError(null)} />}
      {storageWarning && <div className="notice notice-warn" role="status"><span>Local settings could not be saved. Check app storage permissions.</span><button className="icon-button" aria-label="Dismiss storage warning" onClick={() => setStorageWarning(false)}>×</button></div>}

      {!catalog && page !== 'settings' && <section className="loading-card" role="status"><span className="spinner" /> Loading the packaged adapter catalog…</section>}

      {page === 'home' && <section className="page-content" aria-labelledby="home-title">
        <div className="hero-row">
          <div className="hero-copy"><p className="eyebrow">YOUR LOCAL DEVELOPER WORKSPACE</p><h1 id="home-title">Build your next project with FormaForge.</h1><p className="lead">A focused project generator to scaffold, configure, and launch new projects with a stack you control.</p>
            <div className="hero-actions"><button className="button primary-button" disabled={!catalog} onClick={() => startWizard()}><span aria-hidden="true">＋</span> Create project <span aria-hidden="true">→</span></button><button className="button secondary-button" disabled={!catalog} onClick={() => navigate('templates')}><span aria-hidden="true">▦</span> Browse templates</button></div>
          </div>
          <div className="hero-forge" aria-hidden="true"><span className="hero-forge-disc" /><span className="hero-forge-mark"><ForgeIcon /></span></div>
        </div>

        <div className="overview-grid">
          <article className="overview-card engine-card">
            <div className="card-icon purple-icon" aria-hidden="true">⌘</div>
            <div><p className="eyebrow">APPLICATION ENGINE</p><h2>{runtime?.available ? 'Ready to plan' : 'Runtime needs attention'}</h2><p>{runtime?.message ?? 'Checking the selected Node.js runtime…'}</p>{runtime?.version && <span className="subtle-tag">Node.js {runtime.version}</span>}</div>
          </article>
          <article className="overview-card">
            <div className="card-icon green-icon" aria-hidden="true">✓</div>
            <div><p className="eyebrow">GENERATION CHECKS</p><h2>Checked per project</h2><p>Node, Go, Python, native package manager, and destination checks run after you choose a stack. Nothing installs during planning.</p></div>
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
          <div className="promo-mark"><ForgeIcon /></div><div><p className="eyebrow">OPTIONAL STARTING POINT</p><h2>Explore Forma templates</h2><p>Browse pinned metadata and declared framework compatibility. Forma compatibility does not mean FormaForge support.</p></div><button className="button secondary-button" disabled={!catalog} onClick={() => navigate('templates')}>Browse gallery <span aria-hidden="true">→</span></button>
        </section>

        <section className="recovery-strip"><div><strong>Need to inspect an interrupted run?</strong><p>Read-only recovery inspection does not apply changes.</p></div><button className="button quiet-button" disabled={busy} onClick={() => void inspectRecovery()}>Inspect recovery</button></section>
        {recovery !== null && <RecoveryDetails value={recovery} />}
      </section>}

      {page === 'create' && <section className="page-content wizard-page" aria-labelledby="wizard-title">
        <div className="wizard-heading"><div><p className="eyebrow">NEW PROJECT · STEP {currentStepIndex + 1} OF {WIZARD_STEPS.length}</p><h1 id="wizard-title">Create project</h1><p className="lead">Configure a new project. Review all actions before anything runs.</p></div><button className="button quiet-button" disabled={busy} onClick={() => navigate('home')}>Cancel</button></div>
        <div className="wizard-layout">
          <nav className="step-nav" aria-label="Project setup steps">
            {WIZARD_STEPS.map((item, index) => <button key={item.id} className={`step-nav-item ${step === item.id ? 'selected' : ''} ${index < currentStepIndex ? 'visited' : ''}`} disabled={busy || index > currentStepIndex} onClick={() => setStep(item.id)} aria-current={step === item.id ? 'step' : undefined}>
              <span className="step-number">{index < currentStepIndex ? '✓' : index + 1}</span><span><strong>{item.label}</strong><small>{item.hint}</small></span>
            </button>)}
          </nav>
          <div className="wizard-main">
            {step === 'details' && <section className="wizard-card" aria-labelledby="details-title">
              <div className="section-title-row"><div><p className="eyebrow">01 · PROJECT</p><h2 id="details-title">Where should we create it?</h2></div><StatusPill>Required</StatusPill></div>
              <p className="section-intro">We create one new folder inside your destination. Existing projects are never modified.</p>
              <div className="field-grid">
                <div className="field"><label className="field-label" htmlFor="project-name">Project name</label><input id="project-name" className="text-input" disabled={busy} value={projectName} maxLength={100} autoComplete="off" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? 'project-name-error' : 'project-name-help'} onChange={(event) => { const next = event.target.value; setProjectName(next); setModulePath((current) => current === `example.com/${projectName}` ? `example.com/${next}` : current); invalidateReview() }} />{nameError ? <p id="project-name-error" className="field-error">{nameError}</p> : <p id="project-name-help" className="field-help">Lowercase name for the new project folder.</p>}</div>
                <div className="field"><label className="field-label" htmlFor="project-parent">Parent folder</label><input id="project-parent" className="text-input mono-input" disabled={busy} value={parentDirectory} maxLength={220} placeholder="C:\Users\you\Projects" autoComplete="off" aria-invalid={Boolean(parentFieldError)} aria-describedby={parentFieldError ? 'project-parent-error' : 'project-parent-help'} onChange={(event) => { setParentDirectory(event.target.value); invalidateReview() }} />{parentFieldError ? <p id="project-parent-error" className="field-error">{parentFieldError}</p> : <p id="project-parent-help" className="field-help">Existing local Windows folder. Network paths are blocked.</p>}</div>
              </div>
              <div className="step-safety-note"><strong>New folders only</strong><span>Planning does not write to your destination. Existing projects are never changed.</span></div>
              <div className="path-preview"><span className="preview-icon" aria-hidden="true">↳</span><div><small>NEW PROJECT LOCATION</small><code>{parentDirectory ? pathPreview(parentDirectory, projectName || 'project-name') : 'Choose a parent folder to preview destination'}</code></div></div>
              <div className="wizard-actions"><span /> <button className="button primary-button" disabled={Boolean(nameError || parentError || busy)} onClick={() => setStep('stack')}>Choose framework <span aria-hidden="true">→</span></button></div>
            </section>}

            {step === 'stack' && <section className="wizard-card" aria-labelledby="stack-title">
              <div className="section-title-row"><div><p className="eyebrow">02 · FRAMEWORK</p><h2 id="stack-title">Choose a project type</h2></div><StatusPill tone="warn">Planned recipes</StatusPill></div>
              <p className="section-intro">Choose Frontend or Backend first. Framework choices come from the packaged recipe catalog; planned recipes remain disabled in normal builds.</p>
              <fieldset className="choice-fieldset"><legend>Project type</legend><div className="compact-choice-grid">
                {(['frontend', 'backend'] as const).map((type) => <button type="button" key={type} className={`compact-choice ${projectType === type ? 'chosen' : ''}`} disabled={busy} aria-pressed={projectType === type} onClick={() => {
                  setProjectType(type)
                  setTemplateId('')
                  setTemplateVariantId('')
                  if (type === 'backend' && projectType !== 'backend') {
                    const adapter = backendAdapters.find((item) => item.id === backendId)
                    const defaultRecipe = catalog?.recipes.find((item) => item.backend === backendId)
                    setManagerId(defaultRecipe?.manager ?? adapter?.packageManagers[0] ?? 'npm')
                    setDatabaseId(defaultRecipe?.database ?? 'database.none')
                    setOrmId(defaultRecipe?.dataAccess ?? 'data-access.none')
                    setStylingId('')
                  }
                  else { setManagerId('npm'); setStylingId('styling.css') }
                  invalidateReview()
                }}><span className="radio-dot" aria-hidden="true" /><span><strong>{type === 'frontend' ? 'Frontend' : 'Backend'}</strong><small>{type === 'frontend' ? 'Browser application recipes' : 'Standalone API recipes'}</small></span></button>)}
              </div></fieldset>
              {projectType === 'frontend' ? <>
              <fieldset className="choice-fieldset"><legend>Frontend framework</legend><div className="choice-grid">
                {frontendAdapters.map((adapter) => {
                   const adapterRecipe = catalog?.recipes.find((item) => item.frontend === adapter.id && item.id.startsWith('FE-'))
                  const enabled = Boolean(adapterRecipe)
                  return <button type="button" key={adapter.id} className={`select-card ${frontendId === adapter.id ? 'chosen' : ''}`} disabled={!enabled || busy} onClick={() => {
                     if (!adapterRecipe) return
                     setFrontendId(adapter.id)
                     setStylingId(retainCompatibleStyling(catalog, adapter.id, stylingId, managerId))
                     invalidateReview()
                  }} aria-pressed={frontendId === adapter.id}>
                    <span className="select-card-top"><span className="framework-monogram">{adapter.displayName.startsWith('Next') ? 'N' : adapter.displayName.startsWith('Nuxt') ? 'U' : adapter.displayName.startsWith('Angular') ? 'A' : adapter.displayName.startsWith('Vue') ? 'V' : 'R'}</span><StatusPill tone="warn">{adapterRecipe?.status ?? 'Catalog only'}</StatusPill></span>
                    <strong>{adapter.displayName}</strong><small>{adapterRecipe ? `${adapterRecipe.id} · TypeScript · ${adapterRecipe.manager}` : 'No desktop recipe maps to this adapter.'}</small>
                  </button>
                })}
              </div></fieldset>
              <div className="unsupported-grid">
                <UnsupportedGroup title="Other frameworks" description="SvelteKit and other future frameworks are not in the packaged adapter catalog." entries={[]} />
                <UnsupportedGroup title="Backend" description="Choose Backend to view standalone API recipes." entries={backendAdapters.map((adapter) => adapter.displayName)} />
                 <UnsupportedGroup title="Database" description="Database adapters appear only in exact standalone backend recipes; frontend/fullstack database composition is unavailable." entries={databaseAdapters.map((adapter) => adapter.displayName)} />
                <UnsupportedGroup title="Full-stack / mobile" description="Outside current frontend-only generator scope." entries={[]} />
              </div>
              </> : <>
                <fieldset className="choice-fieldset"><legend>Backend framework</legend><div className="choice-grid">
                  {backendAdapters.map((adapter) => {
                     const adapterRecipe = catalog?.recipes.find((item) => item.id.startsWith('BE-') && item.backend === adapter.id)
                      return <button type="button" key={adapter.id} className={`select-card ${backendId === adapter.id ? 'chosen' : ''}`} disabled={!adapterRecipe || busy} onClick={() => {
                        const nextManager = adapter.packageManagers[0] ?? 'npm'
                        const keepDatabase = backendDatabaseOptions(catalog, adapter.id, nextManager).some((option) => option.adapter.id === databaseId && option.enabled)
                        const nextDatabase = keepDatabase ? databaseId : ''
                        const keepOrm = backendOrmOptions(catalog, adapter.id, nextManager, nextDatabase).some((option) => option.adapter.id === ormId && option.enabled)
                        setBackendId(adapter.id)
                        setManagerId(nextManager)
                        setDatabaseId(nextDatabase)
                        setOrmId(keepOrm ? ormId : '')
                        invalidateReview()
                      }} aria-pressed={backendId === adapter.id}>
                        <span className="select-card-top"><span className="framework-monogram">{adapter.id === 'backend.go-net-http' || adapter.id === 'backend.go-gin' ? 'G' : adapter.id === 'backend.laravel' ? 'L' : adapter.id === 'backend.fastapi' ? 'F' : adapter.id === 'backend.nestjs' ? 'N' : 'E'}</span><StatusPill tone="warn">{adapterRecipe?.status ?? 'Catalog only'}</StatusPill></span>
                         <strong>{adapter.displayName}</strong><small>{adapterRecipe ? `${catalog?.recipes.filter((item) => item.id.startsWith('BE-') && item.backend === adapter.id).map((item) => item.id).join(' · ')} · ${adapter.id === 'backend.go-net-http' || adapter.id === 'backend.go-gin' ? 'Go · Go Modules' : adapter.id === 'backend.laravel' ? 'PHP · Composer' : adapter.id === 'backend.fastapi' ? 'Python · uv' : 'TypeScript · npm'}` : 'No backend recipe is cataloged.'}</small>
                    </button>
                  })}
                </div></fieldset>
                 <div className="unsupported-grid"><UnsupportedGroup title="Full-stack / mobile" description="Frontend-backend composition and mobile generation are outside this phase." entries={[]} /></div>
              </>}
              <div className="wizard-actions"><button className="button secondary-button" disabled={busy} onClick={() => setStep('details')}>Back</button><button className="button primary-button" disabled={projectType === 'frontend' ? !selectedFrontend || busy : !selectedBackend || busy} onClick={() => setStep('design')}>Choose tools <span aria-hidden="true">→</span></button></div>
            </section>}

            {step === 'design' && <section className="wizard-card" aria-labelledby="design-title">
              <div className="section-title-row"><div><p className="eyebrow">03 · TOOLING</p><h2 id="design-title">{projectType === 'backend' ? 'Backend tools' : 'Styling and starting template'}</h2></div><StatusPill>Catalog-backed</StatusPill></div>
               <p className="section-intro">{projectType === 'backend' ? 'Choose only exact cataloged backend, database, ORM, and native package-manager recipes. Unsupported combinations stay disabled.' : 'Only combinations with an existing recipe can be selected. Framework changes never silently replace your styling choice.'}</p>
               {projectType === 'backend' && <>
                 <fieldset className="choice-fieldset"><legend>Native package manager</legend><div className="variant-row"><label htmlFor="backend-manager">Package manager</label><select id="backend-manager" className="select-input" disabled={busy} value={managerId} onChange={(event) => {
                   const nextManager = event.target.value
                   setManagerId(nextManager)
                   if (!backendDatabaseOptions(catalog, backendId, nextManager).some((option) => option.adapter.id === databaseId && option.enabled)) {
                     setDatabaseId('')
                     setOrmId('')
                   } else if (!backendOrmOptions(catalog, backendId, nextManager, databaseId).some((option) => option.adapter.id === ormId && option.enabled)) {
                     setOrmId('')
                   }
                   invalidateReview()
                 }}>{(catalog?.packageManagers ?? []).map((manager) => {
                   const enabled = Boolean(selectedBackend?.packageManagers.includes(manager.id))
                   return <option key={manager.id} value={manager.id} disabled={!enabled}>{manager.id}{enabled ? ` · ${manager.version}` : ' · incompatible with framework'}</option>
                 })}</select></div><p className="field-help">JavaScript uses npm; Go, PHP, and Python keep Go Modules, Composer, and uv.</p></fieldset>
                 <fieldset className="choice-fieldset"><legend>Database</legend><div className="compact-choice-grid">
                   {databaseOptions.map(({ adapter, enabled, reason }) => <button type="button" key={adapter.id} className={`compact-choice ${databaseId === adapter.id ? 'chosen' : ''}`} disabled={!enabled || busy} onClick={() => {
                     setDatabaseId(adapter.id)
                     const compatibleOrm = backendOrmOptions(catalog, backendId, managerId, adapter.id).some((option) => option.adapter.id === ormId && option.enabled)
                     setOrmId(compatibleOrm ? ormId : adapter.id === 'database.none' ? 'data-access.none' : '')
                     invalidateReview()
                   }} aria-pressed={databaseId === adapter.id}>
                     <span className="radio-dot" aria-hidden="true" /><span><strong>{adapter.displayName}</strong><small>{enabled ? adapter.id === 'database.sqlite' ? 'Embedded local SQLite file; no service or auto-migration.' : 'Exact backend recipe available.' : reason}</small></span>
                   </button>)}
                 </div>{!databaseOptions.some((option) => option.adapter.id === databaseId && option.enabled) && <p className="field-error">Choose an enabled database for this backend.</p>}</fieldset>
                 <fieldset className="choice-fieldset"><legend>ORM / data access</legend><div className="compact-choice-grid">
                   {ormOptions.map(({ adapter, enabled, reason }) => <button type="button" key={adapter.id} className={`compact-choice ${ormId === adapter.id ? 'chosen' : ''}`} disabled={!enabled || busy} onClick={() => { setOrmId(adapter.id); invalidateReview() }} aria-pressed={ormId === adapter.id}>
                     <span className="radio-dot" aria-hidden="true" /><span><strong>{adapter.displayName}</strong><small>{enabled ? 'Exact framework/database recipe available.' : reason}</small></span>
                   </button>)}
                 </div>{!ormOptions.some((option) => option.adapter.id === ormId && option.enabled) && <p className="field-error">Choose an enabled ORM/data-access option. Framework changes clear incompatible selections.</p>}</fieldset>
               </>}
                {projectType === 'backend' && selectedBackend?.id === 'backend.nestjs' && databaseId === 'database.postgresql' && <div className="template-style-note"><strong>NestJS 11 · PostgreSQL · Drizzle ORM · BE-09</strong><span>Separate planned recipe from database-free BE-03. DTO validation and pooled Nest DI service; no pool or connection at startup or /health. PostgreSQL 16+ is user-provided; migrations require explicit confirmed target.</span></div>}
                {projectType === 'backend' ? selectedBackend?.id === 'backend.go-net-http' || selectedBackend?.id === 'backend.go-gin' ? <>
                 <div className="template-style-note"><strong>{selectedBackend.id === 'backend.go-gin' ? 'Go · Gin 1.12.0 · Go Modules' : 'Go · Standard Library net/http · Go Modules'}</strong><span>{selectedBackend.id === 'backend.go-gin' ? 'Go 1.25+ standalone REST API with exact pinned module graph. Separate network consent required to download modules; no database, auth, or lifecycle scripts.' : 'Go 1.22+ standalone REST API. No third-party dependencies, go.sum, npm, or automatic server startup.'}</span></div>
                <div className="field"><label className="field-label" htmlFor="go-module-path">Go module path</label><input id="go-module-path" className="text-input mono-input" disabled={busy} value={modulePath} maxLength={512} autoComplete="off" aria-invalid={Boolean(modulePathError)} aria-describedby={modulePathError ? 'go-module-path-error' : 'go-module-path-help'} onChange={(event) => { setModulePath(event.target.value); invalidateReview() }} />{modulePathError ? <p id="go-module-path-error" className="field-error">{modulePathError}</p> : <p id="go-module-path-help" className="field-help">Used in go.mod and internal package imports.</p>}</div>
                 </> : selectedBackend?.id === 'backend.laravel' ? <div className="template-style-note"><strong>PHP · Laravel 12 · Composer · MySQL/Eloquent</strong><span>PHP 8.2+ with pdo_mysql and Composer 2.2+ required. Composer scripts/plugins stay disabled. Includes API validation, PHPUnit tests, model, and manual migration; no .env, database provisioning, or automatic migration.</span></div> : selectedBackend?.id === 'backend.fastapi' ? <div className="template-style-note"><strong>Python · FastAPI · Pydantic · Uvicorn · uv</strong><span>Python 3.14.x and uv 0.8+ required. Pins: FastAPI {selectedBackend.versionConstraints.fastapi?.split(' ')[0]}, Pydantic {selectedBackend.versionConstraints.pydantic?.split(' ')[0]}, Uvicorn {selectedBackend.versionConstraints.uvicorn?.split(' ')[0]}, pytest {selectedBackend.versionConstraints.pytest?.split(' ')[0]}. uv.lock and project-local .venv; no automatic Python download or server startup.</span></div> : selectedBackend?.id === 'backend.nestjs' ? <div className="template-style-note"><strong>NestJS 11 · TypeScript · npm · Jest</strong><span>Node.js 22.13+ and npm 10+ required. Uses integrity-pinned Nest CLI 11.0.24, CommonJS-compatible NodeNext output, Jest unit/e2e checks, JSON error handling, and graceful shutdown. No Observe integration; CLI --no-observe flag unsupported.</span></div> : selectedBackend?.id === 'backend.express' && databaseId === 'database.sqlite' ? <div className="template-style-note"><strong>Express · TypeScript · SQLite · Drizzle ORM</strong><span>SQLite stays in a project-local file. Generation writes migration SQL but never applies it; startup does not migrate. CRUD checks use an isolated temporary database.</span></div> : selectedBackend?.id === 'backend.express' && databaseId === 'database.postgresql' ? <div className="template-style-note"><strong>Express · TypeScript · PostgreSQL · Drizzle ORM</strong><span>PostgreSQL 16+ is user-provided. Generation, startup, and /health do not connect or migrate. Explicit migration requires matching --target host:port/database and read-only server identity preflight.</span></div> : <div className="template-style-note"><strong>Express · TypeScript · npm</strong><span>Node.js standalone REST API. BE-01 remains no-database; BE-07 uses SQLite/Drizzle; BE-08 uses PostgreSQL/Drizzle.</span></div> : <>
               {!templateId ? <fieldset className="choice-fieldset"><legend>Styling</legend><div className="compact-choice-grid">
                 {stylingAdapters.filter((adapter) => !['styling.scss', 'styling.tailwind'].includes(adapter.id) || adapter.compatibleWith.includes(frontendId)).map((adapter) => {
                  const compatible = adapter.compatibleWith.includes(frontendId)
                  const matches = Boolean(catalog?.recipes.some((item) => item.frontend === frontendId && item.styling === adapter.id && item.manager === managerId && item.id.startsWith('FE-')))
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
                      : catalog?.recipes.some((item) => item.frontend === frontendId && item.styling === stylingId && item.manager === normalized && item.id.startsWith('FE-'))))
                    const pin = catalog?.packageManagers.find((item) => item.id === normalized)
                    return <button type="button" className={`manager-choice ${managerId === normalized ? 'chosen' : ''}`} key={manager} disabled={!available || busy} onClick={() => { setManagerId(normalized); invalidateReview() }} aria-pressed={managerId === normalized}>
                      <strong>{normalized === 'pnpm' ? 'pnpm' : manager}</strong>{available ? <small>{normalized === 'npm' ? 'Default' : `Pinned ${pin?.version ?? ''}${pin?.nodeLinker ? ` · ${pin.nodeLinker} linker` : ''}`}</small> : <small>Not supported</small>}
                    </button>
                  })}
              </div><p className="field-help">npm stays default. Pinned Yarn and pnpm are available only for React/Vue + Vite + Plain CSS; Forma remains npm-only.</p></fieldset>

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
              </>}
              <div className="wizard-actions"><button className="button secondary-button" disabled={busy} onClick={() => setStep('stack')}>Back</button><button className="button primary-button" disabled={!recipe || Boolean(templateError || modulePathError) || busy} onClick={() => setStep('docs')}>Documentation <span aria-hidden="true">→</span></button></div>
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
                  <div className="stack-summary"><div><small>PROJECT</small><strong>{projectName}</strong><code>{plan.targetPath}</code></div><div><small>STACK</small><strong>{projectType === 'backend' ? `${selectedBackend?.displayName ?? 'Express'} REST API` : `${selectedFrontend?.displayName ?? frontendId} + ${activeTemplate ? 'Forma-managed styling' : stylingAdapters.find((adapter) => adapter.id === stylingId)?.displayName ?? stylingId}`}</strong><span>{plan.recipeId} · {plan.recipeId === 'BE-02' || plan.recipeId === 'BE-04' ? 'Go' : plan.recipeId === 'BE-05' ? 'PHP' : plan.recipeId === 'BE-06' ? 'Python' : 'TypeScript'} · {managerId} · {documentation} docs</span>{projectType === 'backend' && <span>{databaseAdapters.find((adapter) => adapter.id === databaseId)?.displayName ?? 'Database unavailable'} · {ormAdapters.find((adapter) => adapter.id === ormId)?.displayName ?? 'ORM unavailable'}</span>}{(plan.recipeId === 'BE-02' || plan.recipeId === 'BE-04') && <code>Module: {modulePath}</code>}</div>{activeTemplate && <div><small>FORMA TEMPLATE</small><strong>{activeTemplate.name}</strong><span>{selectedVariant?.name ?? activeTemplate.variants.find((variant) => variant.default)?.name ?? 'Default'} variant · planned integration</span></div>}</div>

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
                 {plan.requiresDependencyConsent ? <div className="consent-box"><p className="eyebrow">YOUR APPROVAL REQUIRED</p><strong>{plan.executesDependencyLifecycleScripts ? 'Dependency install can execute third-party code without a sandbox.' : 'Dependency install and checks load third-party code without a sandbox.'}</strong><p>{plan.recipeId === 'BE-05' ? 'Composer downloads and installs PHP packages with scripts and plugins disabled. Artisan and PHPUnit checks still load package code with your Windows user permissions; process supervision does not sandbox that code.' : `${managerId} installation can execute package-build or lifecycle code with your Windows user permissions. Process supervision does not sandbox that code.`} Network access and generated validation commands are listed above.</p>
                  <label className="check-line"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I understand and consent to this unsandboxed third-party dependency execution for this generation.</span></label>
                 </div> : !plan.requiresNetworkConsent ? <div className="template-style-note"><strong>No dependency lifecycle scripts.</strong><span>BE-02 uses only Go standard library; generation installs no third-party packages and runs Go checks locally with network access disabled.</span></div> : null}
                 {plan.requiresNetworkConsent && <div className="consent-box"><p className="eyebrow">SEPARATE NETWORK APPROVAL REQUIRED</p><strong>Download pinned Go Modules for Gin.</strong><p>Generation fetches the reviewed Gin v1.12.0 module graph from proxy.golang.org and verifies checksums through sum.golang.org. No lifecycle scripts run; GOTOOLCHAIN=local prevents automatic Go upgrades. This approval applies only to this generation.</p><label className="check-line"><input type="checkbox" checked={moduleDownloadConsent} onChange={(event) => setModuleDownloadConsent(event.target.checked)} /><span>I approve these Go module downloads for this generation.</span></label></div>}
                {canUsePlanned && !plan.executionAvailable && <label className="internal-consent"><input type="checkbox" checked={allowPlanned} onChange={(event) => setAllowPlanned(event.target.checked)} /><span><strong>Internal evidence run only:</strong> allow this planned recipe. Recipe remains unavailable in normal builds and is not promoted.</span></label>}
                {!plan.executionAvailable && !canUsePlanned && <div className="blocked-callout"><strong>Generation unavailable in normal builds.</strong><span>This recipe remains planned pending independent acceptance and review.</span></div>}
                 <div className="wizard-actions"><button className="button secondary-button" disabled={busy} onClick={() => { setConsent(false); setModuleDownloadConsent(false); setStep('docs') }}>Back to setup</button><button className="button primary-button" disabled={!canGenerate} onClick={() => void startGeneration()}>{busy ? 'Starting…' : 'Create project'} <span aria-hidden="true">→</span></button></div>
                 {plan.requiresDependencyConsent && !consent && <p className="footer-hint">Generation stays blocked until you affirm the dependency-execution consent above.</p>}
                 {plan.requiresNetworkConsent && !moduleDownloadConsent && <p className="footer-hint">Generation stays blocked until you separately approve Go module downloads above.</p>}
              </>}
            </section>}
          </div>
        </div>
      </section>}

      {page === 'frameworks' && <section className="page-content" aria-labelledby="frameworks-title">
        <div className="page-heading"><div><p className="eyebrow">PACKAGED CATALOG</p><h1 id="frameworks-title">Framework catalog</h1><p className="lead">Browse framework metadata and recipe status. Catalog presence does not enable normal generation.</p></div></div>
        <div className="framework-catalog-grid">{frontendAdapters.map((adapter) => {
          const adapterRecipes = catalog?.recipes.filter((item) => item.frontend === adapter.id && item.id.startsWith('FE-')) ?? []
          const adapterRecipe = adapterRecipes[0]
          return <article className="framework-card" key={adapter.id}>
            <div className="framework-card-heading"><span className="framework-monogram">{adapter.displayName.startsWith('Next') ? 'N' : adapter.displayName.startsWith('Nuxt') ? 'U' : adapter.displayName.startsWith('Angular') ? 'A' : adapter.displayName.startsWith('Vue') ? 'V' : adapter.displayName.slice(0, 1)}</span><StatusPill tone="warn">{adapterRecipe?.status ?? adapter.supportState}</StatusPill></div>
            <h2>{adapter.displayName}</h2><p>{adapterRecipe ? `Recipes ${adapterRecipes.map((item) => item.id).join(', ')} · ${adapterRecipe.manager} · ${adapterRecipe.scaffold ? `${adapterRecipe.scaffold.packageName}@${adapterRecipe.scaffold.version}` : 'reviewed built-in starter'}` : 'No executable Project Generator recipe is packaged for this framework.'}</p>
            <button className="button secondary-button" disabled={!adapterRecipe || busy} onClick={() => startWizardForFramework(adapter.id)}>{adapterRecipe ? 'Configure project' : 'Unavailable'}</button>
          </article>
        })}</div>
              <p className="catalog-pin">FE-01 through FE-15 and BE-01 through BE-09 remain planned. Normal generation remains blocked pending independent acceptance.</p>
      </section>}

      {page === 'templates' && <section className="page-content" aria-labelledby="templates-title">
        <div className="page-heading"><div><p className="eyebrow">PINNED FORMA METADATA</p><h1 id="templates-title">Forma templates</h1><p className="lead">Search the packaged catalog. Browsing stays local; source fetch happens only after an explicitly consented generation starts.</p></div></div>
        <div className="gallery-note"><strong>Metadata, not support.</strong> Compatibility comes from Forma's pinned catalog snapshot. FE/FM recipes remain planned; browsing makes no network requests.</div>
        <div className="template-toolbar">
          <label className="gallery-search"><span aria-hidden="true">⌕</span><span className="sr-only">Search Forma templates</span><input type="search" value={templateSearch} placeholder="Search templates or tags" onChange={(event) => setTemplateSearch(event.target.value)} /></label>
          <label className="gallery-filter"><span className="sr-only">Filter by category</span><select className="select-input" value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value)}><option value="all">All categories</option>{templateCategories.map((category) => <option key={category} value={category}>{category.replaceAll('-', ' ')}</option>)}</select></label>
          <label className="gallery-filter"><span className="sr-only">Filter by framework</span><select className="select-input" value={templateFramework} onChange={(event) => setTemplateFramework(event.target.value)}><option value="all">All frameworks</option>{[...new Set(formaTemplates.flatMap((template) => template.testedFrameworks))].map((framework) => <option key={framework} value={framework}>{frontendAdapters.find((adapter) => adapter.id === framework)?.displayName ?? displayName(framework)}</option>)}</select></label>
          <span className="gallery-count" aria-live="polite">{filteredTemplates.length} of {formaTemplates.length} templates</span>
        </div>
        {filteredTemplates.length > 0 ? <div className="template-grid">{filteredTemplates.map((template) => {
          const defaultVariant = template.variants.find((variant) => variant.default) ?? template.variants[0]
          const compatNames = template.testedFrameworks.map((id) => frontendAdapters.find((adapter) => adapter.id === id)?.displayName ?? displayName(id))
          const hasSelectableRecipe = template.testedFrameworks.some((framework) => catalog?.recipes.some((item) => item.frontend === framework && (item.id === 'FE-01' || item.id === 'FE-02')))
          const swatchColor = defaultVariant && /^\d{1,3} \d{1,3}% \d{1,3}%$/.test(defaultVariant.accent) ? `hsl(${defaultVariant.accent})` : 'var(--accent)'
          return <article className="template-card" key={template.id}>
            <div className="template-meta-preview"><span className="template-preview-swatch" style={{ background: swatchColor }} /><span className="template-preview-copy"><strong>{template.category.replaceAll('-', ' ')}</strong><small>Catalog metadata · preview asset not packaged</small></span><StatusPill tone="warn">Planned</StatusPill></div>
            <div className="template-card-body"><div className="template-title"><div><h2>{template.name}</h2><span className="template-version">v{template.version} · {template.license}</span></div></div>
              <p>{template.description}</p><div className="template-tags">{template.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <div className="template-meta"><small>Framework compatibility</small><strong>{compatNames.join(' · ') || 'No declared framework'}</strong><small>Color variants · {template.variants.map((variant) => variant.name).join(' · ') || 'Not declared'}</small></div>
              <button className="button primary-button template-cta" disabled={!hasSelectableRecipe || busy} title={!hasSelectableRecipe ? 'No selectable Project Generator recipe matches this template.' : undefined} onClick={() => startWizard(template.id)}>{hasSelectableRecipe ? 'Use template' : 'Unavailable'} <span aria-hidden="true">→</span></button>
            </div>
          </article>
        })}</div> : <div className="empty-state gallery-empty"><div className="empty-illustration" aria-hidden="true">⌕</div><h2>No matching templates</h2><p>Try another name, category, or framework filter.</p><button className="button secondary-button" onClick={() => { setTemplateSearch(''); setTemplateCategory('all'); setTemplateFramework('all') }}>Clear filters</button></div>}
        {catalog && <p className="catalog-pin">Catalog commit <code>{catalog.forma.commitSha}</code> · Metadata only; no live preview assets are packaged.</p>}
      </section>}

      {page === 'projects' && <section className="page-content" aria-labelledby="projects-title">
        <div className="page-heading"><div><p className="eyebrow">LOCAL METADATA ONLY</p><h1 id="projects-title">Recent projects</h1><p className="lead">Only projects generated by this app appear here. Project folders are never indexed.</p></div><button className="button primary-button" disabled={!catalog} onClick={() => startWizard()}>＋ Create project</button></div>
        {preferences.projects.length === 0 ? <div className="empty-state large-empty"><div className="empty-illustration" aria-hidden="true"><span>▤</span></div><h2>No generated projects yet</h2><p>Once generation completes, project name, location, recipe, and result status are stored locally.</p><button className="button primary-button" disabled={!catalog} onClick={() => startWizard()}>Create project</button></div> : <ProjectList projects={preferences.projects} vscodeAvailable={vscodeAvailable} onOpen={openProject} />}
      </section>}

      {page === 'environment' && <section className="page-content environment-page" aria-labelledby="environment-title">
        <div className="page-heading"><div><p className="eyebrow">LOCAL TOOLCHAIN</p><h1 id="environment-title">Environment Doctor</h1><p className="lead">Check the app runtime here. Python, uv, Node, Go, and destination checks need a selected project and run during review.</p></div><button className="button secondary-button" disabled={runtimeBusy} onClick={() => void refreshRuntime()}>{runtimeBusy ? 'Checking…' : 'Refresh runtime'}</button></div>
        <section className="environment-card"><div className="environment-card-icon" aria-hidden="true">⌘</div><div className="environment-card-main"><div className="environment-title-row"><div><p className="eyebrow">APPLICATION ENGINE</p><h2>{runtime?.available ? 'Ready to plan' : runtime ? 'Needs attention' : 'Checking runtime'}</h2></div><StatusPill tone={runtime?.available ? 'good' : runtime ? 'bad' : 'neutral'}>{runtime?.available ? 'Available' : runtime ? 'Unavailable' : 'Checking'}</StatusPill></div><p>{runtime?.message ?? 'Reading the configured runtime status…'}</p><dl className="environment-facts"><div><dt>Runtime mode</dt><dd>{runtime?.mode === 'bundled' ? 'Bundled Node.js' : 'System Node.js'}</dd></div><div><dt>Node.js</dt><dd>{runtime?.version ?? 'Not detected'}</dd></div><div><dt>Visual Studio Code</dt><dd>{vscodeAvailable ? 'Detected' : 'Not detected'}</dd></div></dl></div></section>
          <section className="doctor-next-card"><div><h2>Project-specific checks</h2><p>Choose a framework, native package manager, and destination to run Doctor. It checks the selected runtime and target-folder safety without installing tools.</p></div><button className="button primary-button" disabled={!catalog} onClick={() => startWizard()}>Choose a project <span aria-hidden="true">→</span></button></section>
        <section className="recovery-strip"><div><strong>Interrupted generation?</strong><p>Inspect recovery journal read-only. No recovery action is applied.</p></div><button className="button secondary-button" disabled={busy} onClick={() => void inspectRecovery()}>Inspect recovery</button></section>
        {recovery !== null && <RecoveryDetails value={recovery} />}
      </section>}

      {page === 'settings' && <section className="page-content settings-page" aria-labelledby="settings-title">
        <div className="page-heading"><div><p className="eyebrow">LOCAL PREFERENCES</p><h1 id="settings-title">Settings</h1><p className="lead">Basic app preferences. No credentials, generation logs, or folder index are stored.</p></div></div>
        <section className="settings-card"><div className="settings-card-heading"><div><h2>Appearance</h2><p>Choose how FormaForge looks on this device.</p></div></div>
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
        <div className="generation-heading"><div className="generation-spinner"><span className="spinner" /></div><div className="generation-copy"><p className="eyebrow">GENERATION IN PROGRESS</p><h1 id="generation-title">Creating {currentProject?.name ?? 'your project'}</h1><p className="lead">Keep this window open. Progress comes from the CLI event stream; process output and logs are not shown.</p></div></div>
        <div className="generation-target"><span className="target-icon" aria-hidden="true">↳</span><div><small>DESTINATION</small><code>{currentProject?.path}</code></div><StatusPill tone="warn">{cancelRequested ? 'Stopping' : invocationId ? 'Running' : 'Starting'}</StatusPill></div>
        <section className="activity-card" aria-labelledby="activity-title"><div className="section-title-row"><div><p className="eyebrow">LIVE JSONL EVENTS</p><h2 id="activity-title">Activity</h2></div><span className="event-count">{events.length} events</span></div>
          {events.length === 0 ? <div className="activity-empty" role="status"><span className="spinner" /> Waiting for CLI progress…</div> : <ol className="activity-list" aria-live="polite" aria-relevant="additions">{events.map((event) => <li className={`activity-event ${event.type === 'error' ? 'event-error' : ''}`} data-job-id={event.jobId} data-event-type={event.type} data-stage-id={event.stageId ?? ''} data-stage-status={event.stageStatus ?? ''} data-job-status={event.status ?? ''} key={`${event.jobId}-${event.sequence}`}><span className="event-marker" aria-hidden="true">{event.type === 'job-finished' ? '✓' : event.type === 'error' ? '!' : '·'}</span><div><div className="event-heading"><strong>{formatStatus(event.stageId ?? event.type)}</strong>{event.percent !== undefined && <span>{event.percent}%</span>}</div><p>{event.message}</p>{event.code && <code>{event.code}</code>}</div></li>)}</ol>}
        </section>
        <div className="cancel-row"><p>Generation writes only to owned staging and commits only if destination remains absent.</p><button className="button danger-button" disabled={!invocationId || cancelRequested} onClick={() => void cancelGeneration()}>{cancelRequested ? 'Stopping…' : 'Cancel generation'}</button></div>
      </section>}

      {page === 'result' && <section className="page-content result-page" aria-labelledby="result-title">
        <div className={`result-hero ${resultClass}`}><span className="result-symbol" aria-hidden="true">{jobStatus === 'completed' ? '✓' : jobStatus === 'partial' ? '!' : jobStatus === 'cancelled' ? '–' : '×'}</span><p className="eyebrow">GENERATION RESULT</p><h1 id="result-title">{jobStatus === 'completed' ? 'Project checks passed' : jobStatus === 'partial' ? 'Project created with cleanup attention' : jobStatus === 'cancelled' ? 'Generation cancelled' : 'Generation did not complete'}</h1><p>{jobStatus === 'completed' ? 'The generated project passed the checks reported below.' : jobStatus === 'partial' ? 'A project was finalized, but staging cleanup needs manual attention.' : jobStatus === 'cancelled' ? 'Cancellation completed. Check recovery state before retrying.' : 'Do not assume the destination is untouched. Inspect the folder and recovery state before retrying.'}</p>
          <div className="result-caveat"><strong>Recipe remains planned.</strong> This internal evidence run does not promote FE/BE/FM recipes, verify independent acceptance, or approve public release.</div>
        </div>
        {currentProject && <div className="result-project-card"><div className="result-project-icon" aria-hidden="true">⌘</div><div className="result-project-details"><p className="eyebrow">{jobStatus === 'completed' ? 'GENERATED PROJECT' : 'REQUESTED DESTINATION'}</p><h2>{currentProject.name}</h2><code>{currentProject.path}</code><div className="result-tags"><span>{currentProject.recipeId}</span><span>{jobStatus ? formatStatus(jobStatus) : 'Unknown status'}</span></div></div><div className="result-actions">{hasGeneratedProject && <><button className="button primary-button" onClick={() => void openProject(currentProject.path, 'open_project_folder')}>Open folder</button>{vscodeAvailable && <button className="button secondary-button" onClick={() => void openProject(currentProject.path, 'open_project_in_vscode')}>Open in VS Code</button>}</>}</div></div>}
        <section className="result-section"><div className="section-title-row"><div><p className="eyebrow">CLI VALIDATION EVENTS</p><h2>Validation results</h2></div><StatusPill tone={jobTone}>{jobStatus ? formatStatus(jobStatus).toUpperCase() : 'UNKNOWN'}</StatusPill></div>
          {events.filter((event) => event.type === 'validation').length === 0 ? <p className="empty-inline">No validation results were reported before this job ended.</p> : <ul className="validation-list">{events.filter((event) => event.type === 'validation').map((event) => <li key={`${event.jobId}-${event.sequence}`}><span className={`validation-icon ${event.stageStatus === 'passed' ? 'ok' : event.stageStatus === 'failed' ? 'fail' : 'skip'}`} aria-hidden="true">{event.stageStatus === 'passed' ? '✓' : event.stageStatus === 'failed' ? '!' : '–'}</span><span>{event.message}</span><StatusPill tone={event.stageStatus === 'passed' ? 'good' : event.stageStatus === 'failed' ? 'bad' : 'neutral'}>{event.stageStatus ?? 'reported'}</StatusPill></li>)}</ul>}
        </section>
        {events.some((event) => event.type === 'error' || event.type === 'warning') && <section className="result-section"><div className="section-title-row"><div><p className="eyebrow">ACTION NEEDED</p><h2>Generation notes</h2></div></div><ul className="result-notes">{events.filter((event) => event.type === 'error' || event.type === 'warning').map((event) => <li key={`${event.jobId}-${event.sequence}`}><strong>{event.code ?? event.type}</strong><p>{event.message}</p></li>)}</ul></section>}
        <section className="result-section result-next"><div><h2>What next?</h2><p>Check local recovery state before retrying a cancelled or failed generation. No automatic retry runs.</p></div><div className="button-row"><button className="button secondary-button" disabled={busy} onClick={() => void inspectRecovery()}>Inspect recovery</button><button className="button secondary-button" onClick={() => { invalidateReview(); setStep('review'); setPage('create') }}>Review setup again</button><button className="button primary-button" disabled={!catalog} onClick={() => startWizard()}>Create another</button></div></section>
        {recovery !== null && <RecoveryDetails value={recovery} />}
      </section>}

      <footer className="app-footer"><span>FormaForge · Project Generator</span><span>Local development · FE-01–FE-15 / BE-01–BE-09 / FM-01 / FM-02 remain planned · no release approval</span></footer>
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
    <div className="project-type-mark" aria-hidden="true">{project.recipeId === 'BE-02' || project.recipeId === 'BE-04' ? 'G' : project.recipeId === 'BE-03' || project.recipeId === 'BE-09' ? 'N' : project.recipeId === 'BE-05' ? 'L' : project.recipeId === 'BE-06' ? 'F' : project.recipeId === 'FE-02' ? 'N' : project.recipeId === 'FE-06' ? 'U' : project.recipeId === 'FE-07' ? 'A' : ['FE-03', 'FE-05', 'FE-09', 'FE-11', 'FE-13', 'FE-15'].includes(project.recipeId) ? 'V' : 'R'}</div><div className="project-row-main"><strong>{project.name}</strong><code>{project.path}</code><div className="project-row-meta"><span>{project.recipeId}</span><span>·</span><span>{new Date(project.createdAt).toLocaleString()}</span></div></div>
    <div className="project-row-status"><StatusPill tone={project.status === 'completed' ? 'good' : 'warn'}>{project.status === 'completed' ? 'Checks passed' : 'Cleanup attention'}</StatusPill><div className="project-row-actions"><button className="button small-button secondary-button" onClick={() => onOpen(project.path, 'open_project_folder')}>Open folder</button>{vscodeAvailable && <button className="button small-button quiet-button" onClick={() => onOpen(project.path, 'open_project_in_vscode')}>VS Code</button>}</div></div>
  </article>)}</div>
}

function RecoveryDetails({ value }: { value: unknown }) {
  return <details className="recovery-details"><summary>Recovery inspection result</summary><p>Read-only CLI report. No recovery action was applied.</p><pre>{JSON.stringify(value, null, 2)}</pre></details>
}

export default App
