export type RouteKey =
  | "overview"
  | "timeline"
  | "requests"
  | "analyzer"
  | "settings";

export type NavItem = {
  key: RouteKey;
  label: string;
  icon: string;
  href: string;
};

export const navItems: NavItem[] = [
  { key: "overview", label: "Overview", icon: "◇", href: "#/overview" },
  { key: "timeline", label: "Timeline", icon: "↔", href: "#/timeline" },
  { key: "requests", label: "Requests", icon: "R", href: "#/requests" },
  { key: "analyzer", label: "Analyzer", icon: "!", href: "#/analyzer" },
  { key: "settings", label: "Settings", icon: "⚙", href: "#/settings" },
];

export function routeFromHash(hash: string): RouteKey {
  const route = hash.replace(/^#\/?/, "").split("?")[0];
  if (isRoute(route)) {
    return route;
  }
  return "overview";
}

export function titleForRoute(route: RouteKey): string {
  return navItems.find((item) => item.key === route)?.label ?? "Overview";
}

function isRoute(value: string): value is RouteKey {
  return ["overview", "timeline", "requests", "analyzer", "settings"].includes(
    value,
  );
}
