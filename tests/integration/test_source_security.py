"""Source snippet API 경계.

project root 안의 `.py`만 읽는다. 여기서 새는 건 남의 소스와 파일 시스템 구조다.
"""

import sys

import httpx
import pytest

from asyncscope import AsyncScope

SOURCE_URL = "/__asyncscope__/api/source"


async def _app(scope, receive, send):  # pragma: no cover - API가 먼저 가로챈다
    raise AssertionError("source API가 대상 app으로 새면 안 된다")


@pytest.fixture
def project(tmp_path):
    """root 안 파일 하나, 밖으로 나가는 미끼 셋."""
    (tmp_path / "service.py").write_text("import time\n" * 3 + "def handler():\n    pass\n")
    (tmp_path / "notes.txt").write_text("secret\n")
    (tmp_path / "pkg").mkdir()

    outside = tmp_path.parent / "outside.py"
    outside.write_text("OUTSIDE_SECRET = 1\n")
    (tmp_path / "escape.py").symlink_to(outside)

    return tmp_path


@pytest.fixture
def client(project):
    # install()하지 않는다. 내부 API는 tracing과 무관하게 __call__ 앞단에서 처리된다.
    scope = AsyncScope(_app, project_root=project)
    transport = httpx.ASGITransport(app=scope)
    return httpx.AsyncClient(transport=transport, base_url="http://t")


async def test_reads_a_python_file_inside_the_project_root(client):
    async with client:
        response = await client.get(SOURCE_URL, params={"file": "service.py", "line": 4})

    assert response.status_code == 200
    payload = response.json()
    assert payload["file"] == "service.py"
    assert payload["start_line"] == 1
    assert "def handler():" in payload["lines"]
    # 절대 경로를 돌려주면 배포 환경의 디렉터리 구조가 새어 나간다.
    assert not payload["file"].startswith("/")


@pytest.mark.parametrize(
    "file",
    [
        "../outside.py",
        "../../etc/passwd",
        "/etc/passwd",
        "escape.py",  # root 안에 있지만 symlink가 밖을 가리킨다
        "notes.txt",
        "pkg",
        f"{sys.prefix}/lib/python3.12/site-packages/pytest/__init__.py",
    ],
)
async def test_refuses_everything_outside_the_python_source_boundary(client, file):
    async with client:
        response = await client.get(SOURCE_URL, params={"file": file, "line": 1})

    assert response.status_code == 403, response.text
    assert response.json()["error"] == "forbidden"


async def test_missing_file_inside_the_root_is_not_found(client):
    async with client:
        response = await client.get(SOURCE_URL, params={"file": "nope.py", "line": 1})

    assert response.status_code == 404


@pytest.mark.parametrize(
    "params",
    [
        {"line": 1},
        {"file": "service.py", "line": "0"},
        {"file": "service.py", "line": "one"},
        {"file": "service.py", "line": 1, "radius": "9999"},
    ],
)
async def test_rejects_unusable_parameters(client, params):
    async with client:
        response = await client.get(SOURCE_URL, params=params)

    assert response.status_code == 400
    assert response.json()["error"] == "bad_request"
