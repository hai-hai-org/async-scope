#!/usr/bin/env node
/**
 * README에 넣을 대시보드 화면을 다크/라이트 두 벌로 만든다. Timeline은 움직임
 * 자체가 설명이라 GIF, Analyzer는 읽는 화면이라 PNG다.
 *
 * 손으로 찍으면 대시보드가 바뀔 때마다 다시 찍어야 하고, 매번 뷰포트와
 * 데이터가 달라져 README 이미지가 서로 안 맞는다. 여기서는 뷰포트·데모
 * 트래픽·테마를 고정해 몇 번을 돌려도 같은 그림이 나오게 한다.
 *
 * 테마는 localStorage("asyncscope.theme")로만 정해지므로(App.tsx의
 * initialLightTheme) 페이지 로드 전에 JS를 주입할 수 있어야 한다 — Chrome
 * --headless --screenshot 으로는 안 되고 CDP가 필요하다.
 *
 * ponytail: 서버는 이 스크립트가 띄우지 않는다. uvicorn 라이프사이클을
 * node에서 관리할 이유가 없다 — 터미널 두 개면 끝난다. 사용법:
 *
 *   uv run uvicorn examples.demo:traced --port 8000
 *   npm --prefix dashboard run screenshots
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const run = promisify(execFile);

const BASE = process.env.ASYNCSCOPE_URL ?? "http://localhost:8000";
/**
 * 설치된 Chrome을 그대로 쓴다 — puppeteer가 브라우저를 따로 내려받게 하면
 * 스크린샷 한 번 찍자고 모든 기여자의 `npm ci`에 수백 MB가 붙는다. 목록에
 * 없는 자리에 깔려 있으면 CHROME_PATH로 알려주면 된다.
 */
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../docs/assets");

/**
 * [지연ms, method, path]. long-running을 어긋나게 띄워 Timeline에 겹치는 줄이
 * 생기게 하고, blocking으로 Analyzer가 볼 finding을 만든다.
 */
const TRAFFIC = [
  [0, "GET", "/demo/long-running"],
  [0, "GET", "/demo/non-blocking"],
  [80, "POST", "/demo/background"],
  [150, "GET", "/demo/long-running"],
  [200, "GET", "/demo/blocking"],
  [260, "GET", "/demo/unknown-await"],
  [320, "GET", "/demo/failure"],
  [380, "GET", "/demo/long-running"],
  [420, "GET", "/demo/non-blocking"],
  [520, "GET", "/demo/quick"],
];
/** GIF 길이. long-running(1s)이 뜨고 흘러가고 사라지는 한 사이클이 들어간다. */
const RECORD_MS = 4000;
/**
 * 녹화 crop 높이(CSS px). 패널 높이를 그대로 쓰면 줄 수에 따라 회차마다 달라져
 * 다크와 라이트 GIF의 크기가 안 맞는다 — 높이만 고정한다.
 */
const CROP_HEIGHT = 460;
/** 녹화 중 트래픽 파도 간격. */
const WAVE_EVERY = 1000;
/** GIF 가로 폭(px). README 본문 폭이 이 정도면 충분하고 용량도 여기서 정해진다. */
const GIF_WIDTH = 900;

const SHOTS = [
  ["timeline", "#/timeline"],
  ["analyzer", "#/analyzer"],
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
// failure는 500이 정상이고 서버가 죽는 것도 아니다 — 상태 코드를 보지 않는다.
const hit = (method, path) =>
  fetch(`${BASE}${path}`, { method }).catch(() => {});

function fireTraffic() {
  return Promise.all(
    TRAFFIC.map(async ([delay, method, path]) => {
      await sleep(delay);
      await hit(method, path);
    }),
  );
}

/**
 * 표시 구간을 2.00s로 고정한다. 초기 구간은 버퍼에 든 데이터 span에 따라
 * 자동으로 정해져(timeline.ts의 zoomIndexForSpan) 회차마다 달라지는데, 그러면
 * 다크와 라이트 스크린샷의 시간축이 서로 안 맞는다. 사다리 끝(5.00s)까지 밀고
 * 한 칸 내려오면 어디서 시작하든 같은 자리다.
 */
async function setWindowTo2s(page) {
  for (let i = 0; i < 4; i += 1) {
    await page.click("::-p-text(Wider)");
  }
  await page.click("::-p-text(Narrower)");
}

/**
 * Analyzer는 첫 finding을 자동 선택하는데 그게 long_wait이면 "Event Loop를 막은
 * 지점"이라는 이 화면의 핵심이 안 보인다. blocking 줄을 골라 아래 상세 패널까지
 * 화면에 들어오게 스크롤한다.
 */
async function showBlockingFinding(page) {
  // finding 목록은 화면을 열 때 한 번 읽는다 — 버퍼를 비운 뒤에 만든 트래픽을
  // 보려면 다시 읽어야 한다.
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector(".analyzer-table__type");
  await page.$$eval(".analyzer-table__type", (nodes) => {
    const hit = nodes.find((node) => node.textContent.trim() === "blocking");
    hit?.closest("button").click();
  });
  await page.waitForSelector(".finding-detail");
  await sleep(500);
  await page.$eval(".finding-detail", (node) => {
    // 패널 제목("문제 상세")부터 보이게 상세 패널 자체를 화면 위에 붙인다.
    node.closest(".panel").scrollIntoView({ block: "start" });
  });
  await sleep(300);
}

/**
 * Timeline 패널만 잘라 GIF로 녹화한다. 화면 전체를 담으면 움직이지 않는 지표
 * 카드와 사이드바가 용량의 대부분을 먹는다.
 *
 * webm으로 받아 ffmpeg로 GIF를 만든다 — puppeteer의 screencast가 webm만
 * 내놓고, GIF는 팔레트를 따로 뽑아야 색이 뭉개지지 않는다.
 */
async function recordTimeline(page, file) {
  const panel = await page.$(".timeline-layout > .panel");
  const { x, y, width } = await panel.boundingBox();
  const webm = join(tmpdir(), `asyncscope-${Date.now()}.webm`);

  // 첫 프레임부터 줄이 차 있도록 한 파도를 먼저 흘려보낸다. 2.00s 창은
  // 계속 흘러가서, 녹화 직전에 아무것도 없으면 빈 화면으로 시작한다.
  fireTraffic();
  await sleep(700);

  const recorder = await page.screencast({
    path: webm,
    crop: { x, y, width, height: CROP_HEIGHT },
  });
  // 트래픽이 끊기면 화면도 멈춘다 — 타임라인은 시계가 아니라 event가 들어올 때
  // 움직이기 때문이다. 녹화 내내 파도를 계속 보낸다.
  fireTraffic();
  const waves = setInterval(fireTraffic, WAVE_EVERY);
  await sleep(RECORD_MS);
  clearInterval(waves);
  await recorder.stop();

  await run("ffmpeg", [
    "-y",
    "-loglevel", "error",
    "-i", webm,
    "-vf",
    `fps=12,scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
    "-loop", "0",
    file,
  ]);
  await rm(webm, { force: true });
}

function findChrome() {
  const found = process.env.CHROME_PATH ?? CHROME_CANDIDATES.find(existsSync);
  if (!found) {
    throw new Error(
      "Chrome을 찾지 못했다. CHROME_PATH에 실행 파일 경로를 넣어 다시 실행한다.",
    );
  }
  return found;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
  });
  try {
    for (const theme of ["dark", "light"]) {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument((value) => {
        window.localStorage.setItem("asyncscope.theme", value);
      }, theme);
      // 브라우저가 알아서 가져가는 /favicon.ico도 추적 대상이라 Timeline에
      // 줄이 하나 늘어난다 — 스크린샷에서는 잡음이라 아예 막는다.
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        if (request.url().endsWith("/favicon.ico")) {
          request.abort();
        } else {
          request.continue();
        }
      });
      for (const [name, hash] of SHOTS) {
        await page.goto(`${BASE}/__asyncscope__/${hash}`, {
          waitUntil: "networkidle2",
        });
        // 앞선 회차가 남긴 finding까지 쌓이면 Analyzer 표가 같은 줄로
        // 도배되고 지표 숫자도 회차마다 달라진다.
        await hit("POST", "/__asyncscope__/api/buffer/clear");
        // 한 번은 끝까지 흘려보낸다. 상단 지표와 Analyzer finding은 이미
        // 끝난 요청에서 나오므로, 이게 없으면 카드가 전부 "—"로 찍힌다.
        await fireTraffic();
        await sleep(2500); // summary 폴링(2초)이 한 번 돌 시간
        if (name === "timeline") {
          await setWindowTo2s(page);
          const file = join(OUT, `timeline-${theme}.gif`);
          await recordTimeline(page, file);
          console.log(`wrote ${file}`);
        } else {
          await showBlockingFinding(page);
          const file = join(OUT, `analyzer-${theme}.png`);
          await page.screenshot({ path: file });
          console.log(`wrote ${file}`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
