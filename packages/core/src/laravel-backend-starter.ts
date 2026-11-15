import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { win32 } from 'node:path'
import { mutateOwnedStage, type OwnedStage } from './staging.js'

export const LARAVEL_PINS = {
  scaffold: '12.12.2',
  scaffoldCommit: '945f4e5a9fd3695dc0ee512f497c650fb82cfbb8',
  framework: '12.72.0',
  php: '^8.2',
  phpunit: '^11.5.50',
} as const

const ignoredFiles = new Set([
  '.env', 'composer.lock', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc',
  'config/auth.php',
  'vite.config.js', 'vite.config.ts', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml', 'Dockerfile', '.dockerignore',
  'routes/web.php', 'app/Models/User.php', 'public/hot',
])
const ignoredDirectories = new Set(['.git', 'vendor', 'node_modules', 'database', 'resources', 'tests', 'public/build'])

function ignored(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  const name = normalized.split('/').at(-1) ?? normalized
  return ignoredFiles.has(normalized) || ignoredDirectories.has(normalized)
    || normalized.split('/').some((part) => ignoredDirectories.has(part))
    || (name.startsWith('.env.') && name !== '.env.example')
}

async function collectScaffoldFiles(root: string, directory = ''): Promise<{ path: string; content: string }[]> {
  const current = directory ? win32.join(root, directory) : root
  const entries = await readdir(current, { withFileTypes: true })
  const files: { path: string; content: string }[] = []
  for (const entry of entries) {
    const relativePath = directory ? win32.join(directory, entry.name) : entry.name
    if (ignored(relativePath)) continue
    const fullPath = win32.join(root, relativePath)
    const info = await lstat(fullPath)
    if (info.isSymbolicLink()) throw new Error(`Laravel scaffold contains an unexpected symbolic link: ${relativePath}`)
    if (entry.isDirectory() && info.isDirectory()) files.push(...await collectScaffoldFiles(root, relativePath))
    else if (entry.isFile() && info.isFile()) files.push({ path: relativePath, content: await readFile(fullPath, 'utf8') })
    else throw new Error(`Laravel scaffold contains an unsupported file type: ${relativePath}`)
  }
  return files
}

function configuredComposerJson(source: string, projectName: string): string {
  const composer = JSON.parse(source) as {
    name?: string
    require?: Record<string, string>
    'require-dev'?: Record<string, string>
    scripts?: unknown
    config?: Record<string, unknown>
  }
  if (composer.name !== 'laravel/laravel' || composer.require?.php !== '^8.2' || composer.require['laravel/framework'] !== '^12.0') {
    throw new Error('Official Laravel 12.12.2 Composer scaffold identity or requirements changed.')
  }
  composer.name = `forma/${projectName}`
  composer.require['laravel/framework'] = LARAVEL_PINS.framework
  composer.require['ext-pdo_mysql'] = '*'
  delete composer.scripts
  if (composer['require-dev']) {
    delete composer['require-dev']['laravel/sail']
    delete composer['require-dev']['laravel/pail']
    delete composer['require-dev']['laravel/pint']
  }
  composer.config ??= {}
  composer.config['allow-plugins'] = false
  return `${JSON.stringify(composer, null, 4)}\n`
}

function configuredDatabaseConfig(source: string): string {
  const sqliteDefault = /env\('DB_CONNECTION',\s*'sqlite'\)/g
  if ([...source.matchAll(sqliteDefault)].length !== 1) {
    throw new Error('Official Laravel scaffold database default changed; refusing to guess configuration.')
  }
  return source.replace(sqliteDefault, "env('DB_CONNECTION', 'mysql')")
}

export async function writeLaravelBackendStarter(stage: OwnedStage, scaffoldRoot: string, projectName: string): Promise<string[]> {
  const stageRoot = await realpath(stage.path)
  const scaffoldPath = await realpath(scaffoldRoot)
  const relativeScaffold = win32.relative(stageRoot, scaffoldPath)
  if (relativeScaffold.startsWith('..') || win32.isAbsolute(relativeScaffold)) throw new Error('Laravel scaffold escaped generator-owned staging.')

  const sourceFiles = await collectScaffoldFiles(scaffoldPath)
  const composerSource = await readFile(win32.join(scaffoldPath, 'composer.json'), 'utf8')
  const files = new Map(sourceFiles.map(({ path, content }) => [path.replaceAll('\\', '/'), content]))
  files.set('composer.json', configuredComposerJson(composerSource, projectName))
  const databaseConfig = files.get('config/database.php')
  if (!databaseConfig) throw new Error('Official Laravel scaffold is missing config/database.php.')
  files.set('config/database.php', configuredDatabaseConfig(databaseConfig))
  const filesystemsConfig = files.get('config/filesystems.php')
  if (!filesystemsConfig) throw new Error('Official Laravel scaffold is missing config/filesystems.php.')
  const localStorageServing = /('local'\s*=>\s*\[[\s\S]*?'serve'\s*=>\s*)true/
  if ([...filesystemsConfig.matchAll(/'serve'\s*=>\s*true/g)].length !== 1 || !localStorageServing.test(filesystemsConfig)) {
    throw new Error('Official Laravel local filesystem serving configuration changed; refusing to guess.')
  }
  files.set('config/filesystems.php', filesystemsConfig.replace(localStorageServing, '$1false'))
  files.set('.env.example', [
    `APP_NAME=${projectName}`,
    'APP_ENV=local',
    'APP_KEY=',
    'APP_DEBUG=true',
    'APP_URL=http://127.0.0.1:8000',
    'LOG_CHANNEL=stack',
    'LOG_LEVEL=debug',
    '',
    'DB_CONNECTION=mysql',
    'DB_HOST=127.0.0.1',
    'DB_PORT=3306',
    `DB_DATABASE=${projectName}`,
    'DB_USERNAME=root',
    'DB_PASSWORD=',
    '',
    'CACHE_STORE=file',
    'QUEUE_CONNECTION=sync',
    'SESSION_DRIVER=file',
    '',
  ].join('\n'))
  files.set('.gitignore', [
    '/vendor/',
    '/node_modules/',
    '/public/build/',
    '/public/hot',
    '/storage/*.key',
    '/.env',
    '/.env.*',
    '!/.env.example',
    '/.phpunit.cache/',
    '/.phpunit.result.cache',
    '/bootstrap/cache/*.php',
    '',
  ].join('\n'))
  files.set('bootstrap/app.php', `<?php

use Illuminate\\Foundation\\Application;
use Illuminate\\Foundation\\Configuration\\Exceptions;
use Illuminate\\Foundation\\Configuration\\Middleware;
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        then: static function (): void {
            Route::get('/health', static fn () => response()->json(['status' => 'ok']));
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Register Laravel's default API middleware group without adding web/session middleware.
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            static fn (Request $request, \\Throwable $exception): bool => $request->is('api/*') || $request->is('health'),
        );
    })
    ->create();
`)
  files.set('routes/api.php', `<?php

use App\\Models\\ProjectNote;
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Route;

Route::get('/info', static fn () => response()->json([
    'name' => '${projectName} API',
    'framework' => 'Laravel',
    'version' => '0.1.0',
]));

Route::post('/notes', static function (Request $request) {
    $validated = $request->validate([
        'title' => ['required', 'string', 'max:160'],
        'body' => ['required', 'string', 'max:10000'],
    ]);

    $note = ProjectNote::query()->create($validated);

    return response()->json(['data' => $note], 201);
});
`)
  files.set('app/Models/ProjectNote.php', `<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class ProjectNote extends Model
{
    protected $fillable = ['title', 'body'];
}
`)
  files.set('database/migrations/2026_11_15_000000_create_project_notes_table.php', `<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('project_notes', function (Blueprint $table): void {
            $table->id();
            $table->string('title', 160);
            $table->text('body');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('project_notes');
    }
};
`)
  files.set('tests/TestCase.php', `<?php

namespace Tests;

use Illuminate\\Foundation\\Testing\\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
}
`)
  files.set('tests/Feature/ApiTest.php', `<?php

namespace Tests\\Feature;

use Tests\\TestCase;

class ApiTest extends TestCase
{
    public function test_health_and_info_routes_return_json(): void
    {
        $this->get('/health')->assertOk()->assertJson(['status' => 'ok']);
        $this->get('/api/info')->assertOk()->assertJson([
            'name' => '${projectName} API',
            'framework' => 'Laravel',
            'version' => '0.1.0',
        ]);
    }

    public function test_api_validation_errors_are_json_without_accept_header(): void
    {
        $this->post('/api/notes', ['title' => '', 'body' => ''])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['title', 'body']);
    }

    public function test_unknown_api_routes_return_json_errors(): void
    {
        $this->get('/api/not-found')->assertNotFound()->assertJsonStructure(['message']);
    }
}
`)
  files.set('phpunit.xml', `<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true">
    <testsuites>
        <testsuite name="Application">
            <directory>tests</directory>
        </testsuite>
    </testsuites>
    <source>
        <include>
            <directory>app</directory>
        </include>
    </source>
    <php>
        <env name="APP_ENV" value="testing"/>
        <env name="APP_KEY" value=""/>
        <env name="APP_DEBUG" value="true"/>
        <env name="DB_CONNECTION" value="mysql"/>
        <env name="DB_HOST" value="127.0.0.1"/>
        <env name="DB_PORT" value="3306"/>
        <env name="DB_DATABASE" value="laravel_test"/>
        <env name="DB_USERNAME" value="root"/>
        <env name="DB_PASSWORD" value=""/>
        <env name="CACHE_STORE" value="array"/>
        <env name="QUEUE_CONNECTION" value="sync"/>
        <env name="SESSION_DRIVER" value="array"/>
    </php>
</phpunit>
`)

  const paths = [...files.keys()]
  const prefix = `${win32.basename(stage.childPath)}/`
  const directories = [...new Set(paths.map((path) => win32.dirname(`${prefix}${path}`)).filter((path) => path !== '.'))]
  const written = await mutateOwnedStage(stage, directories, [...files].map(([path, content]) => ({ path: `${prefix}${path}`, content })))
  return written.map((path) => path.slice(prefix.length))
}
