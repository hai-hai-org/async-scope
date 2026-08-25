from pathlib import Path

import httpx
import pytest

from asyncscope import AsyncScope

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def demo_app():
    from examples.demo import app

    return app


async def test_requests_api_reads_the_event_buffer_without_tracing_itself(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            app_response = await client.get("/demo/quick")
            before = len(scope.events)
            api_response = await client.get("/__asyncscope__/api/requests")
            after = len(scope.events)
    finally:
        scope.uninstall()

    assert app_response.status_code == 200
    assert api_response.status_code == 200
    assert after == before, "내부 API 호출이 대상 앱 tracing event가 되면 안 된다"

    payload = api_response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["method"] == "GET"
    assert payload["items"][0]["path"] == "/demo/quick"
    assert payload["items"][0]["status"] == "completed"
    assert payload["items"][0]["status_code"] == 200


async def test_request_detail_api_uses_stable_request_id_deep_link(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            await client.get("/demo/unknown-await")
            requests = (await client.get("/__asyncscope__/api/requests")).json()
            request_id = requests["items"][0]["request_id"]
            detail_response = await client.get(
                f"/__asyncscope__/api/requests/{request_id}"
            )
            missing_response = await client.get("/__asyncscope__/api/requests/missing")
    finally:
        scope.uninstall()

    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["request"]["request_id"] == request_id
    assert detail["request"]["has_unknown_await"]
    assert detail["events"]
    assert all(event["request_id"] == request_id for event in detail["events"])
    assert missing_response.status_code == 404


async def test_requests_api_supports_query_parameters_and_validation(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            await client.get("/demo/quick")
            await client.get("/demo/unknown-await")

            filtered = await client.get(
                "/__asyncscope__/api/requests",
                params={"path": "/demo/quick", "status": "completed"},
            )
            searched = await client.get(
                "/__asyncscope__/api/requests",
                params={"q": "unknown await"},
            )
            invalid = await client.get(
                "/__asyncscope__/api/requests",
                params={"sort": "sequence"},
            )
    finally:
        scope.uninstall()

    assert filtered.status_code == 200
    assert [item["path"] for item in filtered.json()["items"]] == ["/demo/quick"]

    assert searched.status_code == 200
    assert [item["path"] for item in searched.json()["items"]] == [
        "/demo/unknown-await"
    ]

    assert invalid.status_code == 400
    assert invalid.json()["error"] == "bad_request"
