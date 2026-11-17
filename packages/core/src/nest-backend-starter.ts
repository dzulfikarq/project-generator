import { readFile } from 'node:fs/promises'
import { basename, win32 } from 'node:path'
import { GeneratorError } from './errors.js'
import { mutateOwnedStage, type OwnedStage } from './staging.js'
import type { DependencyPin } from './types.js'

function scaffoldError(reason?: string): GeneratorError {
  return new GeneratorError({
    code: 'GEN_CONFIGURE_FAILED',
    stage: 'configuring',
    message: `Pinned Nest CLI output did not match its reviewed CommonJS/Jest scaffold contract${reason ? ` (${reason})` : ''}.`,
    nextAction: 'Inspect the redacted job log and generated scaffold metadata before retrying.',
    targetModified: false,
  })
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // Report a single scaffold-contract error without exposing file contents.
  }
  throw scaffoldError(`missing or invalid ${basename(path)}`)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export interface NestScaffold {
  packageJson: Record<string, unknown>
  jestConfig: Record<string, unknown>
  e2eConfig: Record<string, unknown>
}

export async function validateNestScaffold(stage: OwnedStage, projectName: string): Promise<NestScaffold> {
  const projectPath = stage.childPath
  const packageJson = await readJson(win32.join(projectPath, 'package.json'))
  const tsconfig = await readJson(win32.join(projectPath, 'tsconfig.json'))
  const e2eConfig = await readJson(win32.join(projectPath, 'test', 'jest-e2e.json'))
  const scripts = record(packageJson.scripts)
  const dependencies = record(packageJson.dependencies)
  const devDependencies = record(packageJson.devDependencies)
  const jestConfig = record(packageJson.jest)
  const compilerOptions = record(tsconfig.compilerOptions)
  const transform = record(jestConfig?.transform)
  const e2eTransform = record(e2eConfig.transform)
  const mismatches = [
    ...(packageJson.name !== projectName ? ['project-name'] : []),
    ...(packageJson.type === 'module' ? ['module-is-esm'] : []),
    ...(scripts?.build !== 'nest build' || scripts?.test !== 'jest' || typeof scripts['test:e2e'] !== 'string' || !scripts['test:e2e'].includes('jest') ? ['scripts'] : []),
    ...(!dependencies?.['@nestjs/common'] || !dependencies['@nestjs/core'] || !dependencies['@nestjs/platform-express'] ? ['framework-dependencies'] : []),
    ...(!devDependencies?.['@nestjs/cli'] || !devDependencies['@nestjs/schematics'] || !devDependencies.jest || !devDependencies['ts-jest'] ? ['test-and-cli-dependencies'] : []),
    ...(compilerOptions?.module !== 'nodenext' || compilerOptions.moduleResolution !== 'nodenext' || compilerOptions.emitDecoratorMetadata !== true || compilerOptions.experimentalDecorators !== true ? ['typescript-config'] : []),
    ...(!transform || !Object.values(transform).some((value) => value === 'ts-jest') ? ['unit-test-transform'] : []),
    ...(!e2eTransform || !Object.values(e2eTransform).some((value) => value === 'ts-jest') ? ['e2e-test-transform'] : []),
  ]
  if (mismatches.length) throw scaffoldError(mismatches.join(', '))
  return { packageJson, jestConfig: jestConfig!, e2eConfig }
}

const configSource = `export interface ServerConfig {
  host: string
  port: number
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = (environment.HOST ?? '127.0.0.1').trim()
  const rawPort = environment.PORT ?? '3000'
  const port = Number(rawPort)
  if (!host || /[\\r\\n\\0]/.test(host)) throw new Error('HOST must be a non-empty host name or IP address.')
  if (!/^\\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }
  return { host, port }
}
`

const exceptionFilterSource = `import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common'
import type { Request, Response } from 'express'

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const response = http.getResponse<Response>()
    const request = http.getRequest<Request>()
    const candidate = exception instanceof HttpException
      ? exception.getStatus()
      : typeof exception === 'object' && exception !== null && 'status' in exception && typeof exception.status === 'number'
        ? exception.status
        : 500
    const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500
    const code = status === 404 ? 'NOT_FOUND' : status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR'
    const message = status === 404 ? 'Route not found.' : status < 500 ? 'Request could not be processed.' : 'Internal server error.'
    response.status(status).json({ error: { code, message }, path: request.path })
  }
}
`

const appServiceSource = `import { Injectable } from '@nestjs/common'

@Injectable()
export class AppService {
  getHealth(): { status: 'ok' } {
    return { status: 'ok' }
  }

  getInfo(): { name: string; version: string; environment: string } {
    return {
      name: 'BE-03 NestJS API',
      version: '0.1.0',
      environment: process.env.NODE_ENV ?? 'development',
    }
  }
}
`

const appControllerSource = `import { Controller, Get } from '@nestjs/common'
import { AppService } from './app.service'

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  getHealth() {
    return this.appService.getHealth()
  }

  @Get('api/info')
  getInfo() {
    return this.appService.getInfo()
  }
}
`

const appModuleSource = `import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { ApiExceptionFilter } from './api-exception.filter'
import { AppController } from './app.controller'
import { AppService } from './app.service'

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, { provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
`

const mainSource = `import { existsSync } from 'node:fs'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { readConfig } from './config'

async function bootstrap(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env')
  const { host, port } = readConfig()
  const app = await NestFactory.create(AppModule, { abortOnError: false })
  app.enableShutdownHooks(['SIGINT', 'SIGTERM'])
  await app.listen(port, host)
}

void bootstrap().catch((error: unknown) => {
  console.error('Server startup failed.', error)
  process.exitCode = 1
})
`

const unitTestSource = `import { AppService } from './app.service'
import { readConfig } from './config'

describe('Nest API configuration and service', () => {
  it('uses loopback defaults and validates the configured port', () => {
    expect(readConfig({})).toEqual({ host: '127.0.0.1', port: 3000 })
    expect(readConfig({ HOST: 'localhost', PORT: '8080' })).toEqual({ host: 'localhost', port: 8080 })
    expect(() => readConfig({ PORT: '65536' })).toThrow(/PORT must be an integer/)
    expect(() => readConfig({ HOST: 'bad\\nhost' })).toThrow(/HOST must be/)
  })

  it('returns stable health and API metadata', () => {
    const service = new AppService()
    expect(service.getHealth()).toEqual({ status: 'ok' })
    expect(service.getInfo().name).toBe('BE-03 NestJS API')
    expect(service.getInfo().version).toBe('0.1.0')
  })
})
`

const apiE2eSource = `import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'

describe('Nest API (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterAll(async () => app.close())

  it('serves health and API information as JSON', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' })
    const info = await request(app.getHttpServer()).get('/api/info').expect(200)
    expect(info.body).toMatchObject({ name: 'BE-03 NestJS API', version: '0.1.0' })
  })

  it('returns stable JSON errors for unknown routes and malformed JSON', async () => {
    await request(app.getHttpServer()).get('/missing').expect(404, {
      error: { code: 'NOT_FOUND', message: 'Route not found.' }, path: '/missing',
    })
    await request(app.getHttpServer()).post('/health').set('Content-Type', 'application/json').send('{"broken":').expect(400, {
      error: { code: 'INVALID_REQUEST', message: 'Request could not be processed.' }, path: '/health',
    })
  })
})
`

const shutdownE2eSource = `import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'

describe('Nest application shutdown (e2e)', () => {
  it('closes the HTTP listener cleanly', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile()
    const app: INestApplication = moduleFixture.createNestApplication()
    app.enableShutdownHooks(['SIGINT', 'SIGTERM'])
    await app.listen(0, '127.0.0.1')
    const server = app.getHttpServer() as { listening: boolean }
    expect(server.listening).toBe(true)
    await app.close()
    expect(server.listening).toBe(false)
  })
})
`

const eslintConfig = `import eslint from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.jest } } },
)
`

export async function writeNestBackendStarter(stage: OwnedStage, projectName: string, pins: readonly DependencyPin[]): Promise<string[]> {
  const { packageJson, jestConfig } = await validateNestScaffold(stage, projectName)
  const expectedDependencies = Object.fromEntries(pins
    .filter((pin) => (pin.scope ?? 'dependencies') === 'dependencies')
    .map((pin) => [pin.packageName, pin.version]))
  const expectedDevDependencies = Object.fromEntries(pins
    .filter((pin) => pin.scope === 'devDependencies')
    .map((pin) => [pin.packageName, pin.version]))
  if (Object.keys(expectedDependencies).length !== pins.filter((pin) => (pin.scope ?? 'dependencies') === 'dependencies').length
    || Object.keys(expectedDevDependencies).length !== pins.filter((pin) => pin.scope === 'devDependencies').length
    || !['@nestjs/common', '@nestjs/core', '@nestjs/platform-express', 'reflect-metadata', 'rxjs'].every((name) => expectedDependencies[name])) throw scaffoldError()

  packageJson.version = '0.1.0'
  packageJson.private = true
  packageJson.license = 'UNLICENSED'
  packageJson.engines = { node: '>=22.13.0' }
  packageJson.scripts = {
    build: 'nest build',
    start: 'nest start',
    'start:dev': 'nest start --watch',
    'start:prod': 'node dist/main.js',
    format: 'prettier --write "src/**/*.ts" "test/**/*.ts"',
    lint: 'eslint "{src,test}/**/*.ts"',
    test: 'jest --runInBand',
    'test:e2e': 'jest --config ./test/jest-e2e.json --runInBand',
    typecheck: 'tsc --project tsconfig.json --noEmit',
  }
  packageJson.dependencies = expectedDependencies
  packageJson.devDependencies = expectedDevDependencies
  packageJson.jest = {
    ...jestConfig,
    testEnvironment: 'node',
  }

  const prefix = `${projectName}/`
  const writes = await mutateOwnedStage(stage, [`${prefix}src`, `${prefix}test`], [
    { path: `${prefix}package.json`, content: `${JSON.stringify(packageJson, null, 2)}\n`, replace: true },
    { path: `${prefix}.env.example`, content: 'HOST=127.0.0.1\nPORT=3000\nNODE_ENV=development\n' },
    { path: `${prefix}.gitignore`, content: 'node_modules/\ndist/\ncoverage/\n.env\n.env.*\n!.env.example\n' },
    { path: `${prefix}eslint.config.mjs`, content: eslintConfig, replace: true },
    { path: `${prefix}src/config.ts`, content: configSource },
    { path: `${prefix}src/api-exception.filter.ts`, content: exceptionFilterSource },
    { path: `${prefix}src/app.service.ts`, content: appServiceSource, replace: true },
    { path: `${prefix}src/app.controller.ts`, content: appControllerSource, replace: true },
    { path: `${prefix}src/app.module.ts`, content: appModuleSource, replace: true },
    { path: `${prefix}src/main.ts`, content: mainSource, replace: true },
    { path: `${prefix}src/app.controller.spec.ts`, content: unitTestSource, replace: true },
    { path: `${prefix}test/app.e2e-spec.ts`, content: apiE2eSource, replace: true },
    { path: `${prefix}test/shutdown.e2e-spec.ts`, content: shutdownE2eSource },
  ])
  return writes.map((path) => path.slice(prefix.length))
}
