# Third-Party Notices

AsyncScope는 MIT License로 배포된다 ([LICENSE](LICENSE)). 아래 자산은 별도 라이선스를
따르며, 배포물(sdist·wheel·저장소)에 그대로 포함된다.

## 번들된 폰트

대시보드는 외부 폰트 요청을 만들지 않는다. 필요한 weight의 WOFF2 파일만 저장소에
담아 오프라인에서도 같은 타이포그래피로 렌더링한다 (`DESIGN.md` §3).

위치: `dashboard/src/shared/styles/fonts/`
라이선스 전문: `dashboard/src/shared/styles/fonts/OFL.txt`

### Noto Sans KR

- 용도: UI 본문과 한국어 텍스트
- 포함 파일: `noto-sans-kr-korean-{400,500,600,700}-normal.woff2` (통합 `korean` subset)
- 버전: 2.004
- 저작권: `(c) 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.`
- 라이선스: SIL Open Font License 1.1 — <https://scripts.sil.org/OFL>
- 출처: [`@fontsource/noto-sans-kr@5.3.0`](https://www.npmjs.com/package/@fontsource/noto-sans-kr)

### JetBrains Mono

- 용도: 숫자, 경로, 식별자, 소스 코드 (등폭·`tabular-nums`)
- 포함 파일: `jetbrains-mono-latin-wght-normal.woff2` (variable, `wght` 100–800)
- 버전: 2.211
- 저작권: `Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)`
- 라이선스: SIL Open Font License 1.1 — <https://scripts.sil.org/OFL>
- 출처: [`@fontsource-variable/jetbrains-mono@5.3.0`](https://www.npmjs.com/package/@fontsource-variable/jetbrains-mono)

두 폰트 모두 원본을 수정하지 않고 subset된 배포본을 그대로 사용한다. OFL의 Reserved
Font Name 조항에 해당하는 이름(`Source`)은 사용하지 않는다.

## 런타임 의존성

`asyncscope` 패키지 자체는 런타임 의존성이 없다 (`pyproject.toml`의 `dependencies = []`).
대시보드 프론트엔드의 빌드 의존성은 `dashboard/package.json`에 있으며 배포물에는
빌드 결과물만 포함된다.

## SBOM (직접 의존성)

2026년 오픈소스 개발자대회 결과보고서 붙임1과 같은 내용이다. 전체 목록은
`pyproject.toml`(Python)과 `dashboard/package.json`(프론트엔드)에 있다.

| 라이브러리 | 버전 | 라이선스 | 저장소 | 용도 / 결합 방식 |
|---|---|---|---|---|
| React · React DOM | 19.2.8 | MIT | github.com/facebook/react | 대시보드 UI 렌더링 / 라이브러리로 불러 쓰고 빌드 산출물을 wheel에 포함 |
| Noto Sans KR | 2.004 | OFL-1.1 | github.com/notofonts/noto-cjk | 한글 본문 서체 / WOFF2를 복사해 wheel에 포함(재배포) |
| JetBrains Mono | 2.211 | OFL-1.1 | github.com/JetBrains/JetBrainsMono | 고정폭 서체 / WOFF2를 복사해 wheel에 포함(재배포) |
| @radix-ui/react-* 외 2개 | 1.2.11~1.3.7 | MIT | github.com/radix-ui/primitives | 접근성 준수 스위치·툴팁·숨김 텍스트 / 라이브러리로 불러 씀 |
| Vite | 7.3.6 | MIT | github.com/vitejs/vite | 대시보드 번들 빌드 / 빌드 도구로 실행 |
| TypeScript | 5.9.3 | Apache-2.0 | github.com/microsoft/TypeScript | 정적 타입 검사 / 빌드 도구로 실행 |
| Hatchling | 1.32.0 | MIT | github.com/pypa/hatch | wheel 빌드 백엔드 / 빌드 도구로 실행 |
| FastAPI | 0.141.1 | MIT | github.com/fastapi/fastapi | 데모 앱 구성 / 라이브러리로 불러 씀 (데모·테스트 전용) |
| Uvicorn | 0.52.3 | BSD-3-Clause | github.com/encode/uvicorn | 데모 앱 구동 ASGI 서버 / 실행 파일 호출 |
| pytest | 9.1.1 | MIT | github.com/pytest-dev/pytest | 백엔드 테스트 실행 / 실행 파일 호출 |

GPL·AGPL·LGPL 계열 의존성은 없다.
