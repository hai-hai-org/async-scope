import asyncio
import time
from pathlib import Path

import httpx
import pytest

from asyncscope import AsyncScope

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def demo_app():
    from examples.demo import app

    return app


async def _wait_for_loop_blocked(scope, timeout: float = 2.0) -> None:
    """heartbeat는 sampling이라 요청이 끝난 직후에는 아직 지연을 기록하지 않았다."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(event["type"] == "loop.blocked" for event in scope.events):
            return
        await asyncio.sleep(0.01)
    raise AssertionError("heartbeat가 loop 지연을 기록하지 않았다")


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


async def test_request_detail_explains_the_duration_with_spans_and_buckets(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            await client.get("/demo/non-blocking")
            requests = (await client.get("/__asyncscope__/api/requests")).json()
            request_id = requests["items"][0]["request_id"]
            detail = (
                await client.get(f"/__asyncscope__/api/requests/{request_id}")
            ).json()
    finally:
        scope.uninstall()

    distribution = detail["time_distribution"]
    assert sum(distribution["buckets"].values()) == distribution["measured_ns"]
    assert distribution["buckets"]["waiting"] > 0, "asyncio.sleep은 대기 시간이다"

    assert detail["spans"], "Execution Flow가 그릴 span tree가 있어야 한다"
    assert any(span["children"] for span in detail["spans"]), "부모·자식 관계가 남아야 한다"


async def test_findings_api_reports_the_loop_delay_and_its_affected_request(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            # heartbeat가 첫 주기에 들어가기 전에 막으면 잴 지연 자체가 없다.
            await asyncio.sleep(0.05)
            await client.get("/demo/blocking")
            await _wait_for_loop_blocked(scope)
            before = len(scope.events)
            listed = await client.get("/__asyncscope__/api/findings")
            after = len(scope.events)

            findings = listed.json()
            finding_id = findings["items"][0]["finding_id"]
            detail = await client.get(f"/__asyncscope__/api/findings/{finding_id}")
            missing = await client.get("/__asyncscope__/api/findings/blocking-0")
            filtered = await client.get(
                "/__asyncscope__/api/findings", params={"severity": "nonsense"}
            )
    finally:
        scope.uninstall()

    assert listed.status_code == 200
    assert after == before, "내부 API 호출이 대상 앱 tracing event가 되면 안 된다"

    blocking = [item for item in findings["items"] if item["type"] == "blocking"]
    assert blocking, "time.sleep(0.3)은 finding이 되어야 한다"
    assert blocking[0]["evidence"] == "inferred"
    recommendation = blocking[0]["recommendation"]
    assert recommendation["kind"] == "known_blocking_call"
    assert recommendation["certainty"] == "candidate"
    assert any("time.sleep()" in step["text"] for step in recommendation["steps"])
    assert any("await asyncio.sleep()" in step["text"] for step in recommendation["steps"])
    assert blocking[0]["affected_requests"][0]["path"] == "/demo/blocking"

    assert detail.status_code == 200
    assert detail.json()["finding_id"] == finding_id
    assert missing.status_code == 404
    assert filtered.status_code == 400


async def test_source_api_serves_the_project_file_a_finding_points_at(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            # heartbeat가 첫 주기에 들어가기 전에 막으면 잴 지연 자체가 없다.
            await asyncio.sleep(0.05)
            await client.get("/demo/blocking")
            await _wait_for_loop_blocked(scope)
            findings = (await client.get("/__asyncscope__/api/findings")).json()
            suspect = next(
                item["suspect"]
                for item in findings["items"]
                if item["type"] == "blocking" and item["suspect"]
            )
            snippet = await client.get(
                "/__asyncscope__/api/source",
                params={"file": suspect["source"]["file"], "line": suspect["source"]["line"]},
            )
            escape = await client.get(
                "/__asyncscope__/api/source",
                params={"file": "../../etc/passwd", "line": 1},
            )
    finally:
        scope.uninstall()

    assert suspect["certainty"] == "candidate", "heartbeat sampling은 범인을 단정하지 않는다"
    assert suspect["source"]["function"] == "blocking"
    assert snippet.status_code == 200
    assert snippet.json()["file"] == suspect["source"]["file"]
    assert escape.status_code == 403


async def test_summary_api_reports_live_metrics_without_tracing_itself(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            # heartbeat가 첫 주기에 들어가기 전에 막으면 잴 지연 자체가 없다.
            await asyncio.sleep(0.05)
            await client.get("/demo/quick")
            await client.get("/demo/blocking")
            await _wait_for_loop_blocked(scope)

            before = len(scope.events)
            response = await client.get("/__asyncscope__/api/summary")
            after = len(scope.events)

            invalid = await client.get(
                "/__asyncscope__/api/summary", params={"window": "99999"}
            )
    finally:
        scope.uninstall()

    assert response.status_code == 200
    assert after == before, "내부 API 호출이 대상 앱 tracing event가 되면 안 된다"

    summary = response.json()
    assert summary["tracing"] is True
    assert summary["request_rate_per_second"] > 0
    assert summary["blocking_count"] >= 1
    assert summary["loop_delay"]["samples"] >= 1
    assert summary["loop_delay"]["average_ns"] >= summary["loop_delay"]["threshold_ns"]
    assert summary["buffer"]["events"] == len(scope.events)
    assert summary["buffer"]["last_sequence"] is not None

    assert invalid.status_code == 400
    assert invalid.json()["error"] == "bad_request"


async def test_summary_api_says_tracing_is_off_before_install(demo_app):
    """빈 값이 idle 때문인지 tracing이 꺼져서인지 UI가 구분할 수 있어야 한다."""
    scope = AsyncScope(demo_app, project_root=ROOT)  # install()하지 않는다
    transport = httpx.ASGITransport(app=scope)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        summary = (await client.get("/__asyncscope__/api/summary")).json()

    assert summary["tracing"] is False
    assert summary["request_rate_per_second"] is None
    assert summary["buffer"]["events"] == 0
