import { mutateOwnedStage, type OwnedStage } from './staging.js'

export const FASTAPI_PINS = {
  fastapi: '0.163.0',
  pydantic: '2.14.3',
  uvicorn: '0.54.0',
  pytest: '9.2.0',
  httpx: '0.28.1',
} as const

export async function writeFastApiBackendStarter(stage: OwnedStage, projectName: string): Promise<string[]> {
  const prefix = `${projectName}/`
  const pyproject = `[project]
name = "${projectName}"
version = "0.1.0"
requires-python = ">=3.14,<3.15"
dependencies = [
    "fastapi==${FASTAPI_PINS.fastapi}",
    "pydantic==${FASTAPI_PINS.pydantic}",
    "uvicorn==${FASTAPI_PINS.uvicorn}",
]

[project.optional-dependencies]
test = [
    "httpx==${FASTAPI_PINS.httpx}",
    "pytest==${FASTAPI_PINS.pytest}",
]

[tool.uv]
package = false

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q"
`
  const files: Record<string, string> = {
    'app/__init__.py': '',
    'app/__main__.py': `import uvicorn

from app.core.config import settings


if __name__ == "__main__":
    uvicorn.run("app.main:app", host=settings.host, port=settings.port)
`,
    'app/main.py': `from fastapi import FastAPI

from app.api.routes.health import router as health_router
from app.api.routes.info import router as info_router

app = FastAPI(title=${JSON.stringify(`${projectName} API`)}, version="0.1.0")
app.include_router(health_router)
app.include_router(info_router)
`,
    'app/api/__init__.py': '',
    'app/api/routes/__init__.py': '',
    'app/api/routes/health.py': `from fastapi import APIRouter

router = APIRouter()


@router.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}
`,
    'app/api/routes/info.py': `from fastapi import APIRouter

router = APIRouter()


@router.get("/api/info", tags=["info"])
def info() -> dict[str, str]:
    return {"name": ${JSON.stringify(`${projectName} API`)}, "version": "0.1.0"}
`,
    'app/core/__init__.py': '',
    'app/core/config.py': `import os

from pydantic import BaseModel, ConfigDict, Field


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    host: str = Field(default="127.0.0.1", min_length=1, max_length=253, pattern=r"^[^\\r\\n\\x00]+$")
    port: int = Field(default=8000, ge=1, le=65535)


settings = Settings.model_validate({
    "host": os.getenv("HOST", "127.0.0.1"),
    "port": os.getenv("PORT", "8000"),
})
`,
    'tests/test_health.py': `from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
`,
    'tests/test_info.py': `from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_info() -> None:
    response = client.get("/api/info")

    assert response.status_code == 200
    assert response.json() == {"name": ${JSON.stringify(`${projectName} API`)}, "version": "0.1.0"}


def test_openapi_docs() -> None:
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/docs").status_code == 200
`,
    'tests/test_shutdown.py': `import asyncio
import socket

import httpx
import uvicorn

from app.main import app


def test_uvicorn_shuts_down_gracefully() -> None:
    async def exercise() -> None:
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        listener.setblocking(False)
        server = uvicorn.Server(uvicorn.Config(app, log_level="critical", lifespan="off"))
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            for _ in range(100):
                if server.started:
                    break
                await asyncio.sleep(0.05)
            assert server.started
            async with httpx.AsyncClient() as client:
                response = await client.get(f"http://127.0.0.1:{listener.getsockname()[1]}/health")
            assert response.status_code == 200
        finally:
            server.should_exit = True
            await asyncio.wait_for(task, timeout=5)
            listener.close()

    asyncio.run(exercise())
`,
    'pyproject.toml': pyproject,
    '.python-version': '3.14.0\n',
    '.env.example': 'HOST=127.0.0.1\nPORT=8000\n',
    '.gitignore': '.venv/\n__pycache__/\n.pytest_cache/\n*.py[cod]\n.env\n',
  }
  const directories = ['app', 'app/api', 'app/api/routes', 'app/core', 'tests'].map((directory) => `${prefix}${directory}`)
  const writes = await mutateOwnedStage(stage, directories, Object.entries(files).map(([path, content]) => ({ path: `${prefix}${path}`, content })))
  return writes.map((path) => path.slice(prefix.length))
}
