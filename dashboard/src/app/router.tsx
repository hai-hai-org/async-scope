export type RouteKey = "timeline" | "requests" | "analyzer" | "settings";

export type NavItem = {
  key: RouteKey;
  label: string;
  icon: string;
  href: string;
};

export const DEFAULT_ROUTE: RouteKey = "timeline";

export const navItems: NavItem[] = [
  { key: "timeline", label: "Timeline", icon: "↔", href: "#/timeline" },
  { key: "requests", label: "Requests", icon: "≡", href: "#/requests" },
  { key: "analyzer", label: "Analyzer", icon: "!", href: "#/analyzer" },
  { key: "settings", label: "Settings", icon: "⚙", href: "#/settings" },
];

// 화면 설명은 페이지가 아니라 여기에 둔다. 한 곳에서 어휘를 맞추기 위해서다.
const routeDescriptions: Record<RouteKey, string> = {
  timeline:
    "요청과 Task가 Event Loop를 언제 점유하고 언제 넘겨주는지 시간순으로 보여줍니다.",
  requests:
    "완료된 요청을 검색해 각 요청이 어디서 얼마나 기다렸는지 확인합니다.",
  analyzer: "Event Loop를 막은 지점과 확인된 해결 방법을 보여줍니다.",
  settings:
    "감지 기준과 버퍼 크기를 바꿉니다. 즉시 적용되는 항목과 재시작이 필요한 항목을 구분합니다.",
};

export function routeFromHash(hash: string): RouteKey {
  const route = hash.replace(/^#\/?/, "").split("?")[0];
  if (isRoute(route)) {
    return route;
  }
  return DEFAULT_ROUTE;
}

export function titleForRoute(route: RouteKey): string {
  return navItems.find((item) => item.key === route)?.label ?? "Timeline";
}

export function descriptionForRoute(route: RouteKey): string {
  return routeDescriptions[route];
}

function isRoute(value: string): value is RouteKey {
  return navItems.some((item) => item.key === value);
}
