import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, win32 } from 'node:path'

const execFileAsync = promisify(execFile)
const shaPattern = /^[a-f0-9]{40}$/i
const repository = 'https://github.com/dzulfikarq/design-templates.git'

interface WorkerOptions {
  operation: 'fetch' | 'verify'
  gitPath: string
  repositoryPath: string
  commitSha: string
  profile: string
}

async function git(gitPath: string, args: string[], cwd: string, profile: string): Promise<string> {
  const environment = {
    ...process.env,
    HOME: profile,
    USERPROFILE: profile,
    PATH: `${dirname(gitPath)};${process.env.PATH ?? ''}`,
    GIT_CONFIG_GLOBAL: 'NUL',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_LFS_SKIP_SMUDGE: '1',
  }
  try {
    const { stdout } = await execFileAsync(gitPath, [
      '-c', 'core.hooksPath=NUL',
      '-c', 'credential.interactive=never',
      '-c', 'http.followRedirects=false',
      '-c', 'filter.lfs.process=',
      '-c', 'filter.lfs.smudge=',
      '-c', 'filter.lfs.required=false',
      ...args,
    ], { cwd, env: environment, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 })
    return stdout
  } catch {
    throw new Error('git_failed')
  }
}

function options(args: string[]): WorkerOptions {
  if (args.length !== 5) throw new Error('invalid_args')
  const [operation, gitPath, repositoryPath, commitSha, profile] = args
  if (!['fetch', 'verify'].includes(operation!)
    || !win32.isAbsolute(gitPath!)
    || !win32.isAbsolute(repositoryPath!)
    || !win32.isAbsolute(profile!)
    || !shaPattern.test(commitSha!)) throw new Error('invalid_args')
  return { operation: operation as WorkerOptions['operation'], gitPath: gitPath!, repositoryPath: repositoryPath!, commitSha: commitSha!, profile: profile! }
}

async function main(args: string[]): Promise<void> {
  const { operation, gitPath, repositoryPath, commitSha, profile } = options(args)
  const parent = win32.dirname(repositoryPath)
  if (operation === 'fetch') {
    await git(gitPath, ['init', '--quiet', repositoryPath], parent, profile)
    await git(gitPath, ['-C', repositoryPath, 'remote', 'add', 'origin', repository], parent, profile)
    await git(gitPath, ['-C', repositoryPath, 'fetch', '--quiet', '--no-tags', '--depth=1', 'origin', commitSha], parent, profile)
    await git(gitPath, ['-C', repositoryPath, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], parent, profile)
  }
  const head = (await git(gitPath, ['-C', repositoryPath, 'rev-parse', 'HEAD'], parent, profile)).trim()
  const changes = await git(gitPath, ['-C', repositoryPath, 'status', '--porcelain', '--untracked-files=all'], parent, profile)
  if (head.toLowerCase() !== commitSha.toLowerCase() || changes.trim()) throw new Error('source_mismatch')
  process.stdout.write(JSON.stringify({ ok: true, commitSha: head }))
}

main(process.argv.slice(2)).catch(() => {
  process.stderr.write('Authenticated Forma source fetch or immutable revision check failed.\n')
  process.exitCode = 1
})
