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
