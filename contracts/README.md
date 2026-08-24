# AsyncScope M0 Event Contract

M0의 목적은 `sys.monitoring` 수집 방식이 제품에서 사용할 수 있는 이벤트로
정규화될 수 있는지 검증하는 것이다. 이 디렉터리의 fixture는 collector raw log가
아니라, M1 API와 M2 UI가 바라볼 normalized contract 예시다.

## Event mapping

| Source signal | Normalized event | Meaning |
| --- | --- | --- |
| `request.start` | `request.start` | HTTP request lifecycle 시작 |
| `request.end` | `request.end` | HTTP request lifecycle 종료 |
| `PY_START` | `coroutine.start` | 프로젝트 coroutine 실행 시작 |
| `PY_YIELD` | `coroutine.suspend` | coroutine이 `await` 지점에서 중단 |
| `PY_RESUME` | `coroutine.resume` | 중단된 coroutine 실행 재개 |
| `PY_RETURN` | `coroutine.end` | coroutine 종료 |
| `loop.blocked` | `loop.blocked` | heartbeat 기준 event loop 지연 감지 |
| M1 Task lifecycle | `task.start`, `task.end`, `task.cancel` | background Task의 생성, 완료, 취소를 UI가 소비할 형태 |

## Common event fields

모든 normalized event는 다음 공통 필드를 가진다.

| Field | Rule |
| --- | --- |
| `type` | normalized event name |
| `timestamp_ns` | monotonic clock timestamp in nanoseconds |
| `request_id` | request에 속하지 않으면 `null` |
| `task_id` | M0에서는 raw `task` 값을 임시로 사용한다. 안정적인 Task identity는 M1에서 확정한다. |
| `span_id` | span에 속하지 않으면 `null` |
| `parent_span_id` | root span 또는 span 외 이벤트면 `null` |
| `source` | project-relative Python source location 또는 `null` |
| `duration_ns` | 종료/구간 이벤트가 아니면 `null` |
| `evidence` | `observed` 또는 `inferred` |
| `confidence` | `observed`이면 `null`, 추론이면 0~1 number |

Event-specific fields such as `method`, `path`, `status_code`, `category`,
`label`, `library`, `delay_ns`, `threshold_ns`, `status`, `parent_task_id`,
`outcome`, and `disconnect_reason` remain top-level fields so the dashboard can
consume fixtures without depending on collector internals.

## Consumer mapping

| Consumer | Reads |
| --- | --- |
| Timeline request lane | `request.start`, `request.end` |
| Timeline coroutine segment | `coroutine.start`, `coroutine.suspend`, `coroutine.resume`, `coroutine.end` |
| Background Task lane | `task.start`, `task.end`, `task.cancel` |
| Blocking marker | `loop.blocked` |
| Request inspector metadata | request lifecycle fields and request duration |
| Execution Flow | `span_id`, `parent_span_id`, source, and coroutine start/end duration |
| Source viewer | `source.file`, `source.function`, `source.line` |
| Evidence legend | `evidence`, `confidence`, `category`, `label` |

## Accuracy boundary

- `observed` means the event came from `sys.monitoring`, ASGI lifecycle, or an
  explicit collector signal.
- `inferred` means the system is explaining a derived condition such as loop
  delay. It must not be styled or worded as directly observed fact.
- Unsupported awaits use `category: "await"` and `label: "unknown await"`.
  They must not be labeled DB, HTTP, Redis, or WebSocket without adapter
  evidence.
- `loop.blocked` in M0 is an unattributed delay. The collector must not attach
  a `suspect` or otherwise name a culprit from heartbeat timing alone.
- Background task, adapter, cancel, and disconnect fixtures include expected
  normalized fields that M1 collectors and query APIs must produce. They are
  consumer contracts, not proof that the current M0 collector already emits
  every normalized event.
- Fixtures must not contain request/response body, headers, cookies, query
  string, function argument values, local variable values, environment values,
  or absolute filesystem paths.

## M0 scenario coverage

| Scenario | Fixture | Status |
| --- | --- | --- |
| Concurrent `asyncio.sleep` requests | `timeline.json` | done |
| Event loop delay from `time.sleep` | `blocking.json` | done |
| Unsupported await fallback | `unknown-await.json` | done |
| Background Task complete/cancel | `background-task.json` | demo + fixture |
| Failure and request cancellation | `failure-cancel.json` | demo + fixture |
| Supported adapter labels | `adapter-awaits.json` | fixture-only |
| Client disconnect | `disconnect.json` | fixture-only |

M1 must still implement stable `task_id`, real `task.start/end/cancel`
collection, adapter classifiers, and API/query behavior against this contract.
