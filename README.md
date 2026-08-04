
> Don't just write async.
> 
> 
> **See it. Understand it. Trust it.**
>



## Overview

**AsyncScope**는 FastAPI, asyncio 기반 애플리케이션의 **비동기 실행 흐름을 시각화**하여 개발자가 `async/await`를 직관적으로 이해할 수 있도록 돕는 오픈소스 DevTool입니다.

현재 대부분의 개발자는 FastAPI의 비동기 동작을 완전히 이해하지 못한 채 다음과 같이 코드를 작성합니다.

```python
@app.get("/users")
async def get_users():
    users = await service.get_users()
    return users
```

하지만 실제로는

- 언제 Event Loop가 다른 Request를 실행하는지
- 어떤 시점에서 Coroutine이 중단되는지
- 무엇이 Event Loop를 Block하는지
- Sync 함수가 Async 코드 안에서 어떤 영향을 주는지

를 알기 어렵습니다.

AsyncScope는 이러한 실행 과정을 **타임라인과 애니메이션으로 시각화**하여 보여줍니다.

---

# Problem

FastAPI는 배우기 쉽지만, **비동기 실행 모델은 보이지 않습니다.**

대부분의 개발자는 `async를 붙이면 빨라진다.` , `await는 그냥 기다리는 것이다.` , `sync 함수 하나쯤 호출해도 괜찮다.`정도로만 이해합니다.

실제로는

```python
await asyncio.sleep(1)
```

와

```python
time.sleep(1)
```

는 Event Loop 관점에서 완전히 다른 동작을 합니다. 하지만 현재 개발 도구는 이를 시각적으로 설명하지 못합니다.

---

# Existing Solutions

현재 존재하는 도구들은 대부분 분석용입니다.

- asyncio 공식 문서
- FastAPI 공식 문서
- py-spy
- VizTracer
- Scalene
- OpenTelemetry

이들은 `프로파일링`, `성능 분석`, `Trace 수집`에는 뛰어나지만 "왜 이런 순서로 실행되는가?"를 이해시키지는 못합니다.

---

# Goal

> AsyncScope의 목표는 “**비동기를 눈으로 이해하게 만드는 것”**
> 

성능 측정이 아니라 실행 흐름을 설명하는 것이 목적입니다.

---

# Target Users

- FastAPI 개발자
- asyncio 초보자
- Django/Spring에서 FastAPI로 넘어온 개발자
- 교육 기관
- Python 강사
- 오픈소스 학습 프로젝트
