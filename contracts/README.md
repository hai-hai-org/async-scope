# AsyncScope M0 Event Contract

M0의 목적은 `sys.monitoring` 수집 방식이 제품에서 사용할 수 있는 이벤트로
정규화될 수 있는지 검증하는 것이다. 이 디렉터리의 fixture는 collector raw log가
아니라, M1 API와 M2 UI가 바라볼 normalized contract 예시다.

## Event mapping

| Source signal | Normalized event | Meaning |
| --- | --- | --- |
| `request.start` | `request.start` | HTTP request lifecycle 시작 |
| `http.response.start` | `response.start` | 응답 전송 시작 (Timeline의 Response 구간 시작점) |
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
| `duration_ns` | 종료/구간 이벤트가 아니면 `null`. tracing 시작 전에 진입한 프레임처럼 시작 시각을 관측하지 못한 종료 이벤트도 `null`이다 — 추정값을 넣지 않는다. |
| `evidence` | `observed` 또는 `inferred` |
| `confidence` | `observed`이면 `null`, 추론이면 0~1 number |
| `sequence` | storage가 보관 시점에 부여하는 transport metadata. collector는 emit하지 않는다. |

Event-specific fields such as `method`, `path`, `status_code`, `category`,
`label`, `library`, `delay_ns`, `threshold_ns`, `status`, `parent_task_id`,
`outcome`, and `disconnect_reason` remain top-level fields so the dashboard can
consume fixtures without depending on collector internals.

## Consumer mapping

| Consumer | Reads |
| --- | --- |
| Timeline request lane | `request.start`, `response.start`, `request.end` |
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

## Collector 구현 현황

collector(`asyncscope.collector`)는 이제 이 계약과 같은 필드 이름·단위로 emit한다.
fixture는 M1 목표 shape이고, 아직 채우지 못한 필드는 `null` 또는 보수적인 기본값으로 나간다.

| 필드 | 지금 나오는 값 | 언제 채워지는가 |
| --- | --- | --- |
| `span_id`, `parent_span_id` | 프로젝트 coroutine 이벤트에 채워진다. request/response/task/loop 이벤트는 `null` | 완료 |
| `duration_ns` | `request.end`, `loop.blocked`, `task.end`, `task.cancel`, `coroutine.end` | 완료 |
| `coroutine.suspend`의 `label`, `library` | `"unknown await"`, `null` | adapter classifier 작업 |
| 예외로 끝난 coroutine | `coroutine.end`가 나오지 않는다 (`PY_UNWIND`는 span 스택 회수에만 쓴다) | 별도 결정 필요 |
| `request.end`의 `status: "disconnected"` | 실제로 나오지 않는다 (아래 참고) | 별도 결정 필요 |

`task_id`는 collector가 부여하는 `task-<n>`이다. Task 이름(`Task-7`)은 loop가 붙이는 순번이고
사용자가 `name=`으로 덮어쓸 수 있어서 식별자로 쓰지 않는다. coroutine 이벤트와 task 이벤트가 같은
id를 쓴다.

collector가 추가로 내보내는 필드다. fixture에는 없지만 소비자가 무시해도 된다.

| 필드 | 이벤트 | 뜻 |
| --- | --- | --- |
| `category`, `label` | `coroutine.*`, `loop.blocked`, `request.end` | Timeline segment 분류와 표시 문구 |
| `gap_start_ns` | `loop.blocked` | 침묵 구간의 추정 시작 시각. 원인 지목이 아니다 |
| `outcome: "raised"` | `task.end` | 예외로 끝난 Task. fixture에 없는 값이다 (`status: "failed"`) |

### 알려진 경계

- 예외나 취소로 끝난 coroutine은 `PY_RETURN`이 발생하지 않으므로 `coroutine.start`의 짝이
  없다. `failure-cancel.json`의 `category: "failed"`, `"cancelled"`는 `PY_UNWIND`/`PY_THROW`를
  수집한 뒤에 만들 수 있다.
- uvicorn HTTP에서 client가 연결을 끊어도 handler는 끝까지 실행되고 응답을 보낸다. 그래서
  `status_code`가 `None`이 되는 경로가 실제로는 없고 `disconnected`도 나오지 않는다. 판정
  규칙(`middleware.outcome`)은 단위 테스트로 고정해 두었다.
- `task.*` 이벤트는 프로젝트 코드 coroutine으로 만든 Task만 낸다. uvicorn 내부 Task와
  asyncscope 자신의 heartbeat는 이벤트를 만들지 않지만 `task_id`는 받으므로, 소비자는
  스트림에 없는 `parent_task_id`를 만날 수 있다. request 연결은 `request_id`로 한다.
- 실패한 Task의 판정에 `Task.exception()`을 쓴다. 그래서 asyncscope가 붙어 있으면 asyncio의
  "Task exception was never retrieved" 경고가 사라진다. 실패 사실은 `task.end status: "failed"`로
  대신 보인다.
- `request.end`의 `status`는 collector가 항상 내보낸다. `timeline.json`, `blocking.json`,
  `unknown-await.json`에는 이 필드가 없다 — 합의 후 fixture를 채우면 된다.
