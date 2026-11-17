import { readFile } from 'node:fs/promises'
import { win32 } from 'node:path'
import { mutateOwnedStage, type OwnedStage } from './staging.js'
import type { DependencyPin } from './types.js'
import { GeneratorError } from './errors.js'
import { postgresDatabaseSupportFiles } from './postgres-backend-starter.js'
import { validateNestScaffold } from './nest-backend-starter.js'

const databaseService = String.raw`import { Injectable, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema.js'
import { parseDatabaseUrl } from '../db/target.js'

export type Database = NodePgDatabase<typeof schema>

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private pool?: Pool
  private database?: Database

  getDatabase(): Database {
    if (this.database) return this.database
    try {
      const { connectionString } = parseDatabaseUrl(process.env.DATABASE_URL)
      const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 1500 })
      pool.on('error', () => undefined)
      this.pool = pool
      this.database = drizzle(pool, { schema })
      return this.database
    } catch {
      throw new ServiceUnavailableException('Database unavailable.')
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.pool) await this.pool.end()
  }
}
`

const itemsService = String.raw`import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { items } from '../db/schema.js'
import { DatabaseService } from '../database/database.service.js'

export interface ItemInput { name: string; description: string }
export interface ItemUpdate { name?: string; description?: string }

@Injectable()
export class ItemsService {
  constructor(private readonly database: DatabaseService) {}

  private async query<T>(operation: (database: ReturnType<DatabaseService['getDatabase']>) => Promise<T>): Promise<T> {
    try { return await operation(this.database.getDatabase()) }
    catch (error) {
      if (error instanceof NotFoundException) throw error
      throw new ServiceUnavailableException('Database unavailable.')
    }
  }

  list() { return this.query((database) => database.select().from(items).orderBy(items.id)) }

  async find(id: number) {
    const item = await this.query(async (database) => (await database.select().from(items).where(eq(items.id, id)).limit(1))[0])
    if (!item) throw new NotFoundException('Item not found.')
    return item
  }

  create(input: ItemInput) {
    return this.query(async (database) => (await database.insert(items).values(input).returning())[0]!)
  }

  async update(id: number, input: ItemUpdate) {
    const item = await this.query(async (database) => (await database.update(items).set(input).where(eq(items.id, id)).returning())[0])
    if (!item) throw new NotFoundException('Item not found.')
    return item
  }

  async delete(id: number) {
    const item = await this.query(async (database) => (await database.delete(items).where(eq(items.id, id)).returning())[0])
    if (!item) throw new NotFoundException('Item not found.')
    return item
  }
}
`

const createDto = String.raw`import { Transform } from 'class-transformer'
import { IsString, MaxLength, MinLength } from 'class-validator'

export class CreateItemDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string

  @IsString()
  @MaxLength(4000)
  description = ''
}
`

const updateDto = String.raw`import { Transform } from 'class-transformer'
import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator'

export class UpdateItemDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(4000)
  description?: string
}
`

const itemsController = String.raw`import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common'
import { CreateItemDto } from './dto/create-item.dto.js'
import { UpdateItemDto } from './dto/update-item.dto.js'
import { ItemsService } from './items.service.js'

function itemId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new BadRequestException('Item ID must be a positive integer.')
  return value
}

@Controller('api/items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  async list() { return { data: await this.items.list() } }

  @Get(':id')
  async find(@Param('id', ParseIntPipe) id: number) { return { data: await this.items.find(itemId(id)) } }

  @Post()
  async create(@Body() input: CreateItemDto) { return { data: await this.items.create(input) } }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() input: UpdateItemDto) {
    if (input.name === undefined && input.description === undefined) throw new BadRequestException('Provide a valid name or description update.')
    return { data: await this.items.update(itemId(id), input) }
  }

  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number) { return { data: await this.items.delete(itemId(id)) } }
}
`

const apiExceptionFilter = String.raw`import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common'
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
    const code = status === 404 ? 'NOT_FOUND' : status === 503 ? 'DATABASE_UNAVAILABLE' : status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR'
    const message = status === 404 ? 'Route not found.' : status === 503 ? 'Database unavailable.' : status < 500 ? 'Request could not be processed.' : 'Internal server error.'
    response.status(status).json({ error: { code, message }, path: request.path })
  }
}
`

const appController = String.raw`import { Controller, Get } from '@nestjs/common'
import { AppService } from './app.service.js'

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  getHealth() { return this.appService.getHealth() }

  @Get('api/info')
  getInfo() { return this.appService.getInfo() }
}
`

const appService = String.raw`import { Injectable } from '@nestjs/common'

@Injectable()
export class AppService {
  getHealth(): { status: 'ok' } { return { status: 'ok' } }

  getInfo(): { name: string; version: string; environment: string } {
    return { name: 'BE-09 NestJS PostgreSQL API', version: '0.1.0', environment: process.env.NODE_ENV ?? 'development' }
  }
}
`

const appModule = String.raw`import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { ApiExceptionFilter } from './api-exception.filter.js'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'
import { DatabaseModule } from './database/database.module.js'
import { ItemsModule } from './items/items.module.js'

@Module({
  imports: [DatabaseModule, ItemsModule],
  controllers: [AppController],
  providers: [AppService, { provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
`

const mainSource = String.raw`import { existsSync } from 'node:fs'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { readConfig } from './config.js'

async function bootstrap(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env')
  const { host, port } = readConfig()
  const app = await NestFactory.create(AppModule, { abortOnError: false })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.enableShutdownHooks(['SIGINT', 'SIGTERM'])
  await app.listen(port, host)
}

void bootstrap().catch(() => {
  console.error('Server startup failed; check HOST and PORT without sharing credentials.')
  process.exitCode = 1
})
`

const configSource = String.raw`export interface ServerConfig {
  host: string
  port: number
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = (environment.HOST ?? '127.0.0.1').trim()
  const rawPort = environment.PORT ?? '3000'
  const port = Number(rawPort)
  if (!host || /[\r\n\0]/.test(host)) throw new Error('HOST must be a non-empty host name or IP address.')
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.')
  return { host, port }
}
`

const databaseModule = String.raw`import { Global, Module } from '@nestjs/common'
import { DatabaseService } from './database.service.js'

@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
`

const itemsModule = String.raw`import { Module } from '@nestjs/common'
import { ItemsController } from './items.controller.js'
import { ItemsService } from './items.service.js'

@Module({ controllers: [ItemsController], providers: [ItemsService] })
export class ItemsModule {}
`

const unitTest = String.raw`import { DatabaseService } from './database/database.service'
import { assertTargetMatches, parseDatabaseUrl, parseMigrationTarget } from './db/target'

describe('PostgreSQL target safety and lazy pool', () => {
  it('requires explicit URL host, port, database, and credentials', () => {
    expect(() => parseDatabaseUrl(undefined)).toThrow(/DATABASE_URL is required/)
    expect(() => parseDatabaseUrl('postgresql://user:pass@localhost/database')).toThrow(/explicit host\/port\/database/)
    expect(() => parseMigrationTarget('localhost:54321/db')).not.toThrow()
    expect(() => parseMigrationTarget('localhost/db')).toThrow(/host:port\/database/)
  })

  it('rejects mismatched migration targets before connection and closes unused service cleanly', async () => {
    const target = parseMigrationTarget('127.0.0.1:54321/app_db')
    expect(() => assertTargetMatches(target, { ...target, database: 'other_db' })).toThrow(/does not match/)
    await new DatabaseService().onApplicationShutdown()
  })
})
`

const e2eTest = String.raw`import { ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { DatabaseService } from '../src/database/database.service'

describe('Nest PostgreSQL API', () => {
  let app: import('@nestjs/common').INestApplication

  async function createApp() {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({ getDatabase: () => { throw new Error('secret database failure') } })
      .compile()
    const instance = module.createNestApplication()
    instance.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    await instance.init()
    return instance
  }

  beforeAll(async () => { app = await createApp() })
  afterAll(async () => app.close())

  it('serves DB-free health and versioned API info', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' })
    const info = await request(app.getHttpServer()).get('/api/info').expect(200)
    expect(info.body).toEqual(expect.objectContaining({
      name: 'BE-09 NestJS PostgreSQL API', version: '0.1.0',
    }))
  })

  it('validates DTOs and returns safe database errors', async () => {
    await request(app.getHttpServer()).post('/api/items').send({ name: '  ' }).expect(400)
    await request(app.getHttpServer()).post('/api/items').send({ name: 'valid', unexpected: true }).expect(400)
    await request(app.getHttpServer()).patch('/api/items/1').send({}).expect(400)
    await request(app.getHttpServer()).patch('/api/items/1').send({ name: null }).expect(400)
    const unavailable = await request(app.getHttpServer()).get('/api/items').expect(503)
    expect(unavailable.body).toEqual({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Database unavailable.' }, path: '/api/items' })
    expect(JSON.stringify(unavailable.body)).not.toContain('secret database failure')
  })

  it('returns stable JSON for unknown routes and invalid identifiers', async () => {
    await request(app.getHttpServer()).get('/missing').expect(404, {
      error: { code: 'NOT_FOUND', message: 'Route not found.' }, path: '/missing',
    })
    await request(app.getHttpServer()).get('/api/items/0').expect(400)
  })
})
`

const shutdownTest = String.raw`import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module'

describe('Nest PostgreSQL application shutdown', () => {
  it('closes an initialized listener without opening a database connection', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile()
    const app = module.createNestApplication()
    await app.listen(0, '127.0.0.1')
    expect((app.getHttpServer() as { listening: boolean }).listening).toBe(true)
    await app.close()
    expect((app.getHttpServer() as { listening: boolean }).listening).toBe(false)
  })
})
`

const postgresIntegrationE2e = String.raw`import { ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'

const integration = process.env.PG_E2E_DATABASE_URL ? describe : describe.skip

integration('Nest PostgreSQL CRUD against an explicitly supplied test database', () => {
  let app: import('@nestjs/common').INestApplication
  let savedDatabaseUrl: string | undefined
  let createdId: number | undefined

  beforeAll(async () => {
    savedDatabaseUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = process.env.PG_E2E_DATABASE_URL
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = module.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    await app.init()
  })

  afterAll(async () => {
    try {
      if (createdId) await request(app.getHttpServer()).delete('/api/items/' + createdId)
      await app.close()
    } finally {
      if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = savedDatabaseUrl
    }
  })

  it('validates input and performs create/read/list/update/delete', async () => {
    await request(app.getHttpServer()).post('/api/items').send({ name: '  ' }).expect(400)
    await request(app.getHttpServer()).post('/api/items').send({ name: 'invalid', extra: true }).expect(400)
    await request(app.getHttpServer()).patch('/api/items/1').send({ name: null }).expect(400)
    const createdResponse = await request(app.getHttpServer()).post('/api/items')
      .send({ name: '  disposable BE-09 item  ', description: 'before update' }).expect(201)
    const created = createdResponse.body.data as { id: number; name: string; description: string }
    createdId = created.id
    expect(created.name).toBe('disposable BE-09 item')
    expect(created.description).toBe('before update')

    const listed = await request(app.getHttpServer()).get('/api/items').expect(200)
    expect(listed.body.data.some((item: { id: number }) => item.id === created.id)).toBe(true)
    await request(app.getHttpServer()).get('/api/items/' + created.id).expect(200)
    await request(app.getHttpServer()).patch('/api/items/' + created.id).send({ description: 'after update' }).expect(200)
    expect((await request(app.getHttpServer()).get('/api/items/' + created.id)).body.data.description).toBe('after update')
    await request(app.getHttpServer()).delete('/api/items/' + created.id).expect(200)
    createdId = undefined
    await request(app.getHttpServer()).get('/api/items/' + created.id).expect(404)
  })
})
`

const eslintConfig = String.raw`import eslint from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['eslint.config.mjs', 'drizzle/meta/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.jest } } },
)
`

export async function writeNestPostgresBackendStarter(stage: OwnedStage, projectName: string, pins: readonly DependencyPin[]): Promise<string[]> {
  const { packageJson: scaffoldPackage, jestConfig, e2eConfig } = await validateNestScaffold(stage, projectName)
  const dependencies = Object.fromEntries(pins.filter((pin) => (pin.scope ?? 'dependencies') === 'dependencies').map(({ packageName, version }) => [packageName, version]))
  const devDependencies = Object.fromEntries(pins.filter((pin) => pin.scope === 'devDependencies').map(({ packageName, version }) => [packageName, version]))
  if (Object.keys(dependencies).length !== 9 || Object.keys(devDependencies).length !== pins.length - 9
    || !['@nestjs/common', '@nestjs/core', '@nestjs/platform-express', 'reflect-metadata', 'rxjs', 'class-validator', 'class-transformer', 'drizzle-orm', 'pg'].every((name) => dependencies[name])) {
    throw new GeneratorError({ code: 'GEN_CONFIGURE_FAILED', stage: 'configuring', message: 'BE-09 dependency pins did not match the reviewed NestJS/PostgreSQL contract.', nextAction: 'Inspect the recipe catalog pins before retrying.', targetModified: false })
  }

  const packageJson = {
    ...scaffoldPackage,
    version: '0.1.0',
    private: true,
    license: 'UNLICENSED',
    engines: { node: '>=22.13.0' },
    scripts: {
      build: 'nest build',
      start: 'nest start',
      'start:dev': 'nest start --watch',
      'start:prod': 'node dist/main.js',
      format: 'prettier --write "src/**/*.ts" "test/**/*.ts"',
      lint: 'eslint "{src,test}/**/*.ts"',
      test: 'jest --runInBand',
      'test:e2e': 'jest --config ./test/jest-e2e.json --runInBand',
      typecheck: 'tsc --project tsconfig.json --noEmit',
      'db:generate': 'drizzle-kit generate',
      'db:migrate': 'node --import tsx src/db/migrate.ts',
    },
    dependencies,
    devDependencies,
    jest: { ...jestConfig, testEnvironment: 'node', moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' } },
  }
  const buildConfig = JSON.parse(await readFile(win32.join(stage.childPath, 'tsconfig.build.json'), 'utf8')) as Record<string, unknown>
  const excludes = Array.isArray(buildConfig.exclude) ? buildConfig.exclude.filter((value): value is string => typeof value === 'string') : []
  buildConfig.exclude = [...new Set([...excludes, 'drizzle.config.ts'])]
  const e2eJestConfig = {
    ...e2eConfig,
    moduleNameMapper: { ...((e2eConfig.moduleNameMapper as Record<string, string> | undefined) ?? {}), '^(\\.{1,2}/.*)\\.js$': '$1' },
  }
  const db = postgresDatabaseSupportFiles()
  const migrationSource = db.migrate
    .replace("import { pathToFileURL } from 'node:url'\n", '')
    .replace('const entry = process.argv[1]\nif (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {', 'if (require.main === module) {')
  const prefix = `${projectName}/`
  const writes = await mutateOwnedStage(stage, [
    `${prefix}src`, `${prefix}src/db`, `${prefix}src/database`, `${prefix}src/items`, `${prefix}src/items/dto`, `${prefix}test`, `${prefix}docs`,
  ], [
    { path: `${prefix}package.json`, content: `${JSON.stringify(packageJson, null, 2)}\n`, replace: true },
    { path: `${prefix}tsconfig.build.json`, content: `${JSON.stringify(buildConfig, null, 2)}\n`, replace: true },
    { path: `${prefix}.env.example`, content: 'HOST=127.0.0.1\nPORT=3000\nNODE_ENV=development\nDATABASE_URL=postgresql://app_user:replace_me@127.0.0.1:5432/app_db\n' },
    { path: `${prefix}.gitignore`, content: 'node_modules/\ndist/\ncoverage/\n.env\n.env.*\n!.env.example\n', replace: true },
    { path: `${prefix}eslint.config.mjs`, content: eslintConfig, replace: true },
    { path: `${prefix}drizzle.config.ts`, content: db.drizzleConfig },
    { path: `${prefix}docs/DATABASE-SAFETY.md`, content: db.databaseSafety },
    { path: `${prefix}src/config.ts`, content: configSource },
    { path: `${prefix}src/api-exception.filter.ts`, content: apiExceptionFilter, replace: true },
    { path: `${prefix}src/app.controller.ts`, content: appController, replace: true },
    { path: `${prefix}src/app.service.ts`, content: appService, replace: true },
    { path: `${prefix}src/app.module.ts`, content: appModule, replace: true },
    { path: `${prefix}src/main.ts`, content: mainSource, replace: true },
    { path: `${prefix}src/db/schema.ts`, content: db.schema },
    { path: `${prefix}src/db/target.ts`, content: db.target },
    { path: `${prefix}src/db/migrate.ts`, content: migrationSource },
    { path: `${prefix}src/database/database.module.ts`, content: databaseModule },
    { path: `${prefix}src/database/database.service.ts`, content: databaseService },
    { path: `${prefix}src/items/items.module.ts`, content: itemsModule },
    { path: `${prefix}src/items/items.controller.ts`, content: itemsController },
    { path: `${prefix}src/items/items.service.ts`, content: itemsService },
    { path: `${prefix}src/items/dto/create-item.dto.ts`, content: createDto },
    { path: `${prefix}src/items/dto/update-item.dto.ts`, content: updateDto },
    { path: `${prefix}src/app.controller.spec.ts`, content: unitTest, replace: true },
    { path: `${prefix}test/jest-e2e.json`, content: `${JSON.stringify(e2eJestConfig, null, 2)}\n`, replace: true },
    { path: `${prefix}test/app.e2e-spec.ts`, content: e2eTest, replace: true },
    { path: `${prefix}test/shutdown.e2e-spec.ts`, content: shutdownTest, replace: true },
    { path: `${prefix}test/postgres.integration.e2e-spec.ts`, content: postgresIntegrationE2e },
  ])
  return writes.map((path) => path.slice(prefix.length))
}
