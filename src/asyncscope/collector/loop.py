"""Event Loop heartbeat. asyncio.sleep의 실제 소요와 명목 간격의 차이로 loop 지연을 잰다."""

from __future__ import annotations

import asyncio
import time

from .monitoring import emit

# ponytail: sampling 방식이라 interval보다 짧은 blocking은 놓치고, 지연 시작 시각도
# 최대 interval만큼 늦게 잡힌다. 정확한 시작점이 필요해지면 loop의 _run_once를
# 계측하는 방향으로 올린다. 두 값은 실측으로 조정하는 노브다 (Settings API가 노출할 값).
DEFAULT_THRESHOLD = 0.05
DEFAULT_INTERVAL = 0.01
# heartbeat sampling의 고정 신뢰도. contracts/fixtures/blocking.json에서 합의된 값이다.
CONFIDENCE = 0.6


async def heartbeat(threshold: float = DEFAULT_THRESHOLD, interval: float = DEFAULT_INTERVAL):
    """threshold를 넘는 loop 지연마다 loop.blocked를 기록한다. 취소될 때까지 돈다."""
    threshold_ns = round(threshold * 1e9)
    while True:
        t0 = time.perf_counter()
        await asyncio.sleep(interval)
        delay_ns = round((time.perf_counter() - t0 - interval) * 1e9)
        if delay_ns > threshold_ns:
            # 원인을 여기서 지목하지 않는다. 깨어난 시점에 마지막으로 관측된 coroutine은
            # 이미 blocking이 끝난 뒤에 실행된 다른 요청일 수 있다 (실측으로 확인).
            # 대신 침묵 구간만 기록하고, 그 직전 이벤트를 찾는 건 stream을 다 가진
            # 분석 쪽이 한다 — analysis/findings.py.
            emit(
                "loop.blocked",
                duration_ns=delay_ns,
                evidence="inferred",
                confidence=CONFIDENCE,
                category="blocking",
                label="unattributed loop delay",
                delay_ns=delay_ns,
                threshold_ns=threshold_ns,
                gap_start_ns=time.perf_counter_ns() - delay_ns,
            )


def start(threshold: float = DEFAULT_THRESHOLD, interval: float = DEFAULT_INTERVAL) -> asyncio.Task:
    """호출자가 반환된 Task를 cancel해서 멈춘다."""
    return asyncio.create_task(heartbeat(threshold, interval), name="asyncscope-heartbeat")
