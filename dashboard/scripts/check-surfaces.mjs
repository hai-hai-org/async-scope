#!/usr/bin/env node
/**
 * 표면 사다리가 다시 평평해지는 것을 막는 게이트다.
 *
 * P5에서 확인한 것: 카드가 배경에서 떨어져 보이지 않아 border가 유일한 구분
 * 수단이 되었고, 그래서 모든 상자에 테두리가 생겼다. border를 걷어낸 지금은
 * 표면 톤이 유일한 구조 신호이므로, 이 사다리가 좁아지면 화면 구조가 사라진다.
 *
 * 척도는 WCAG 대비비가 아니라 CIELAB L*다. 어두운 색에서 대비비는 공식의
 * `+0.05` 항에 지배되어 지각 분리를 나타내지 못한다 — P5 이전 사다리는 전
 * 구간이 1.03~1.13:1이었고 canvas→panel이 ΔL* +2.7로 보이지 않았다.
 * 참고 척도: ΔL* 2~3 거의 안 보임 / 4~6 은근 / 8~12 명확.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOKENS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/shared/styles/tokens.css",
);

// dark는 흰색 천장이 없으므로 넉넉히 벌릴 수 있다. light는 panel이 #ffffff에
// 붙어 있어 nested가 반대로 내려간다(recessed) — 부호가 아니라 크기를 본다.
const RULES = [
  { theme: "dark", from: "canvas", to: "panel", min: 5 },
  { theme: "dark", from: "panel", to: "raised", min: 4 },
  { theme: "light", from: "canvas", to: "panel", min: 5 },
  { theme: "light", from: "panel", to: "raised", min: 4 },
];

function lightness(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  // D65 상대 휘도 → CIE L*.
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/** :root와 :root[data-theme="light"] 블록에서 --surface-* 를 뽑는다. */
function surfaces(css) {
  const themes = { dark: {}, light: {} };
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const theme = selector.includes('data-theme="light"')
      ? "light"
      : selector.trim() === ":root"
        ? "dark"
        : null;
    if (!theme) {
      continue;
    }
    for (const [, name, hex] of body.matchAll(
      /--surface-([a-z]+):\s*(#[0-9a-fA-F]{6})/g,
    )) {
      themes[theme][name] = hex;
    }
  }
  // light는 dark 값을 상속하고 일부만 덮어쓸 수 있다.
  themes.light = { ...themes.dark, ...themes.light };
  return themes;
}

const themes = surfaces(readFileSync(TOKENS, "utf8"));
const failures = [];

for (const { theme, from, to, min } of RULES) {
  const a = themes[theme][from];
  const b = themes[theme][to];
  if (!a || !b) {
    failures.push(`${theme}: --surface-${!a ? from : to} 토큰을 찾지 못했다`);
    continue;
  }
  const delta = lightness(b) - lightness(a);
  const line = `${theme.padEnd(5)} ${from}→${to} ΔL* ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} (필요 |ΔL*| ≥ ${min})`;
  if (Math.abs(delta) < min) {
    failures.push(line);
  } else {
    console.log(`  ok   ${line}`);
  }
}

if (failures.length > 0) {
  console.error("\n표면 사다리가 평평하다 — border 없이 구조가 보이지 않는다:");
  for (const f of failures) {
    console.error(`  FAIL ${f}`);
  }
  console.error("\nDESIGN.md §7의 표면 사다리 규정을 확인하라.");
  process.exit(1);
}
