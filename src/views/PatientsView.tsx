import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { Avatar, Button, Card, EmptyState, Icon, PageHeader, SearchInput, Select, StatusBadge, Tabs } from "../components/ui";
import { navigate } from "../navigation";
import { formatShortYear } from "../lib/date";
import { nextScheduled } from "../lib/schedule";
import { contactLabel, daysWaiting, patientModelName } from "../lib/selectors";
import type { PatientStatus } from "../types";

type StatusFilter = "all" | "waiting" | "active" | "paused" | "closed";
type SortKey = "name" | "priority" | "next" | "waiting";

const STATUS_GROUPS: Record<StatusFilter, PatientStatus[]> = {
  all: ["waiting_triage", "active", "paused", "discharged", "transferred", "refused", "deceased"],
  waiting: ["waiting_triage"],
  active: ["active"],
  paused: ["paused"],
  closed: ["discharged", "transferred", "refused", "deceased"],
};

export function PatientsView() {
  const { state, getModel } = useStore();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("priority");

  const counts = useMemo(
    () => ({
      all: state.patients.length,
      waiting: state.patients.filter((patient) => patient.status === "waiting_triage").length,
      active: state.patients.filter((patient) => patient.status === "active").length,
      paused: state.patients.filter((patient) => patient.status === "paused").length,
      closed: state.patients.filter((patient) => STATUS_GROUPS.closed.includes(patient.status)).length,
    }),
    [state.patients],
  );

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const list = state.patients.filter((patient) => {
      if (!STATUS_GROUPS[statusFilter].includes(patient.status)) return false;
      if (modelFilter !== "all" && patient.careModelId !== modelFilter) return false;
      if (!text) return true;
      return [patient.name, patient.registrationNumber, patient.phone, patient.referringTeam, patient.referralReason, patient.observations]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(text));
    });
    return list.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "pt-BR");
      if (sort === "priority") {
        if (a.priority !== b.priority) return a.priority ? -1 : 1;
        return a.name.localeCompare(b.name, "pt-BR");
      }
      if (sort === "waiting") return daysWaiting(b) - daysWaiting(a);
      const nextA = nextScheduled(state, a.id)?.date ?? "9999-99-99";
      const nextB = nextScheduled(state, b.id)?.date ?? "9999-99-99";
      return nextA.localeCompare(nextB);
    });
  }, [state, query, statusFilter, modelFilter, sort]);

  return (
    <div className="stack stack--lg">
      <PageHeader
        eyebrow="Cadastros"
        title="Pacientes"
        description={`${state.patients.length} cadastros · ${counts.active} em acompanhamento · ${counts.waiting} aguardando matriciamento`}
        actions={
          <>
            <Button variant="ghost" icon="download" onClick={() => navigate({ name: "reports" })} className="hide-mobile">Exportar</Button>
            <Button variant="primary" icon="plus" onClick={() => navigate({ name: "patient-new" })}>Novo paciente</Button>
          </>
        }
      />

      <Card className="patient-filters">
        <div className="patient-filters__top">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Buscar por nome, cadastro, telefone, equipe ou motivo…"
            className="patient-filters__search"
          />
          <div className="patient-filters__selects">
            <Select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} aria-label="Filtrar por modelo de cuidado">
              <option value="all">Todos os modelos</option>
              {state.careModels.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </Select>
            <Select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Ordenar pacientes">
              <option value="priority">Prioridade e nome</option>
              <option value="name">Nome</option>
              <option value="next">Próximo atendimento</option>
              <option value="waiting">Maior tempo de espera</option>
            </Select>
          </div>
        </div>
        <Tabs
          value={statusFilter}
          onChange={setStatusFilter}
          tabs={[
            { value: "all", label: "Todos", count: counts.all },
            { value: "waiting", label: "Aguardando", count: counts.waiting },
            { value: "active", label: "Em cuidado", count: counts.active },
            { value: "paused", label: "Pausados", count: counts.paused },
            { value: "closed", label: "Encerrados", count: counts.closed },
          ]}
        />
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon="users"
            title={query ? "Nenhum paciente encontrado" : "Nenhum cadastro neste filtro"}
            description={query ? "Tente outro nome, cadastro ou telefone." : "Ajuste os filtros ou cadastre um novo paciente."}
            action={<Button variant="soft" icon="plus" onClick={() => navigate({ name: "patient-new" })}>Cadastrar paciente</Button>}
          />
        </Card>
      ) : (
        <Card className="patient-table-card">
          <div className="patient-table__head">
            <span>Paciente</span>
            <span>Modelo de cuidado</span>
            <span>Situação</span>
            <span>Próximo atendimento</span>
            <span>Contato</span>
            <span />
          </div>
          <div className="patient-table">
            {filtered.map((patient) => {
              const model = getModel(patient.careModelId);
              const next = nextScheduled(state, patient.id);
              return (
                <button
                  key={patient.id}
                  type="button"
                  className="patient-row"
                  onClick={() => navigate({ name: "patient", patientId: patient.id })}
                >
                  <span className="patient-row__identity">
                    <Avatar name={patient.name} size="md" />
                    <span>
                      <strong>
                        {patient.name}
                        {patient.priority ? <span className="priority-pill"><Icon name="flag" size={11} /> prioritário</span> : null}
                      </strong>
                      <small>
                        {patient.registrationNumber ? `Cadastro ${patient.registrationNumber}` : "Sem número de cadastro"}
                        {patient.age !== undefined ? ` · ${patient.age} anos` : ""}
                        {!patient.triageDate ? ` · ${daysWaiting(patient)} dias de espera` : ""}
                      </small>
                    </span>
                  </span>
                  <span className="patient-row__model">
                    {model ? (
                      <>
                        <i className="model-dot" style={{ background: model.color }} />
                        <span>{patientModelName(state, patient)}</span>
                      </>
                    ) : (
                      <span className="muted">Não definido</span>
                    )}
                  </span>
                  <span className="patient-row__status"><StatusBadge status={patient.status} /></span>
                  <span className="patient-row__next">
                    {next ? (
                      <>
                        <strong>{formatShortYear(next.date)}</strong>
                        <small>{next.time ?? "sem horário"}</small>
                      </>
                    ) : (
                      <small className="muted">Sem agendamento</small>
                    )}
                  </span>
                  <span className={`patient-row__contact${patient.noWhatsapp ? " is-muted" : ""}`}>
                    <Icon name={patient.noWhatsapp ? "phone" : "whatsapp"} size={15} />
                    {contactLabel(patient)}
                  </span>
                  <span className="patient-row__arrow"><Icon name="chevronRight" size={18} /></span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <p className="muted small">
        {filtered.length} de {state.patients.length} cadastros exibidos. Os dados são fictícios nesta demonstração.
      </p>
    </div>
  );
}
