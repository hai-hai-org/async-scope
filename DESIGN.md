# AsyncScope Design System

- 상태: 구현 계약
- 작성일: 2026-08-18
- Day12 구현 상태: CSS custom properties와 primitive showcase로 반영
- 기준 화면: [AsyncScope dashboard reference](docs/assets/asyncscope-dashboard-reference.png)
- 관련 문서: [제품·아키텍처 ADR](docs/adr/0001-asyncscope-product-and-architecture.md), [개발 계획](docs/development-plan.md), [구현 일정](docs/implementation-schedule.md)

## 0. Research Log

- Static reference: 사용자가 제공한 1536×1024 대시보드 이미지를 직접 확인하고 `docs/assets/asyncscope-dashboard-reference.png`에 보존했다. 고정 sidebar, 5개 지표 카드, 시간축 중심 Timeline, 우측 inspector, 하단 blocking 안내의 화면 문법을 채택했다.
- Image-to-code extraction: 이미지의 네이비 계열 표면, 4px 기반 간격, 상태별 색상 bar, 고정 playhead, list-detail 구조와 밀도 높은 개발자 도구 타이포그래피를 추출했다.
- UI/UX DB: `dark developer observability dashboard navy blue amber red Korean code`와 `Korean developer dashboard monospace code readable dark mode`를 조회했다. OLED dark dashboard와 Mono+Sans 조합을 확인하되, 한글 가독성과 오프라인 실행을 위해 Noto Sans KR + JetBrains Mono 계열을 선택했다.
- Interaction references: beui.dev의 `shared-layout-bg`, `switch`, `drawer`, `table` 실제 소스를 확인했다. 이동 pill, switch thumb, drawer의 focus/escape 처리, 대량 row virtualization 메커니즘만 참고한다.
- Skipped research: Lazyweb와 Imagen draft는 생략했다. 사용자가 제공한 정적 화면이 이미 구체적인 reference-fidelity 계약이므로 새로운 시각 방향을 만들지 않는다.

### Day12 implementation note

- Token source of truth는 CSS custom properties다. product screen은 임의 색상·간격을 만들지 않고 token을 재사용한다.
- UI library는 Radix Primitives를 제한적으로 쓴다. Switch와 Drawer/Dialog처럼 keyboard, focus return, Escape 처리가 중요한 primitive만 Radix에 맡기고, Button, Panel, Table, badge는 AsyncScope token으로 직접 구현한다.
- font는 현재 system fallback stack으로 동작한다. 외부 font request는 만들지 않는다. WOFF2 bundling은 실제 font asset이 확정될 때 별도 작업으로 처리한다.
- icon은 초기 단계에서 text glyph를 사용한다. 상태 의미는 color만 쓰지 않고 label, glyph, border style을 함께 사용한다.

## 1. Atmosphere & Identity

AsyncScope는 **조용하고 정확한 비동기 실행 관제실**처럼 느껴져야 한다. 정보량은 많지만 장식은 적고, 모든 색과 움직임은 실행 상태를 설명해야 한다. 대표적인 시각 요소는 어두운 네이비 시간축 위를 움직이는 파란 playhead와, Running·Waiting·Blocking·Thread·Response 상태가 이어지는 실행 bar다.

### 디자인 원칙

1. **Truth before decoration**: 실제 관찰값과 추론값을 시각적으로 구분한다.
2. **Timeline is the product**: 요약 카드와 navigation보다 실행 흐름의 읽기 쉬움을 우선한다.
3. **Dense, not cramped**: 개발자 도구에 필요한 밀도는 유지하되 4px 간격 체계와 명확한 surface 계층으로 구분한다.
4. **Explain every warning**: 경고는 원인 후보, 증거 수준, 다음 행동을 함께 제공한다.
5. **No fake telemetry**: 수집할 수 없는 DB·HTTP·Redis 원인을 확정적으로 표시하지 않는다. adapter 관찰값은 `observed`, module/source 기반 분류는 `inferred`로 표시한다.

### 주요 사용자와 성공 조건

| 사용자 | 주요 작업 | 성공 조건 |
| --- | --- | --- |
| asyncio 초보자 | 두 요청이 번갈아 실행되는 이유 이해 | 색상 없이도 suspend/resume과 blocking을 설명할 수 있음 |
| FastAPI 전환 개발자 | 느린 요청과 Event Loop blocking 조사 | 요청 → 실행 구간 → 소스 코드 → 해결 안내를 키보드로 탐색 가능 |
| 강사·기여자 | 데모를 재생하고 결과 공유 | 같은 JSON export로 동일한 Timeline을 재현 가능 |
| 저시력·색각 사용자 | 확대·고대비·보조 텍스트로 상태 확인 | 200% 확대와 색상 외 label/icon에서 정보 손실 없음 |
| motion 민감 사용자 | 실시간 화면을 불편 없이 관찰 | reduced motion에서 자동 이동이 정지되고 데이터는 계속 갱신됨 |

### 금지하는 방향

- 장식용 gradient, glow, glass blur
- 상태 의미가 없는 animation
- 색상만으로 상태 구분
- 임의의 작은 pill과 가짜 시스템 label
- 모든 영역을 중첩 card로 감싸는 구조
- 관찰값처럼 보이는 추론 또는 임의의 성능 수치

## 2. Color

### 기본 palette

| Role | Token | Light | Dark | Usage |
| --- | --- | --- | --- | --- |
| Canvas | `--surface-canvas` | `#F2F6F9` | `#04111B` | 전체 app 배경 |
| Sidebar | `--surface-sidebar` | `#FFFFFF` | `#061522` | 고정 navigation |
| Panel | `--surface-panel` | `#FFFFFF` | `#091B28` | Timeline, detail, 표 |
| Raised | `--surface-raised` | `#F8FAFC` | `#0D2231` | toolbar, popover, selected detail |
| Hover | `--surface-hover` | `#EAF1F6` | `#112C3F` | hover row와 control |
| Text primary | `--text-primary` | `#10202F` | `#F4F8FB` | 제목, 주요 값 |
| Text secondary | `--text-secondary` | `#4C6174` | `#B7C4CE` | 본문, label |
| Text tertiary | `--text-tertiary` | `#6F8190` | `#8394A1` | 보조 설명, 비활성 값 |
| Border subtle | `--border-subtle` | `#E3EAF0` | `#142B3A` | row divider |
| Border default | `--border-default` | `#CFDAE3` | `#1C3445` | panel과 control |
| Border strong | `--border-strong` | `#AEBFCC` | `#2A4A60` | 선택, 강조 경계 |
| Accent primary | `--accent-primary` | `#1B66D1` | `#2F80ED` | playhead, link, active nav |
| Accent hover | `--accent-hover` | `#1454B2` | `#5A9BFF` | accent hover |
| Focus | `--focus-ring` | `#0B57D0` | `#8BC1FF` | 2px keyboard focus ring |
| Success | `--status-success` | `#167A3B` | `#43D17A` | running service, completed |
| Warning | `--status-warning` | `#9A5A00` | `#FFB020` | inferred, caution |
| Error | `--status-error` | `#B4231B` | `#FF6259` | blocking, failure |
| Info | `--status-info` | `#1559B5` | `#63A4FF` | observed 정보 |

### Timeline state pairs

각 상태는 background와 foreground를 함께 사용한다. 단독 상태색 위에 임의의 흰색을 사용하지 않는다.

| State | Token pair | Light | Dark | Additional cue |
| --- | --- | --- | --- | --- |
| Running | `--state-running-bg/fg` | `#DDEBFF / #0B417F` | `#154E91 / #EEF5FF` | play icon 또는 `Running` label |
| Waiting | `--state-waiting-bg/fg` | `#FFF0C7 / #694000` | `#7A4B00 / #FFF4D5` | pause icon 또는 `await` label |
| Blocking | `--state-blocking-bg/fg` | `#FFE2DF / #7C211D` | `#782927 / #FFECEA` | warning icon과 `Blocking` label |
| Thread | `--state-thread-bg/fg` | `#EFE5FF / #4C2C78` | `#563A80 / #F5EDFF` | thread icon과 `Thread` label |
| Response | `--state-response-bg/fg` | `#DCF7E6 / #11572D` | `#185F36 / #EBFFF2` | arrow icon 또는 `Response` label |
| Idle | `--state-idle-bg/fg` | `#E6EBEF / #445460` | `#344553 / #D9E1E7` | dotted outline과 `Idle` label |

### Color rules

- 기본 테마는 reference와 같은 Dark다. Light는 theme toggle로 제공한다.
- accent는 선택, focus, playhead와 link에만 쓴다. 장식용으로 사용하지 않는다.
- 상태색은 label, icon 또는 pattern과 항상 함께 쓴다.
- `observed`는 info icon과 실선, `inferred`는 warning icon과 점선 border를 사용한다.
- blocking은 높은 중요도의 빨간색을 사용하지만 전체 row를 과도하게 채우지 않는다.
- 구현 전 모든 foreground/background pair를 WCAG 2.2 AA contrast로 자동 검사한다.

## 3. Typography

### Font stack

- UI primary: `"Noto Sans KR", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Code and tabular data: `"JetBrains Mono", ui-monospace, "SFMono-Regular", Consolas, monospace`
- Noto Sans KR과 JetBrains Mono는 오프라인 데모를 위해 필요한 weight만 WOFF2로 package에 포함한다. 외부 font 요청을 만들지 않는다.
- 구현: `dashboard/src/shared/styles/fonts/`에 5개 파일(약 2.2MB). Noto Sans KR은
  fontsource의 통합 `korean` subset × weight 400/500/600/700 — 한글 11,172자와
  Latin·숫자·문장부호를 모두 포함하므로 `latin` subset 파일과 `unicode-range` 분리가
  필요하지 않다. JetBrains Mono는 variable(`wght` 100–800) `latin` 1개다.
  `@font-face`는 `font-display: block`을 쓴다 — 폴백으로 먼저 그린 뒤 교체되면
  mono 열 폭과 타임라인 정렬이 눈에 띄게 튄다. 라이선스는 `THIRD_PARTY_NOTICES.md`.

### Scale

| Level | Size | Weight | Line height | Tracking | Usage |
| --- | --- | --- | --- | --- | --- |
| Display | 28px | 700 | 1.25 | -0.02em | 현재 소비처 없음 — 아래 주석 참조 |
| H1 | 20px | 700 | 1.35 | -0.01em | page title, 사이드바 wordmark |
| H2 | 16px | 600 | 1.4 | -0.005em | panel title, inspector 제목 |
| H3 | 14px | 600 | 1.45 | 0 | detail subsection |
| Body | 14px | 400 | 1.55 | 0 | 기본 UI text |
| Body small | 13px | 400 | 1.5 | 0 | metadata와 도움말 |
| Caption | 12px | 500 | 1.45 | 0.01em | 축 label, badge |
| Metric | 22px | 600 | 1.2 | -0.01em | summary value |
| Code | 13px | 400 | 1.6 | 0 | source viewer, ID, timestamp |

각 레벨은 `tokens.css`에서 `font` 단축 속성 토큰(`--text-h2` 등)으로 제공한다. 같은
크기에서 굵기만 올려야 하는 경우(버튼, 표 머리, 배지)에 쓰는 `--weight-*` 토큰이
함께 있다. `letter-spacing`은 단축 속성에 포함되지 않으므로 `--tracking-*`로 분리한다.

**개정 이력**

- H2·Metric의 weight를 `650` → `600`으로 정규화했다. `650`은 번들된 Noto Sans KR
  정적 weight(400/500/600/700)에 없는 값이고, CSS 폰트 매칭 규칙상 `700`으로
  올라가 의도보다 굵게 렌더링된다.
- Display(28px)는 현재 소비처가 없다. page hero를 제거하면서 사용처가 사라졌고,
  사이드바 wordmark에 적용하면 `28px/700`의 "AsyncScope"와 28px glyph가
  192px 사이드바의 가용 폭(패딩 제외 160px)을 넘는다. 레벨은 남겨 두되
  적용하지 않으며, 새 소비처가 생길 때 다시 판단한다.

### Typography rules

- 한글 UI는 primary font, 함수명·경로·ID·시간·수치는 mono font를 사용한다.
- 수치에는 `font-variant-numeric: tabular-nums`를 적용해 stream update 시 폭이 흔들리지 않게 한다.
- 주요 body text는 14px 미만으로 줄이지 않는다. 모바일 form control은 16px 이상이다.
- 긴 path와 함수명은 중간 ellipsis를 사용하고 focus/tooltip에서 전체 값을 제공한다.
- 한국어 조사와 영문 기술 용어 사이의 줄바꿈으로 label이 잘리지 않도록 최소 너비와 `word-break: keep-all`을 검증한다.

## 4. Spacing & Layout

### Spacing tokens

기본 단위는 4px다.

| Token | Value | Usage |
| --- | --- | --- |
| `--space-1` | 4px | icon 내부 간격 |
| `--space-2` | 8px | compact control, inline gap |
| `--space-3` | 12px | row padding, label group |
| `--space-4` | 16px | panel 내부 기본 간격 |
| `--space-5` | 20px | summary card padding |
| `--space-6` | 24px | page gutter, section 간격 |
| `--space-8` | 32px | 큰 group 분리 |
| `--space-10` | 40px | page section 분리 |

### Shape and sizing tokens

| Token | Value | Usage |
| --- | --- | --- |
| `--radius-control` | 6px | button, badge, input |
| `--radius-panel` | 8px | panel, summary card |
| `--control-sm` | 32px | compact toolbar |
| `--control-md` | 40px | 기본 desktop control |
| `--control-touch` | 44px | mobile 또는 touch target |
| `--sidebar-wide` | 192px | wide desktop sidebar |
| `--sidebar-compact` | 72px | compact desktop/tablet sidebar |
| `--detail-wide` | 388px | desktop inspector |
| `--header-height` | 60px | app header |
| `--footer-height` | 44px | version/footer |

### Wide layout: 1280px 이상

- `fixed-sidenav-shell`: `192px minmax(0, 1fr)`.
- app은 `100dvb` 높이의 `header / minmax(0, 1fr) / footer` grid다.
- sidebar, header, footer는 고정되고 main body만 수직 scroll을 소유한다.
- Timeline page는 `minmax(680px, 1fr) 388px`의 main/inspector grid다.
- summary metrics는 5열 intrinsic grid이며 최소 카드 폭은 174px이다.
- detail inspector는 viewport 안에서 sticky이며 내부가 길 때 inspector body만 명시적으로 scroll한다.

### Compact layout: 768px~1279px

- sidebar는 72px icon rail로 축소되고 focus/hover tooltip에서 label을 제공한다.
- summary metrics는 2~3열로 reflow한다.
- Timeline과 detail은 한 열이다. 선택된 detail은 우측 drawer로 열린다.
- main body가 유일한 수직 scroll owner다. drawer가 열릴 때만 background scroll을 잠근다.

### Narrow layout: 375px~767px

- sidebar 대신 4개 목적지의 고정 bottom navigation을 사용한다.
- summary metrics는 2열, 가장 중요한 Event Loop delay와 Blocking은 첫 행에 둔다.
- Timeline row는 request label과 상태 요약을 먼저 보여 주고, 상세 time plot은 접근 가능한 `reel` 안에서만 수평 pan을 허용한다. page 전체는 수평 scroll되지 않는다.
- detail은 bottom sheet가 아니라 오른쪽 drawer를 전체 폭에 가깝게 사용해 desktop과 focus 순서를 유지한다.
- inspector와 Timeline은 동시에 보이지 않으며 닫기 control과 Escape 경로를 제공한다.

### Timeline geometry

- toolbar 높이: 40px, axis 높이: 36px, request row 최소 높이: 68px.
- request label column은 wide에서 144px, compact에서 120px, narrow에서 row 위쪽 block으로 이동한다.
- plot의 최소 내부 폭은 720px이다. narrow에서는 의도적으로 timeline reel만 수평 pan한다.
- 선택 playhead는 1px 실선과 10px handle이며 keyboard focus를 받을 수 있다.
- zoom 단계: 250ms, 500ms, 1s, 2s, 5s visible window.

### Content stress

- empty request, 1000개 request, 80자 path, 긴 함수명, unbroken request ID를 검증한다.
- 200% text zoom에서 primary action과 현재 request가 사라지지 않아야 한다.
- 모든 panel은 `min-inline-size: 0`, scroll child는 `min-block-size: 0`을 가져야 한다.
- primary page에는 하나의 수직 scrollbar만 존재한다. Timeline reel과 Requests table의 수평 scroll은 해당 region의 명명된 예외다.

## 5. Components

### AppShell

- **Structure**: brand/sidebar + header/status/actions + scrollable main + footer.
- **Variants**: wide sidebar, compact icon rail, narrow bottom navigation.
- **States**: running, paused, disconnected, unsupported environment.
- **Accessibility**: skip-to-content, semantic `nav/main/footer`, 현재 route에 `aria-current="page"`.
- **Motion**: route content는 120ms opacity transition만 사용한다.
- **Layout**: `fixed-sidenav-shell` + `scroll-body-shell`; main body가 수직 scroll owner다.

### BrandMark and NavItem

- **Structure**: SVG Event Loop glyph + AsyncScope wordmark; icon + route label.
- **Variants**: expanded, icon-only, bottom-nav.
- **States**: default, hover, active, focus, disabled.
- **Accessibility**: logo text는 실제 text로 유지하며 icon은 decorative다. icon-only nav에는 visible tooltip과 accessible name을 제공한다.
- **Motion**: active background는 shared-layout 원리를 사용하되 CSS/WAAPI로 충분하면 motion dependency를 추가하지 않는다. reduced motion에서는 즉시 전환한다.

### MetricCard

- **Structure**: label, primary value, unit, optional trend/help tooltip.
- **Variants**: request rate, active requests, loop delay, blocking count, server time.
- **States**: loading skeleton, live, stale, unavailable, error.
- **Accessibility**: live 수치는 매 update마다 announce하지 않는다. 사용자가 focus하거나 refresh할 때 timestamp와 함께 읽는다.
- **Motion**: 숫자 폭은 고정하고 값 교체는 120ms opacity crossfade다.
- **Layout**: intrinsic grid item.

### Panel and TimelineToolbar

- **Structure**: title/info + actions; pause, zoom out, window label, zoom in, auto-scroll switch.
- **States**: default, hover, active, focus, disabled, paused, following, manually panned.
- **Accessibility**: 모든 icon button은 visible tooltip과 accessible name을 가진다. `-`, `+`, `0`, `Space`, `A` keyboard shortcut을 제공하되 form 입력 중에는 동작하지 않는다.
- **Motion**: switch는 thumb transform, button은 color/opacity만 사용한다.

### TimelinePlot

- **Structure**: request label column + time axis + request rows + positioned segments + playhead.
- **Variants**: live stream, paused snapshot, replay JSON, empty, overflow summary.
- **States**: loading, empty, disconnected, error, selected request, keyboard-focused segment.
- **Accessibility**: DOM 또는 SVG element로 segment를 focus 가능하게 만들고, 같은 정보를 제공하는 screen-reader-only ordered event list를 유지한다. 색상만 사용하지 않는다.
- **Motion**: 새 segment는 120ms opacity로 나타난다. playhead와 auto-scroll만 transform을 사용한다. layout width를 animation하지 않는다.
- **Layout**: desktop grid, narrow에서는 명명된 horizontal `reel`.

### TimelineSegment

- **Structure**: state icon, semantic label, duration, evidence marker.
- **Variants**: running, waiting, blocking, thread, response, idle.
- **States**: default, hover, selected, focus, truncated, inferred.
- **Accessibility**: accessible name은 `상태, 작업 분류, 지속 시간, 증거 수준`을 포함한다. 44px hit area는 transparent padding으로 확보한다.
- **Content rule**: 알려진 adapter는 `await DB`, `await HTTP`, `await Redis`, `await WebSocket`처럼 표시한다. 미지원 대상은 `await at service.py:42` 또는 `Unknown await`로 표시하며 임의로 이름 붙이지 않는다.

### RequestInspector

- **Structure**: method/path/status + request metadata + time distribution + execution flow + source viewer.
- **Variants**: sticky aside, right drawer, full-width narrow drawer.
- **States**: no selection, loading, completed, failed, cancelled, inferred data present.
- **Accessibility**: desktop aside는 선택 후 자동 focus하지 않는다. drawer는 focus trap, Escape, focus return을 제공한다.
- **Motion**: drawer는 transform/opacity로 240ms 이내에 열고 닫는다.
- **Layout**: desktop sticky aside, compact/narrow drawer.

### TimeDistribution

- **Structure**: proportional bar + running/waiting/blocking/thread/response legend and durations.
- **States**: complete, partial/live, unavailable.
- **Accessibility**: 각 구간에 text percentage를 제공하고 색상 외 pattern/icon을 사용한다.
- **Rule**: 합계가 request duration과 맞지 않으면 `unattributed` 구간을 표시해 억지로 100%를 만들지 않는다.

### ExecutionFlowTree and SourceViewer

- **Structure**: parent/child span tree + duration/evidence; 선택 source의 상대 경로와 읽기 전용 code lines.
- **States**: collapsed, expanded, selected, missing source, redacted, inferred.
- **Accessibility**: tree keyboard pattern과 line number accessible label을 제공한다. syntax color만으로 token을 구분하지 않는다.
- **Security**: project root 내부의 `.py` 파일만 읽는다. symlink 탈출, body/header/local value, 환경 변수, site-packages source 공개를 금지한다.
- **Motion**: expand/collapse는 reduced-motion에서 즉시, 기본에서는 180ms opacity/transform을 사용한다.

### BlockingAlert and Recommendation

- **Structure**: severity/icon + plain-language finding + evidence + source link + 해결 방법 목록.
- **Variants**: confirmed known blocking call, inferred loop delay, unattributed delay.
- **States**: open, acknowledged, false-positive feedback, no recommendation.
- **Accessibility**: blocking 발생 시 focus를 강제로 이동하지 않는다. 신규 finding count를 polite live region으로 알린다.
- **Content rule**: `time.sleep`, sync DB driver, CPU-bound call처럼 규칙이 검증된 경우에만 구체적 대안을 추천한다. 불확실한 경우 측정 방법을 안내한다.

### RequestsTable

- **Structure**: method, path, status, start, duration, blocked time, evidence + detail pane.
- **States**: loading, empty, sorted, filtered, selected, stale, error.
- **Accessibility**: semantic table, sortable header state, keyboard row selection, filter label을 제공한다.
- **Performance**: row가 100개를 넘을 때 virtualization을 적용한다. 전체 table 영역만 명명된 수평 scroll owner다.
- **Page size**: 선택 가능한 값은 50과 100이다. 상한을 100으로 두어 위 virtualization
  조건에 닿지 않게 한다. 200 이상을 다시 열려면 virtualization을 먼저 구현한다.
- **Sort**: 정렬은 열 헤더(`aria-sort`)로만 조작한다. 별도 select를 두지 않는다.

### AnalyzerFinding

- **Structure**: severity, finding type, affected requests, source, evidence, recommendation.
- **Variants**: blocking, long wait, hot coroutine, unknown delay.
- **States**: new, acknowledged, filtered, no findings.
- **Accessibility**: severity는 text와 icon을 함께 제공하고 filter 결과 수를 announce한다.

### SettingsForm and ThemeToggle

- **Structure**: blocking threshold, buffer size, project root display, data controls, theme.
- **States**: default, dirty, saving, saved, invalid, disabled, restart-required.
- **Accessibility**: native input을 우선하고 persistent label/help/error를 제공한다. touch target은 최소 44×44px다.
- **Motion**: switch thumb만 transform한다. theme 변경은 180ms color transition이며 reduced motion에서는 즉시 적용한다.
- **Safety**: 적용 전 경계값 validation, buffer 상한, project root 변경 시 명시적인 restart 안내를 제공한다.

### Empty, Loading, Error and Disconnected States

- **Structure**: 상태 icon, 한 문장 설명, 가능한 다음 행동 하나.
- **Rule**: skeleton은 300ms 이상 지연될 때만 보인다. 연결 끊김은 마지막 정상 수집 시각과 retry를 표시한다.
- **Accessibility**: error는 `role="alert"`, 연결 상태는 polite live region을 사용한다.

## 6. Motion & Interaction

### Timing tokens

| Token | Duration | Easing | Usage |
| --- | --- | --- | --- |
| `--motion-instant` | 0ms | none | reduced motion, data correctness change |
| `--motion-micro` | 120ms | ease-out | hover, press, number crossfade |
| `--motion-standard` | 180ms | ease-in-out | selection, expand/collapse, theme color |
| `--motion-panel` | 240ms | cubic-bezier(0.2, 0.8, 0.2, 1) | drawer enter/exit |

### Interaction contracts

- **Live stream**: collector와 buffer는 항상 진행한다. Pause는 화면 rendering과 playhead만 고정하고, toolbar에 buffered event 수를 표시한다.
- **Auto Scroll**: 기본 ON. 사용자가 drag, wheel 또는 keyboard로 과거 구간을 탐색하면 OFF로 바뀌고 상태를 announce한다. 다시 ON 하면 최신 playhead로 이동한다.
- **Zoom**: `-`/`+` button과 keyboard로 정해진 5단계만 이동한다. cursor 또는 선택 playhead를 zoom anchor로 유지한다.
- **Selection**: segment 또는 request row 선택은 inspector 내용을 바꾸며 URL query에 request ID를 반영해 deep link가 가능해야 한다.
- **Navigation**: Timeline, Requests, Analyzer, Settings는 browser history와 deep link를 지원한다.
- **Theme**: 기본 Dark, 사용자 선택은 local storage에 저장한다. 시스템 설정은 첫 방문의 초기값으로만 사용한다.
- **Real-time feedback**: blocking 발생 시 banner와 Analyzer count가 갱신되지만 modal이나 강제 focus 이동은 없다.

### Motion rules

- transform, opacity, filter만 animation한다. axis, row, segment width/height는 animation하지 않는다.
- animation은 interruptible하며 stream rendering과 input latency를 막지 않는다.
- `prefers-reduced-motion: reduce`에서는 자동 smooth scroll, drawer slide, number crossfade를 제거한다. 데이터 갱신과 상태 변화는 즉시 표시한다.
- CSS transition/WAAPI로 충분하면 motion library를 추가하지 않는다. shared-layout 또는 spring이 실제로 필요한 경우에만 bundle 비용을 기록하고 추가한다.

## 7. Depth & Surface

### Strategy: mixed tonal-shift + borders

- Canvas → Sidebar/Panel → Raised의 밝기 차이로 기본 깊이를 만든다.
- panel은 `1px solid var(--border-default)`를 사용한다.
- nested section은 새로운 card로 감싸지 않고 divider와 spacing으로 구분한다.
- shadow는 drawer와 tooltip 같은 overlay에만 사용한다.

| Token | Value | Usage |
| --- | --- | --- |
| `--shadow-overlay` | `0 16px 48px rgb(0 0 0 / 0.35)` | drawer, modal |
| `--shadow-tooltip` | `0 6px 20px rgb(0 0 0 / 0.28)` | tooltip |

구현 편차: `--shadow-overlay` 대신 용도가 더 분명한 `--shadow-drawer`를 쓰고, 표에 없는
`--shadow-panel`을 panel 기본 깊이로 추가했다. 이름만 바꾸는 변경은 이득이 없어 유지한다.
`--z-*` 5개는 표대로 `tokens.css`에 있으며 CSS에 z-index 리터럴을 두지 않는다
(`npm run check:tokens`가 막는다).
| `--z-base` | `0` | page content |
| `--z-sticky` | `20` | header, inspector |
| `--z-nav` | `30` | compact navigation |
| `--z-drawer` | `50` | drawer/backdrop |
| `--z-tooltip` | `60` | tooltip |

blur는 drawer backdrop에서 background dismissal을 설명할 때만 허용한다. panel 장식용 glassmorphism은 사용하지 않는다.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- 목표: WCAG 2.2 AA.
- normal text contrast 4.5:1 이상, large text와 UI boundary 3:1 이상.
- 모든 interactive element에 2px 이상의 visible focus ring을 제공한다.
- Timeline의 모든 정보는 keyboard와 screen reader용 event list로 접근 가능해야 한다.
- 상태, severity, 증거 수준은 색상 외에 label, icon, line style로 구분한다.
- 200% browser zoom, 375px width, keyboard-only, screen reader reading order, high contrast, reduced motion을 검증한다.
- icon-only control은 accessible name과 visible tooltip을 가진다.
- Korean/English 혼합 label, 긴 path, CJK line box가 잘리거나 겹치지 않아야 한다.
- 새로운 blocking alert가 focus를 빼앗지 않으며 count만 polite live region으로 알린다.
- recommendation은 원인과 해결 행동을 짧은 문장으로 제공하고, 추론인 경우 그 사실을 먼저 표시한다.

### Visual QA contract

- reference-fidelity 기준 화면: 1536×1024에서 sidebar, 5개 metric, Timeline, inspector, blocking banner의 위치와 계층을 비교한다.
- responsive 기준: 375px, 768px, 1280px, 1536px.
- 각 primitive의 default, hover, active, focus, disabled, loading, empty, error 상태를 product screen 전에 showcase에서 검증한다.
- 실제 stream에서 pause, zoom, auto-scroll 해제/복귀, request 선택, drawer open/close, theme 변경을 수행한다.
- reduced motion과 keyboard-only pass를 별도로 수행한다.
- 최종 UI는 `/visual-qa` reference-fidelity 검증 후 `review-work`의 접근성·사용성·보안 검토를 통과해야 한다.

### Accepted debt

새 debt는 위치, 영향받는 사용자, 심각도, 수정 방법, 담당자와 종료 조건을 이 표에 기록하고 사용자 승인을 받아야 한다.

| ID | Location | Severity | Affected users | Reason | Owner / Exit |
| --- | --- | --- | --- | --- | --- |
| DBT-1 | SourceViewer의 한국어 주석 줄 | Minor | 한국어 주석을 쓰는 프로젝트 | 번들한 JetBrains Mono는 `latin` subset이라 한글 글리프가 없다. 해당 줄만 Noto Sans KR로 폴백해 등폭이 깨지고 열이 어긋난다. 한글 등폭 폰트를 추가하면 번들이 MB 단위로 커진다. | `z` / 한글 등폭 요구가 실제로 제기되면 재검토 |
| DBT-3 | Analyzer 목록의 열 헤더 | Minor | finding을 정렬해 보려는 사용자 | `FindingsQuery`에 sort 파라미터가 없다. 현재 페이지만 클라이언트에서 정렬하면 서버 pagination과 어긋나 사용자를 오해시키므로 정렬 헤더를 제공하지 않는다. `Table` 프리미티브는 `sort` prop을 optional로 받으므로 백엔드가 지원하면 바로 켜진다. | `m` / findings API에 sort 추가 시 종료 |
| DBT-2 | 상태 배지·내비게이션·범례의 icon glyph | Minor | 전체 | icon을 text glyph(`●` `△` `▶` `→` `⚙` 등 15종)로 쓰는데 번들 폰트에 없어 OS 폰트로 폴백한다. 플랫폼마다 모양과 baseline이 달라 배지 안에서 정렬이 미세하게 어긋난다. §1의 "icon은 초기 단계에서 text glyph를 사용한다"에 따른 결과다. | `z` / icon을 SVG로 전환할 때 종료 |
