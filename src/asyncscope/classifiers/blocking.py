"""Event Loop를 막는 것으로 알려진 호출 목록.

지금은 데이터만이다. 아무도 호출하지 않는다. `analysis/findings.py`가 `loop.blocked`를
어느 코루틴에 연결할 때, 그리고 recommendation을 만들 때 여기를 읽는다.

`loop.blocked` 자체는 heartbeat sampling이라 "무언가 늦었다"까지만 안다 (`inferred`,
confidence 0.6). 이 표는 그 지연에 이름을 붙일 후보를 준다 — 확정이 아니라 후보다.

ponytail: 목록을 짧게 유지한다. socket이나 open처럼 asyncio 자신이 내부에서 쓰거나
정상 사용이 흔한 호출은 넣지 않는다. 오탐 하나가 Analyzer 전체의 신뢰를 깎는다.
"""

from __future__ import annotations

# dotted path -> (사람이 읽는 이름, 검증된 대안)
KNOWN_BLOCKING = {
    "time.sleep": (
        "time.sleep()",
        "await asyncio.sleep()으로 바꾼다.",
    ),
    "os.system": (
        "os.system()",
        "await asyncio.create_subprocess_shell()로 바꾼다.",
    ),
    "subprocess.run": (
        "subprocess.run()",
        "await asyncio.create_subprocess_exec()로 바꾼다.",
    ),
    "subprocess.check_output": (
        "subprocess.check_output()",
        "await asyncio.create_subprocess_exec()로 바꾸고 stdout을 읽는다.",
    ),
    "subprocess.Popen.wait": (
        "Popen.wait()",
        "asyncio.create_subprocess_exec()의 Process.wait()를 await한다.",
    ),
    "urllib.request.urlopen": (
        "urllib.request.urlopen()",
        "httpx.AsyncClient 같은 async HTTP client를 await한다.",
    ),
    "sqlite3.Connection.execute": (
        "sqlite3 쿼리",
        "asyncio.to_thread()로 옮기거나 async driver를 쓴다.",
    ),
    # 서드파티. 설치돼 있지 않을 수 있다.
    "requests.api.request": (
        "requests 요청",
        "httpx.AsyncClient 같은 async HTTP client를 await한다.",
    ),
}
