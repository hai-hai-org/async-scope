export type RouteKey = "overview" | "timeline" | "requests" | "analyzer";

export type NavItem = {
  key: RouteKey;
  label: string;
  icon: string;
  href: string;
};

export const navItems: NavItem[] = [
  { key: "overview", label: "Showcase", icon: "◇", href: "#showcase" },
  { key: "timeline", label: "Timeline", icon: "↔", href: "#timeline" },
  { key: "requests", label: "Requests", icon: "R", href: "#requests" },
  { key: "analyzer", label: "Analyzer", icon: "!", href: "#analyzer" },
];
