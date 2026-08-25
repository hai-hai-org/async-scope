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

### `source`

`{"file": ..., "function": ..., "line": ...}` 또는 `null`이다. Timeline segment에서
Execution Flow의 span으로, 다시 SourceViewer로 이어지는 링크가 이 필드 하나로 만들어진다.
`GET /__asyncscope__/api/source?file=&line=`에 그대로 넘기면 된다.

**`line`은 `def` 줄이 아닐 수 있다.** `code.co_firstlineno`를 그대로 쓰는데, CPython은
decorator가 붙은 함수의 `co_firstlineno`를 **첫 decorator 줄**로 준다.

```python
58  @app.get("/demo/blocking")      # ← source.line
59  async def blocking():
60      time.sleep(0.3)
```

런타임이 주는 값을 바꾸지 않는다 — 바꾸면 collector가 CPython과 다른 말을 하게 된다.
**SourceViewer가 `line`만 하이라이트하면 사용자는 decorator를 보게 된다.** `def` 줄을
강조하려면 snippet 안에서 찾는다. `read_snippet`의 기본 `radius=5`면 decorator가 여러 개
붙어도 들어오고, 모자라면 `radius`를 키워 다시 부르면 된다.

`file`은 언제나 project root 상대 경로다. 절대 경로는 어떤 응답에도 나가지 않는다.

`source`가 `null`인 이벤트가 있다. 링크할 대상이 없으므로 소비자는 `missing source`
상태로 그린다.

| `source: null`인 경우 | 이유 |
| --- | --- |
| `request.*`, `response.*`, `loop.blocked` | 특정 프레임의 이벤트가 아니다 |
| project root 밖 프레임 | framework·driver·표준 라이브러리는 수집하지 않는다 |

`ui-stress.json`의 `req-disconnected`가 `source: null`인 `coroutine.suspend` 사례다.

## Transport buffer metadata

`EventBuffer`는 bounded ring buffer다. 저장 시 `sequence`를 단조 증가 값으로 붙이고,
최대 크기를 넘으면 가장 오래된 이벤트를 버린다. SSE/replay 소비자는 다음 값을 함께
사용해야 한다.

| Value | Meaning |
| --- | --- |
| `first_sequence` | 현재 buffer에 남아 있는 가장 오래된 이벤트 sequence |
| `last_sequence` | 현재 buffer에 남아 있는 가장 최신 이벤트 sequence |
| `dropped_count` | overflow로 buffer에서 밀려난 이벤트 수 |
| `source` | 남아 있는 이벤트의 출처. `live` \| `replay` \| `mixed` |
| `cursor_was_dropped(cursor)` | client cursor로 이어서 받을 수 없는 상태인지 여부 |

`source`는 **남아 있는 이벤트**로 판정한다. bool 하나로는 안 된다 — replay된 이벤트가 ring
buffer에서 전부 밀려나면 buffer는 다시 `live`다.

| 값 | 뜻 |
| --- | --- |
| `live` | 전부 이 프로세스가 수집한 것 |
| `replay` | 전부 업로드된 capture |
| `mixed` | replay 뒤에도 tracing이 돌아 남의 capture 위에 새 이벤트가 얹혔다 |

`mixed`는 `DESIGN.md` TimelinePlot variants에 없는 상태다. `POST /replay`가 tracing을
멈추지 않으므로 지금 구현이 실제로 만들어 낸다. 소비자는 이 상태를 신뢰할 수 있는 데이터로
취급하지 않는 게 안전하다.

**상한을 넘으면 request가 목록에서 통째로 사라진다.** `request.start`가 밀려난 request는
`group_by_request`가 묶어도 summary를 만들 수 없어(시작 시각·method·path를 모른다) query
결과에서 빠진다. 즉 `GET /api/requests`의 `total`이 실제 처리한 요청 수보다 작아질 수 있다.
버그가 아니라 ring buffer의 결과다. 대량 요청을 화면에 띄우려면 `AsyncScope(app,
buffer_size=...)`를 요청 수 x 요청당 이벤트 수보다 크게 잡는다. 기본값은 1000이다.

## JSON export/replay API

Timeline replay와 수동 검증이 소비한다. export/replay도 같은 `EventBuffer`를 사용하며,
내부 API 요청 자체는 target app tracing event로 남기지 않는다.

| Endpoint | Meaning |
| --- | --- |
| `GET /__asyncscope__/api/export` | 현재 buffer snapshot을 JSON으로 반환 |
| `POST /__asyncscope__/api/replay` | export/fixture JSON의 `events`를 현재 buffer로 교체 |

export payload:

```json
{
  "schema_version": "m0.normalized.v1",
  "exported_at": "2026-08-25T00:00:00+00:00",
  "buffer": {
    "events": 2,
    "max_events": 1000,
    "dropped_count": 0,
    "first_sequence": 1,
    "last_sequence": 2,
    "source": "live"
  },
  "events": ["...normalized event with storage-owned sequence..."]
}
```

`POST /replay`는 같은 `schema_version`과 `events` list를 받는다. 입력 event의 `sequence`는
외부 값이라 신뢰하지 않고 제거한다. buffer를 교체한 뒤 `EventBuffer`가 새 sequence를
1부터 다시 부여한다. 잘못된 JSON, object가 아닌 payload, schema mismatch, list가 아닌
`events`, object가 아닌 event는 `400 bad_request`다.

**replay는 live buffer를 덮는다.** 따라오는 결과를 소비자가 알아야 한다.

- `buffer.source`가 `replay`가 된다. tracing은 멈추지 않으므로 그 뒤 첫 live 이벤트에서
  `mixed`로 넘어간다
- `status`는 여전히 `running`이다. collector 상태와 데이터 출처는 다른 축이다 — tracing이
  돌면서 replay 데이터를 갖는 상태가 실제로 존재하므로 하나의 값으로 둘을 말할 수 없다
- `sequence`가 1부터 다시 시작하므로 **연결돼 있던 SSE client의 cursor가 새 sequence보다
  커진다.** `cursor_was_dropped()`가 이 경우를 잡아 gap frame을 보내므로 client는 stream이
  끊긴 것을 알 수 있다. cursor 없이 다시 연결하면 새 buffer를 처음부터 받는다

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

cursor로 이어서 받을 수 없으면 일반 event 대신 gap frame을 보낸다.

```text
event: asyncscope.gap
data: {"error":"event_gap","cursor":0,"first_sequence":2,"last_sequence":10,"dropped_count":1}
```

gap 조건은 둘이다.

| 조건 | 언제 |
| --- | --- |
| `cursor < first_sequence - 1` | cursor 이후 필요한 event가 buffer 상한을 넘어 밀려났다 |
| `cursor > last_sequence` | `POST /replay`가 buffer를 교체하며 sequence를 1부터 다시 부여했다 |

두 번째는 건강한 live stream에서 일어날 수 없다 — cursor는 서버가 보낸 id에서 오고 sequence는
단조 증가하므로 항상 `cursor <= last_sequence`다. 그 부등식이 깨졌다는 것 자체가 buffer가
교체됐다는 신호다. buffer가 비어 있는데(`clear()` 직후, 재시작 후) cursor가 있는 경우도 같다.

**client가 할 일은 두 경우 모두 같다: cursor 없이 재연결한다.** 그래서 payload에 원인을
구분하는 필드를 두지 않았다. 문구를 다르게 하려면 `dropped_count`와 `cursor`/`last_sequence`
관계로 구분할 수 있다.

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
| AppShell MetricCard | `GET /__asyncscope__/api/summary` |
| Settings panel | `GET/PATCH /__asyncscope__/api/settings` |
| Replay mode | `GET /__asyncscope__/api/export`, `POST /__asyncscope__/api/replay` |
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
`recommendation`, `feedback`을 가진다.

| `type` | 파생 소스 | `finding_id` | severity |
| --- | --- | --- | --- |
| `blocking` | `loop.blocked` 하나 | `blocking-<timestamp_ns>` | 지연이 threshold의 10배 이상 high, 3배 이상 medium |
| `long_wait` | 한 span의 `wait_ns` | `long-wait-<request_id>` | 비중 50% 이상 high, 30% 이상 medium |
| `unattributed` | 설명되지 않은 request 구간 | `unattributed-<request_id>` | 비중 50% 이상 high, 30% 이상 medium |

`unattributed`는 설명 못 한 시간이 10ms 이상이고 비중이 20% 이상일 때만 올린다. 짧은
request의 측정 오차가 매번 finding이 되면 목록이 쓸모없어진다.

`long_wait`은 한 span의 `wait_ns`가 **1초 이상이고 request 구간의 절반 이상**일 때 올린다.
`loop.blocked`가 없어도 느린 request가 있다 — 상대 서비스가 늦으면 loop은 멀쩡하고 request만
오래 걸린다. 부모 span의 `wait_ns`는 자식 대기를 포함하지 않으므로(suspend→resume 짝만 센다)
최댓값이 실제로 기다린 지점이다.

`DESIGN.md` AnalyzerFinding variants의 `hot coroutine`은 만들지 않았다. "CPU를 많이 쓰는
coroutine"을 지금 수집으로 구분할 신호가 없다. CPU sampling 없이 만들면 추측이다.

### `suspect.certainty`

| 값 | 어느 finding | 뜻 |
| --- | --- | --- |
| `candidate` | `blocking` | heartbeat sampling이다. 침묵 구간 직전 프레임을 후보로 제시할 뿐이다 |
| `observed` | `long_wait` | suspend/resume을 실제로 봤다. 그 프레임이 거기서 기다린 것이 사실이다 |

**이 구분이 "낮은 신뢰도는 추론임을 먼저 표시한다"의 근거다.** `evidence`도 같이 갈린다 —
`blocking`은 `inferred`(confidence 0.6), `long_wait`은 `observed`(confidence `null`)다.
UI는 `candidate`를 단정하는 문구로 쓰지 않는다.

### `feedback`

```json
"feedback": { "acknowledged": false, "false_positive": false }
```

사용자가 남긴 표시다. `analysis`는 이 값을 모르고 `web/routes.py`가 응답에 얹는다 —
분석 계층은 event만 읽는다.

**서버는 표시된 finding을 목록에서 걸러내지 않는다.** 무엇을 숨길지는 UI 결정이다
(`DESIGN.md` AnalyzerFinding States의 `filtered`). 오탐 표시를 서버가 곧 숨김으로 해석하면
사용자가 그 결정을 되돌릴 방법이 없어진다.

### Feedback API

| Endpoint | Meaning |
| --- | --- |
| `POST /__asyncscope__/api/findings/{finding_id}/feedback` | finding 하나에 표시를 남긴다 |

body는 `{"kind": "acknowledged"}` 또는 `{"kind": "false_positive"}`다. 같은 finding에 둘 다
표시할 수 있다 — 인지했고 오탐이다. 성공하면 표시가 얹힌 finding을 돌려준다.

없는 `finding_id`는 `404`, 알 수 없는 `kind`나 object가 아닌 body는 `400`, `POST`가 아닌
method는 `405`다.

**process-local이고 재시작하면 사라진다.** `GET /api/settings`의 `feedback` count가 같은
상태를 본다. buffer에서 밀려난 finding id는 집합에 남지만 메모리에만 있어 지금은 문제되지
않는다.

### false-positive와 no-recommendation 사례

`ui-stress.json`이 둘 다 담고 있다. UI가 그 상태를 그려 볼 수 있다.

- **false-positive**: 그 fixture의 `loop.blocked`가 겹치는 request 5개를
  `affected_requests`로 잡는다. 최대 하나만 원인이고 나머지는 부수 피해다.
  `suspect.certainty: "candidate"`가 정확히 그 뜻이다
- **no-recommendation**: 같은 finding의 `suspect.source`가 저장소에 없는 파일을 가리키므로
  소스를 읽을 수 없고 `recommendation.kind`가 `measure`로 떨어진다

`suspect`는 침묵 구간 **시작 직전**에 마지막으로 실행된 프로젝트 프레임이며 항상
`certainty: "candidate"`다. heartbeat가 깨어난 시점의 마지막 coroutine을 쓰면 지연이 끝난
뒤 처리된 다른 request를 지목하게 된다.

### recommendation

`recommendation`은 `null`이 되지 않는다. 모양도 하나뿐이라 소비자가 `kind`별로 다른
구조를 다루지 않는다.

```json
{
  "kind": "known_blocking_call",
  "certainty": "candidate",
  "steps": [
    {
      "text": "time.sleep() — event loop를 막는 동기 호출이다. await asyncio.sleep()으로 바꾼다.",
      "source": { "file": "examples/demo.py", "line": 60 }
    }
  ]
}
```

| `kind` | 언제 | `certainty` | `steps[].source` |
| --- | --- | --- | --- |
| `known_blocking_call` | suspect 함수 안에서 `KNOWN_BLOCKING`에 정확히 일치하는 호출을 찾았다 | `candidate` | 호출 줄 |
| `measure` | 지목하지 못했다 | `unknown` | `null` |

- `known_blocking_call`은 suspect 함수의 소스를 `ast`로 읽어 찾는다. 이름이 정확히
  일치하는 호출만 인정한다. `conn.execute()`처럼 소스에서 대상을 알 수 없는 호출은
  지목하지 않는다.
- 중첩 함수와 lambda 안의 호출은 세지 않는다. 다른 프레임이다.
- `measure`의 `steps`는 해결책이 아니라 **다음 측정 방법**이다. 확정할 수 없는 finding에
  해결책을 단정하지 않는다.
- `unattributed` finding은 항상 `measure`이며 전용 단계를 받는다.

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

## Summary metrics API

AppShell의 MetricCard 다섯 장이 소비한다. 별도 counter를 두지 않고 같은 event buffer에서
파생한다.

| Endpoint | Meaning |
| --- | --- |
| `GET /__asyncscope__/api/summary` | request rate, active requests, loop delay, blocking count, server time |

`window`는 초 단위이고 기본 60, 최대 3600이다. 잘못된 값은 `400 bad_request`다.

```json
{
  "server_time": "2026-08-25T05:31:02.160451+00:00",
  "status": "running",
  "status_reason": null,
  "window_ns": 60000000000,
  "measured_window_ns": 405468125,
  "request_rate_per_second": 4.933,
  "active_requests": 0,
  "loop_delay": {
    "average_ns": 301426375,
    "max_ns": 301426375,
    "samples": 1,
    "threshold_ns": 50000000
  },
  "blocking_count": 1,
  "buffer": {
    "events": 11,
    "max_events": 1000,
    "dropped_count": 0,
    "first_sequence": 1,
    "last_sequence": 11,
    "source": "live"
  }
}
```

- `server_time`은 벽시계(UTC ISO 8601)다. 이벤트의 `timestamp_ns`는 `perf_counter_ns`라
  벽시계가 아니다. 둘을 섞어 계산하지 않는다.
- `measured_window_ns`는 ring buffer가 실제로 덮은 구간이다. rate는 `window_ns`가 아니라
  이 값으로 나눈다. 버퍼가 60초를 못 덮는데 60으로 나누면 rate가 실제보다 낮게 나온다.
- 잴 구간이 없으면 `request_rate_per_second`는 `0`이 아니라 `null`이다. 요청이 없던 것과
  잴 수 없는 것은 다르다. window 안에 요청이 없었을 뿐이면 `0.0`이다.
- `active_requests`는 window로 자르지 않는다. window 전에 시작해 아직 도는 request가
  빠지면 안 된다.
- `buffer` 블록은 export payload와 같은 함수가 만든다. 필드 이름은 SSE
  `asyncscope.gap` payload와도 같다.
- **`buffer.source`가 `live`가 아니면 window anchor가 바뀐다.** `timestamp_ns`는
  `perf_counter_ns`로 프로세스 상대값이라, replay된 이벤트를 지금 perf_counter와 비교할 수
  없다. 그대로 재면 window가 벌어져 capture 전체가 밖으로 밀려나고 `blocking_count: 0`,
  `request_rate_per_second: 0.0`이 된다 — capture의 존재 이유가 그 둘일 때도 그렇다.
  그래서 replay된 buffer는 **가장 최근 이벤트 시각**을 anchor로 쓴다. `measured_window_ns`가
  capture의 구간을 뜻하게 되고 rate·loop delay·blocking count가 capture를 설명한다.
- `server_time`은 **응답을 만든 시각**이지 데이터의 시각이 아니다. replay 중에도 실제
  벽시계다. `measured_window_ns`와 섞어 계산하지 않는다.
- `loop_delay`와 finding의 blocking 구간 길이는 이벤트의 `delay_ns`와 정확히 같다.
  `gap_start_ns`는 `emit()`이 `timestamp_ns`를 찍기 직전에 읽은 값이라, `timestamp_ns`까지를
  구간 끝으로 쓰면 emit 자신의 몇 µs가 loop 지연에 섞인다.

### AppShell 상태

`DESIGN.md` AppShell States는 `running`, `paused`, `disconnected`, `unsupported` 넷인데
서버가 아는 건 둘뿐이다.

| 상태 | 누가 판정하나 | 근거 |
| --- | --- | --- |
| `running` | **서버** (`status`) | `install()`이 끝나 수집 중이다 |
| `off` | **서버** (`status`) | AsyncScope는 붙었지만 `install()`이 안 됐다 |
| `unsupported` | **서버** (`status` + `status_reason`) | CPython이 아니거나 3.12 미만이다 |
| `paused` | **client** | pause는 수집이 아니라 렌더링을 멈춘다. TimelineToolbar의 "buffered count"가 그 증거다 — 멈춘 동안에도 이벤트는 계속 쌓인다 |
| `disconnected` | **client** | 자기 SSE 연결 상태다. 서버는 client가 끊긴 걸 알 수 없다 |

`stale`도 서버가 판정하지 않는다. 응답은 항상 방금 계산한 값이고, poll 실패나 SSE 끊김은
client만 안다. `status_reason`은 `unsupported`일 때만 문자열이고 나머지는 `null`이다.

`off`는 DESIGN의 네 상태에 없다. UI는 `unsupported`와 같은 자리에 다른 문구로 그리면 된다 —
"이 런타임에서는 동작하지 않는다"와 "아직 켜지 않았다"는 사용자가 할 일이 다르다.

client 상태를 그리는 데 필요한 입력은 이미 나가고 있다. pause 중 buffered count는
`buffer.last_sequence`와 SSE event id의 차이로 구한다.

## Settings API

Settings 패널이 소비한다. 지금 단계의 설정은 모두 process-local runtime 상태다. 파일이나
사용자 설정 저장소에 persist하지 않는다.

| Endpoint | Meaning |
| --- | --- |
| `GET /__asyncscope__/api/settings` | 현재 runtime 설정, 적용 대기 설정, validation limit |
| `PATCH /__asyncscope__/api/settings` | 설정 일부 변경 |

```json
{
  "tracing": true,
  "persisted": false,
  "settings": {
    "threshold_s": 0.05,
    "interval_s": 0.01,
    "buffer_size": 1000,
    "project_root": "/project/root"
  },
  "pending_restart": {
    "buffer_size": 2000
  },
  "limits": {
    "threshold_s": { "min": 0.001, "max": 10.0 },
    "interval_s": { "min": 0.001, "max": 10.0 },
    "buffer_size": { "min": 1, "max": 100000 },
    "project_root": { "must_exist": true, "must_be_directory": true }
  },
  "feedback": {
    "acknowledged": 0,
    "false_positive": 0
  }
}
```

- `threshold_s`, `interval_s`는 live 설정이다. `PATCH` 즉시 heartbeat를 재시작해서 새
  값을 적용한다.
- `buffer_size`, `project_root`는 restart-required 설정이다. 실행 중인 buffer와 collector
  범위는 바꾸지 않고 `pending_restart`에만 저장한다. 현재 값과 같은 값으로 다시 보내면
  pending에서 제거한다.
- `persisted: false`는 이번 단계에서 의도된 상태다. 디스크 저장과 사용자별 profile은
  별도 이슈에서 다룬다.
- **pending `project_root`는 live source sandbox를 넓히지 않는다.** `GET /api/source`의
  경계는 실행 중인 `project_root`이고 `PATCH`로 바꿀 수 없다. 재시작해야 적용되며 재시작은
  실행하는 사람의 설정이다. 테스트가 이 무해함을 고정한다.
- **그건 `persisted: false`인 동안만 그렇다.** 설정을 디스크에 저장하게 되면 pending
  `project_root`가 곧 다음 실행의 sandbox가 된다. 지금 validation은 존재하는 디렉터리인지만
  보므로 `/`도 통과한다 — persist를 붙일 때 "너무 넓은 경로" 상한을 같이 정해야 한다.
- **`limits`가 form validation의 유일한 출처다.** 서버가 실제로 거부하는 경계와 같은 값이며
  테스트가 둘을 대조한다. UI는 `limits`만 보고 form을 만들면 된다.
- `feedback`은 현재 in-memory 요약 count만 제공한다. finding acknowledge/false-positive
  쓰기 API는 아직 없다.
- 알 수 없는 필드, 잘못된 타입, 범위를 벗어난 값, 존재하지 않는 `project_root`는
  `400 bad_request`다. `settings`는 `GET`과 `PATCH`만 허용한다.

## Accuracy boundary

- `observed` means the event came from `sys.monitoring`, ASGI lifecycle, or an
  explicit collector signal.
- `inferred` means the system is explaining a derived condition such as loop
  delay. It must not be styled or worded as directly observed fact.
- Unsupported awaits use `category: "await"` and `label: "unknown await"`.
  They must not be labeled DB, HTTP, Redis, or WebSocket without adapter
  evidence.
- `recommendation.kind: "known_blocking_call"`은 **정적 분석** 결과다. 그 호출이 이번
  지연 때 실제로 실행됐다는 증거가 아니므로 `certainty`는 `candidate`다. 실행 경로를
  관측해 `observed`로 올리려면 새 event type이 필요하고, 그건 m/z가 함께 정한다.
- `loop_delay.average_ns`는 threshold를 **넘어 검출된** 지연의 평균이다. heartbeat는
  threshold 이하 sample을 이벤트로 남기지 않으므로 전체 평균은 계산할 수 없다. 소비자가
  무엇의 평균인지 알 수 있도록 `samples`와 `threshold_ns`를 함께 반환한다.
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
| Supported adapter labels | `adapter-awaits.json` | verified (stubbed entry point) |
| Client disconnect | `disconnect.json` | verified (pure ASGI) |

`demo + fixture`는 demo route를 돌린 실제 수집이 fixture 값을 낸다는 뜻이다.
`tests/e2e/test_demo.py`가 demo route 9개를 한 번에 돌려 수집 결과 전체에 fixture와 같은
검사(`assert_normalized`)를 건다.

마지막 두 줄은 실제 상대 서버 없이 수집 경로만 통과시켜 검증했다.

- **adapter**: `awaits.install()`은 `vars(owner)`에 있는 메서드를 감싸므로, 진입점에 async
  stub을 꽂으면 wrapper가 그 stub을 감싼다. 프로젝트 coroutine에서 호출하면 collector가
  실제로 `library`, `label`, `evidence: "observed"`를 붙인 `coroutine.suspend`를 낸다
  (`tests/unit/test_classifiers.py`). 가짜인 건 DB·Redis·WebSocket 서버뿐이다.
  **실제 서버를 상대로 한 통합 검증은 아직 없다.**
- **disconnect**: 아래 "알려진 경계"대로 uvicorn HTTP에서는 재현되지 않는다. `RequestTracker`가
  순수 ASGI이므로 `http.response.start`를 보내지 않고 끝나는 app을 직접 호출해
  `status: "disconnected"`를 end-to-end로 확인한다 (`tests/test_install.py`).

M1 must still implement adapter classifiers and API/query behavior against this
contract.

## UI fixture

M0 시나리오 fixture와 목적이 다르다. 수집 사실이 아니라 **화면이 깨지는 극단값**을 담는다.
`dashboard`가 backend 없이 loading/empty/error/stress 상태를 그릴 때 쓴다.

### `contracts/ui/*.json`

Day11에서 M1 UI 상태 fixture를 동결한다. 각 fixture는 `schema_version:
"m1.ui-state.v1"`와 `summary`, `requests`, `findings`, `settings`, `events` 섹션을
가진다. 각 섹션은 `state`, `data`, `error`를 가진다.

| Fixture | Meaning |
| --- | --- |
| `loading.json` | 아직 API/SSE 응답을 받기 전 |
| `empty.json` | API는 성공했지만 event buffer와 파생 목록이 비어 있음 |
| `error.json` | API 실패 또는 SSE gap처럼 사용자가 복구 행동을 해야 하는 상태 |

`empty.json`의 `summary`, `requests`, `findings`, `settings`는 실제 API의 빈 응답 shape에
맞춘다. `error.json`은 section별 `{ "code", "message" }` error를 고정한다.

### `ui-stress.json`

| 담긴 것 | 무엇을 시험하나 |
| --- | --- |
| 200자 넘는 path, 40자 넘는 label·함수명 | Table cell truncation, tooltip, 가로 scroll |
| 3시간 넘는 request duration | time axis 스케일, 숫자 폭 |
| 6단계 span 중첩 | ExecutionFlowTree 들여쓰기 |
| 같은 구간에 겹치는 request 5개 + `loop.blocked` | Timeline row 밀도, blocking marker |
| `label: "unknown await"` / `library: null` | unknown 상태 |
| `source: null`인 coroutine 이벤트 | SourceViewer의 missing source |
| `coroutine.start` 없이 `coroutine.end`만 있는 span | truncated span, stream 밖 parent |
| `completed`·`failed`·`cancelled`·`disconnected` request | status별 표시 |
| `request.end`가 없는 request | partial/live 상태 |

극단값이 실제로 극단인지 `tests/test_contract_fixtures.py`가 하한으로 고정한다. 값을
줄이면 테스트가 먼저 막는다.

### `timeline.json`의 `expected` 블록

같은 입력에 대한 **기대 출력**이다. UI가 좌표 계산을 대조한다.

```json
"expected": {
  "req-1": {
    "duration_ns": 57000000,
    "measured_ns": 57000000,
    "buckets": { "running": 4000000, "waiting": 51000000, "blocking": 0,
                 "response": 500000, "unattributed": 1500000 },
    "spans": [
      { "span_id": "span-req-1-handler", "parent_span_id": null,
        "offset_ns": 1000000, "duration_ns": 55000000, "wait_ns": 0,
        "children": ["...같은 모양..."] }
    ]
  }
}
```

`offset_ns`는 **request 시작 기준 상대 좌표**다. 이벤트의 `timestamp_ns`는
`perf_counter_ns`라 절대 시각이 아니고 축에 그대로 쓸 수 없다.

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

| `library` | 최소 version | 관측 지점 | `label` |
| --- | --- | --- | --- |
| `asyncpg` | 0.30 | `Connection.fetch` | `await asyncpg fetch` |
| `httpx` | 0.27 | `AsyncClient.request` | `await HTTPX request` |
| `redis.asyncio` | 5.0 | `Redis.execute_command` | `await Redis command` |
| `websockets` | 13.0 | `Connection.recv` (asyncio/legacy 양쪽) | `await WebSocket receive` |

**하한만 있고 상한은 없다.** "이 version 이상에서 진입점 이름을 확인했다"는 뜻이다. 상한을
적으면 새 version이 나올 때마다 거짓이 된다.

하한 미만이 설치되면 진입점 이름이 다를 수 있고, 그때 **label이 조용히 안 붙는다** —
`unknown await` / `library: null`로 남을 뿐 오탐을 내지는 않는다. 그래서 runtime에서
version을 검사하지 않는다. 남의 앱 시작 비용과 로그를 늘리지 않는 쪽을 택했다. 값은
`classifiers/awaits.py`의 `SUPPORTED_VERSIONS`에 있고 `pyproject.toml`의 dev 의존성 하한과
같으며, `tests/unit/test_classifiers.py`가 설치본이 하한 이상인지와 adapter마다 version이
선언됐는지를 검사한다.

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
  `status_code`가 `None`이 되는 경로가 실제 서버에서는 나오지 않는다. `RequestTracker`는
  순수 ASGI라 응답을 시작하지 않고 끝나는 app에서는 `disconnected`가 실제로 나오며, 그
  경로를 end-to-end 테스트로 고정해 뒀다. 소비자는 이 상태를 그려야 하지만 uvicorn HTTP
  배포에서는 거의 보지 못한다.
- `task.*` 이벤트는 프로젝트 코드 coroutine으로 만든 Task만 낸다. uvicorn 내부 Task와
  asyncscope 자신의 heartbeat는 이벤트를 만들지 않지만 `task_id`는 받으므로, 소비자는
  스트림에 없는 `parent_task_id`를 만날 수 있다. request 연결은 `request_id`로 한다.
- 실패한 Task의 판정에 `Task.exception()`을 쓴다. 그래서 asyncscope가 붙어 있으면 asyncio의
  "Task exception was never retrieved" 경고가 사라진다. 실패 사실은 `task.end status: "failed"`로
  대신 보인다.
- Thread/offload 상태는 현재 MVP collector 구현 범위 밖이다. `run_in_executor`나 별도
  thread 작업을 정확히 수집하기 전까지 TimeDistribution은 이를 별도 `thread` 시간으로
  단정하지 않는다.
