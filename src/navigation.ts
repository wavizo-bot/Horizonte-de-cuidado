import { useEffect, useState } from "react";

export type RouteName =
  | "today"
  | "agenda"
  | "patients"
  | "patient"
  | "patient-new"
  | "patient-edit"
  | "queues"
  | "groups"
  | "messages"
  | "reports"
  | "settings";

export interface Route {
  name: RouteName;
  patientId?: string;
  date?: string;
  tab?: string;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const query = new URLSearchParams(queryPart ?? "");
  const date = query.get("data") ?? undefined;
  const tab = query.get("aba") ?? undefined;
  if (segments.length === 0 || segments[0] === "hoje") return { name: "today" };
  switch (segments[0]) {
    case "agenda":
      return { name: "agenda", date };
    case "pacientes":
      if (segments[1] === "novo") return { name: "patient-new" };
      if (segments[1] && segments[2] === "editar") return { name: "patient-edit", patientId: segments[1] };
      if (segments[1]) return { name: "patient", patientId: segments[1] };
      return { name: "patients" };
    case "filas":
      return { name: "queues" };
    case "grupos":
      return { name: "groups" };
    case "mensagens":
      return { name: "messages", patientId: query.get("paciente") ?? undefined };
    case "relatorios":
      return { name: "reports" };
    case "ajustes":
      return { name: "settings", tab };
    default:
      return { name: "today" };
  }
}

export function routeHref(route: Route): string {
  const query = new URLSearchParams();
  if (route.date) query.set("data", route.date);
  if (route.tab) query.set("aba", route.tab);
  if (route.name === "messages" && route.patientId) query.set("paciente", route.patientId);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  switch (route.name) {
    case "today":
      return "#/hoje";
    case "agenda":
      return `#/agenda${suffix}`;
    case "patients":
      return "#/pacientes";
    case "patient":
      return `#/pacientes/${route.patientId ?? ""}`;
    case "patient-new":
      return "#/pacientes/novo";
    case "patient-edit":
      return `#/pacientes/${route.patientId ?? ""}/editar`;
    case "queues":
      return "#/filas";
    case "groups":
      return "#/grupos";
    case "messages":
      return `#/mensagens${suffix}`;
    case "reports":
      return "#/relatorios";
    case "settings":
      return `#/ajustes${suffix}`;
  }
}

export function navigate(route: Route): void {
  const href = routeHref(route);
  if (window.location.hash === href) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = href;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    if (!window.location.hash) window.location.hash = "#/hoje";
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
