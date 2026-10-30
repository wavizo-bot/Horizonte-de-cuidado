import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";
import { Avatar, Badge, cx } from "../components/ui";
import { useStore } from "../state/store";
import { navigate, type Route } from "../navigation";
import { todayISO } from "../lib/date";
import { waitingTriage } from "../lib/selectors";
import { getAppVersion } from "../lib/host";

function useVersion(): string {
  const [version, setVersion] = useState("1.0.0");
  useEffect(() => {
    let active = true;
    void getAppVersion().then((value) => {
      if (active && value) setVersion(value.replace(/^v/i, ""));
    });
    return () => {
      active = false;
    };
  }, []);
  return version;
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cx("brand", compact && "brand--compact")}>
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" role="img">
          <circle cx="24" cy="20" r="7" fill="currentColor" className="brand__sun" />
          <path d="M4 33c5-6 10-6 15 0s10 6 15 0 8-4 10-2" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path d="M6 40c5-5 9-5 14 0s9 5 14 0 7-3 8-2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity=".6" />
        </svg>
      </span>
      {!compact ? (
        <span className="brand__text">
          <strong>Horizonte</strong>
          <small>de Cuidado</small>
        </span>
      ) : null}
    </div>
  );
}

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const { state, drive, unscheduled } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const version = useVersion();
  const waiting = waitingTriage(state).length;

  useEffect(() => {
    setMenuOpen(false);
  }, [route.name, route.patientId]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const navGroups = useMemo(
    () => [
      {
        label: "Dia a dia",
        items: [
          { route: { name: "today" } as Route, label: "Hoje", icon: "sun" as IconName },
          { route: { name: "agenda" } as Route, label: "Agenda", icon: "calendar" as IconName },
          { route: { name: "patients" } as Route, label: "Pacientes", icon: "users" as IconName },
        ],
      },
      {
        label: "Fluxo de cuidado",
        items: [
          {
            route: { name: "queues" } as Route,
            label: "Filas e prioridades",
            icon: "list" as IconName,
            badge: waiting + unscheduled.length,
            tone: "clay" as const,
          },
          { route: { name: "groups" } as Route, label: "Grupos", icon: "layers" as IconName },
        ],
      },
      {
        label: "Comunicação",
        items: [{ route: { name: "messages" } as Route, label: "Mensagens", icon: "message" as IconName }],
      },
      {
        label: "Gestão",
        items: [
          { route: { name: "reports" } as Route, label: "Relatórios", icon: "chart" as IconName },
          { route: { name: "settings" } as Route, label: "Ajustes", icon: "settings" as IconName },
        ],
      },
    ],
    [waiting, unscheduled.length],
  );

  const activeName = route.name === "patient" || route.name === "patient-new" || route.name === "patient-edit" ? "patients" : route.name;

  const cloudTone = drive.status.conflicts > 0 ? "warn" : drive.status.signedIn ? "ok" : "muted";
  const cloudLabel = !drive.status.hostAvailable
    ? "Dados locais"
    : drive.status.conflicts > 0
      ? `${drive.status.conflicts} conflito(s)`
      : drive.status.signedIn
        ? "Nuvem ativa"
        : drive.status.configured
          ? "Conectar nuvem"
          : "Nuvem não configurada";

  const sidebar = (
    <div className="sidebar__inner">
      <button className="sidebar__brand" type="button" onClick={() => navigate({ name: "today" })} aria-label="Ir para Hoje">
        <Logo />
      </button>

      <div className="sidebar__unit">
        <span>{state.settings.unitName || "Sua unidade"}</span>
        <small>{state.settings.teamName || "Equipe de saúde mental"}</small>
      </div>

      <nav className="sidebar__nav" aria-label="Navegação principal">
        {navGroups.map((group) => (
          <div className="nav-group" key={group.label}>
            <p className="nav-group__label">{group.label}</p>
            {group.items.map((item) => {
              const active = activeName === item.route.name;
              return (
                <button
                  key={item.label}
                  type="button"
                  className={cx("nav-item", active && "is-active")}
                  onClick={() => navigate(item.route)}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon name={item.icon} size={19} />
                  <span>{item.label}</span>
                  {item.badge ? (
                    <span className={cx("nav-item__badge", item.tone && `nav-item__badge--${item.tone}`)}>
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar__foot">
        <button
          type="button"
          className="cloud-chip"
          onClick={() => navigate({ name: "settings", tab: "nuvem" })}
          title="Abrir ajustes de nuvem"
        >
          <span className={cx("cloud-chip__icon", `cloud-chip__icon--${cloudTone}`)}>
            <Icon name={drive.status.signedIn ? "cloud" : "cloudOff"} size={17} />
          </span>
          <span>
            <strong>{cloudLabel}</strong>
            <small>{drive.status.busy ? "Sincronizando…" : drive.status.lastSyncAt ? "Backup automático" : "Backup na nuvem"}</small>
          </span>
        </button>

        <button type="button" className="profile-chip" onClick={() => navigate({ name: "settings", tab: "perfil" })}>
          <Avatar name={state.settings.professionalName || "Profissional"} size="sm" tone="sand" />
          <span>
            <strong>{state.settings.professionalName || "Seu perfil"}</strong>
            <small>{state.settings.professionalRole || "Profissional"}</small>
          </span>
          <Icon name="settings" size={16} />
        </button>

        <p className="sidebar__version">Versão {version} · uso profissional</p>
      </div>
    </div>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Menu lateral">
        {sidebar}
      </aside>

      <div className="mobile-bar">
        <button
          type="button"
          className="mobile-bar__brand"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={menuOpen}
          aria-controls="horizonte-drawer"
        >
          <Logo />
        </button>
        <button
          type="button"
          className="mobile-bar__cloud"
          onClick={() => navigate({ name: "settings", tab: "nuvem" })}
          aria-label={cloudLabel}
        >
          <Icon name={drive.status.signedIn ? "cloud" : "cloudOff"} size={20} />
        </button>
      </div>

      {menuOpen ? (
        <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setMenuOpen(false)}>
          <aside className="drawer" id="horizonte-drawer" role="dialog" aria-modal="true" aria-label="Menu">
            <button className="drawer__close" type="button" onClick={() => setMenuOpen(false)} aria-label="Fechar menu">
              <Icon name="x" size={20} />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <main className="main">
        <div className="main__inner">{children}</div>
        <footer className="app-footer">
          <span>Horizonte de Cuidado · apoio à organização do cuidado, não substitui decisão clínica.</span>
          <span>Versão {version}</span>
        </footer>
      </main>

      <button
        type="button"
        className="mobile-fab"
        onClick={() => navigate({ name: "patient-new" })}
        aria-label="Novo cadastro"
      >
        <Icon name="plus" size={24} />
      </button>

      {state.settings.dayOverrides.some((override) => override.date === todayISO() && override.closed) ? (
        <Badge tone="warn" className="closed-today-banner">
          Hoje o serviço está fechado
        </Badge>
      ) : null}
    </div>
  );
}
