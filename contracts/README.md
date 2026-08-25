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

## Transport buffer metadata

`EventBuffer`는 bounded ring buffer다. 저장 시 `sequence`를 단조 증가 값으로 붙이고,
최대 크기를 넘으면 가장 오래된 이벤트를 버린다. SSE/replay 소비자는 다음 값을 함께
사용해야 한다.

| Value | Meaning |
| --- | --- |
| `first_sequence` | 현재 buffer에 남아 있는 가장 오래된 이벤트 sequence |
| `last_sequence` | 현재 buffer에 남아 있는 가장 최신 이벤트 sequence |
| `dropped_count` | overflow로 buffer에서 밀려난 이벤트 수 |
| `cursor_was_dropped(cursor)` | client cursor 이후 필요한 이벤트 일부가 이미 사라졌는지 여부 |

## SSE event stream API

Timeline live update와 reconnect/replay가 소비한다. 내부 API는 target app보다 먼저 처리되므로
SSE 연결 자체를 tracing event로 남기지 않는다.

| Endpoint | Meaning |
| --- | --- |
| `GET /__asyncscope__/api/events` | event buffer를 Server-Sent Events로 전달 |

cursor는 `cursor` query parameter를 우선 사용하고, 없으면 `Last-Event-ID` header를 쓴다.
둘 다 없으면 현재 buffer snapshot 전체를 보낸다. `once=true`는 테스트와 초기 replay 확인용으로,
현재 보낼 수 있는 event 또는 gap만 보내고 연결을 닫는다. 기본 모드는 연결을 유지하며 새 event를
stream한다.

일반 event frame:

```text
id: <sequence>
event: asyncscope.event
data: <normalized event JSON>
```

client cursor 이후 필요한 event가 이미 buffer에서 밀렸으면 일반 event 대신 gap frame을 보낸다.

```text
event: asyncscope.gap
data: {"error":"event_gap","cursor":0,"first_sequence":2,"last_sequence":10,"dropped_count":1}
```

## Consumer mapping

| Consumer | Reads |
| --- | --- |
| Timeline request lane | `request.start`, `response.start`, `request.end` |
| Timeline coroutine segment | `coroutine.start`, `coroutine.suspend`, `coroutine.resume`, `coroutine.end` |
| Background Task lane | `task.start`, `task.end`, `task.cancel` |
| Blocking marker | `loop.blocked` |
| Request inspector metadata | request lifecycle fields and request duration |
| Execution Flow | request detail의 `spans` tree |
| TimeDistribution | request detail의 `time_distribution` |
| Source viewer | `GET /__asyncscope__/api/source` |
| Analyzer finding | `GET /__asyncscope__/api/findings` |
| Evidence legend | `evidence`, `confidence`, `category`, `label` |

## Requests query API

M1의 Requests 화면은 내부 API가 반환하는 request summary와 detail을 소비한다.
내부 API는 target app보다 먼저 처리되므로 자기 자신을 tracing event로 남기지 않는다.

| Endpoint | Meaning |
| --- | --- |
| `GET /__asyncscope__/api/requests` | request summary list |
| `GET /__asyncscope__/api/requests/{request_id}` | request summary와 해당 request events |

List endpoint는 `q`, `status`, `method`, `path`, `sort`, `order`, `page`, `page_size`를
지원한다. 기본 정렬은 `started_at_ns desc`, 기본 page size는 50, 최대 page size는 200이다.

request summary는 `request_id`, `method`, `path`, `status`, `status_code`,
`started_at_ns`, `ended_at_ns`, `duration_ns`, `response_started_at_ns`, `event_count`,
`span_count`, `task_count`, `libraries`, `has_blocking`, `has_unknown_await`를 가진다.
`request.end`가 아직 없으면 `status: "running"`으로 반환한다.

`has_blocking`은 request 자신의 blocking 이벤트뿐 아니라 request window와 겹치는
`loop.blocked` 구간으로도 참이 된다. `loop.blocked`는 `request_id`가 없으므로 겹침이
유일한 연결 수단이다.

### Request detail

detail은 summary와 event 목록에 더해 `time_distribution`과 `spans`를 준다.

```json
{
  "request": { "...summary..." },
  "time_distribution": {
    "duration_ns": 57000000,
    "measured_ns": 57000000,
    "complete": true,
    "buckets": {
      "running": 4000000,
      "waiting": 51000000,
      "blocking": 0,
      "response": 500000,
      "unattributed": 1500000
    }
  },
  "spans": ["...span node..."],
  "events": []
}
```

- `measured_ns`는 `request.start`부터 `request.end`까지의 벽시계 구간이고 bucket 합은
  항상 이 값과 같다. `duration_ns`는 middleware가 잰 값이라 별도로 준다.
- 구간이 겹치면 `blocking` > `response` > `waiting` > `running` 순으로 이긴다. `waiting`이
  `running`보다 높은 이유는 `await`가 자식부터 부모까지 순서대로 suspend되기 때문이다.
- 어떤 구간에도 덮이지 않은 시간은 `unattributed`로 남긴다. 합을 100%로 맞추려고
  다른 bucket에 얹지 않는다.
- `complete: false`면 아직 끝나지 않은 request이고 `duration_ns`는 `null`이다.

span node는 `span_id`, `parent_span_id`, `task_id`, `label`, `source`, `started_at_ns`,
`ended_at_ns`, `duration_ns`, `wait_ns`, `libraries`, `evidence`, `confidence`,
`truncated`, `children`을 가진다. `truncated`는 `coroutine.start`를 보지 못한 span이다
(예외로 끝났거나 ring buffer에서 앞부분이 밀렸다). parent가 stream에 없는 span은 root로
올라온다.

## Findings query API

Analyzer 화면이 소비한다. finding은 이벤트가 아니다. buffer에 이미 판정 재료가 다 있으므로
조회 시점에 파생한다 — 판정이 hot path에 들어가지 않고, ring buffer에서 밀려나지 않고,
threshold를 바꾸면 과거 데이터에도 소급 적용된다. `finding.created` 이벤트는 내보내지 않는다.

| Endpoint | Meaning |
| --- | --- |
| `GET /__asyncscope__/api/findings` | finding list |
| `GET /__asyncscope__/api/findings/{finding_id}` | finding 하나 |

filter는 `type`, `severity`, `evidence`, `request_id`이고 모두 정확히 일치하는 집합이다
(`?severity=low,medium` 또는 `?severity=low&severity=medium`). `request_id`가 affected
request query다. `page`, `page_size` 규칙은 Requests와 같다. 정렬은 severity 내림차순,
같으면 최근 것부터다.

finding은 `finding_id`, `type`, `severity`, `title`, `evidence`, `confidence`,
`detected_at_ns`, `duration_ns`, `threshold_ns`, `suspect`, `affected_requests`,
`recommendation`을 가진다.

| `type` | 파생 소스 | `finding_id` | severity |
| --- | --- | --- | --- |
| `blocking` | `loop.blocked` 하나 | `blocking-<timestamp_ns>` | 지연이 threshold의 10배 이상 high, 3배 이상 medium |
| `unattributed` | 설명되지 않은 request 구간 | `unattributed-<request_id>` | 비중 50% 이상 high, 30% 이상 medium |

`unattributed`는 설명 못 한 시간이 10ms 이상이고 비중이 20% 이상일 때만 올린다. 짧은
request의 측정 오차가 매번 finding이 되면 목록이 쓸모없어진다.

`suspect`는 침묵 구간 **시작 직전**에 마지막으로 실행된 프로젝트 프레임이며 항상
`certainty: "candidate"`다. heartbeat가 깨어난 시점의 마지막 coroutine을 쓰면 지연이 끝난
뒤 처리된 다른 request를 지목하게 된다. `recommendation`은 Day 10까지 항상 `null`이다.

## Source snippet API

| Endpoint | Meaning |
| --- | --- |
| `GET /__asyncscope__/api/source?file=&line=&radius=` | project root 안 `.py` 파일의 읽기 전용 snippet |

`radius`는 기본 5, 최대 50이고 `line` 위아래로 그만큼 준다. 응답은 `file`(project 상대
경로), `start_line`, `lines`다.

| 상황 | 응답 |
| --- | --- |
| project root 밖, symlink 탈출, 절대 경로, 비-`.py` | `403 forbidden` |
| root 안이지만 없는 파일 | `404 not_found` |
| `file` 누락, `line < 1`, 정수가 아닌 값, `radius > 50` | `400 bad_request` |

없는 파일과 거부된 경로를 구분해 알려 주지 않는다. 구분 자체가 root 안 디렉터리 구조를
흘린다. 절대 경로는 응답에 넣지 않는다.

## Accuracy boundary

- `observed` means the event came from `sys.monitoring`, ASGI lifecycle, or an
  explicit collector signal.
- `inferred` means the system is explaining a derived condition such as loop
  delay. It must not be styled or worded as directly observed fact.
- Unsupported awaits use `category: "await"` and `label: "unknown await"`.
  They must not be labeled DB, HTTP, Redis, or WebSocket without adapter
  evidence.
- `loop.blocked` in M0 is an unattributed delay. The collector must not attach
  a `suspect` or otherwise name a culprit from heartbeat timing alone. 전체 stream을
  가진 분석 단계는 침묵 구간 직전 프레임을 후보로 제시할 수 있지만
  `certainty: "candidate"`를 붙여 확정이 아님을 드러낸다.
- Background task, adapter, cancel, and disconnect fixtures include expected
  normalized fields that M1 collectors and query APIs must produce. They are
  consumer contracts, not proof that the current M0 collector already emits
  every normalized event.
- `status_code`가 `null`이 아닌 `request.end`는 같은 `request_id`의
  `response.start`를 가져야 한다. 취소/연결 해제처럼 응답이 시작되지 않은 request에는
  `response.start`가 없을 수 있다.
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

M1 must still implement adapter classifiers and API/query behavior against this
contract.

## Collector 구현 현황

collector(`asyncscope.collector`)는 이제 이 계약과 같은 필드 이름·단위로 emit한다.
fixture는 M1 목표 shape이고, 아직 채우지 못한 필드는 `null` 또는 보수적인 기본값으로 나간다.

| 필드 | 지금 나오는 값 | 언제 채워지는가 |
| --- | --- | --- |
| `span_id`, `parent_span_id` | 프로젝트 coroutine 이벤트에 채워진다. request/response/task/loop 이벤트는 `null` | 완료 |
| `duration_ns` | `request.end`, `loop.blocked`, `task.end`, `task.cancel`, `coroutine.end` | 완료 |
| `coroutine.suspend`의 `label`, `library` | 지원 adapter는 `"await asyncpg fetch"` 형태 label과 `library`, 나머지는 `"unknown await"` / `null` | 완료 |
| 예외로 끝난 coroutine | `coroutine.end`가 나오지 않는다 (`PY_UNWIND`는 span 스택 회수에만 쓴다) | 별도 결정 필요 |
| `request.end`의 `status: "disconnected"` | 실제로 나오지 않는다 (아래 참고) | 별도 결정 필요 |
| request별 blocking 시간 | request window와 `loop.blocked` 구간의 겹침으로 계산한다 | 완료 |

### 지원 adapter

adapter 진입점을 감싸 실제 호출을 관측하므로 `evidence`는 `observed`, `confidence`는 `null`이다.
`library`당 진입점 하나로 시작한다.

| `library` | 관측 지점 | `label` |
| --- | --- | --- |
| `asyncpg` | `Connection.fetch` | `await asyncpg fetch` |
| `httpx` | `AsyncClient.request` | `await HTTPX request` |
| `redis.asyncio` | `Redis.execute_command` | `await Redis command` |
| `websockets` | `Connection.recv` (asyncio/legacy 양쪽) | `await WebSocket receive` |

목록 밖의 await는 `label: "unknown await"` / `library: null`로 남는다. 추측해서 이름 붙이지 않는다.

label은 adapter를 **직접 호출한 프레임**의 suspend에만 붙는다. 그 호출 아래에서 도는 다른
coroutine의 suspend는 자기 await를 기다리는 것이므로 `unknown`으로 남는다.

collector는 이미 import된 adapter만 감싼다. 대상 앱이 쓰지 않는 라이브러리를 collector가
import하지 않는다. handler 안에서 지연 import하는 adapter는 놓친다.

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
- Thread/offload 상태는 현재 MVP collector 구현 범위 밖이다. `run_in_executor`나 별도
  thread 작업을 정확히 수집하기 전까지 TimeDistribution은 이를 별도 `thread` 시간으로
  단정하지 않는다.
