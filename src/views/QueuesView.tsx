import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { NewAppointmentModal } from "../components/NewAppointmentModal";
import { AppointmentDetail } from "../components/AppointmentDetail";
import { Avatar, Badge, Button, Card, EmptyState, Field, Icon, InfoNote, Modal, PageHeader, ProgressBar, SectionHeading, Select, useToast } from "../components/ui";
import { navigate } from "../navigation";
import { addDays, formatShortYear, todayISO } from "../lib/date";
import { groupMembers, groupNextMeeting, triagedWithoutModel, waitingTriage } from "../lib/selectors";
import { daysWaiting } from "../lib/selectors";
import { lastDone, nextScheduled } from "../lib/schedule";
import type { CareModel, Patient } from "../types";

export function QueuesView() {
  const { state, unscheduled, updatePatient, getPatient, getModel } = useStore();
  const { push } = useToast();
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newPatient, setNewPatient] = useState<string | undefined>();
  const [assignPatient, setAssignPatient] = useState<Patient | null>(null);
  const [assignModel, setAssignModel] = useState("");
  const today = todayISO();
  const waiting = waitingTriage(state);
  const triaged = triagedWithoutModel(state);
  const groupModels = state.careModels.filter((model) => model.active && (model.kind === "group" || model.kind === "collective"));
  const individualPatients = useMemo(
    () =>
      state.patients
        .filter((patient) => patient.status === "active" && getModel(patient.careModelId)?.kind === "individual")
        .map((patient) => ({
          patient,
          next: nextScheduled(state, patient.id),
          last: lastDone(state, patient.id, "individual"),
        }))
        .sort((a, b) => {
          const dateA = a.next?.date ?? a.last?.date ?? "0000-00-00";
          const dateB = b.next?.date ?? b.last?.date ?? "0000-00-00";
          return dateA.localeCompare(dateB);
        }),
    [state, getModel],
  );
  const priorityWaiting = waiting.filter((patient) => patient.priority);
  const unscheduledPatients = unscheduled.filter((item) => item.slotType === "triage" || item.slotType === "individual");

  const openNew = (patientId?: string) => {
    setNewPatient(patientId);
    setNewOpen(true);
  };

  const scheduleNext = (patient: Patient, slotType: "triage" | "individual") => {
    const next = nextScheduled(state, patient.id);
    if (next) {
      setAppointmentId(next.id);
      return;
    }
    const result = unscheduled.find((item) => item.patientId === patient.id && item.slotType === slotType);
    openNew(patient.id);
    if (result) push("Encaixe manual aberto para este paciente.", "info");
  };

  const openAssign = (patient: Patient) => {
    setAssignPatient(patient);
    setAssignModel(state.careModels.find((model) => model.id !== "cm-triage" && model.active)?.id ?? "");
  };

  const saveAssign = () => {
    if (!assignPatient || !assignModel) return;
    const model = getModel(assignModel);
    if (!model) return;
    const isGroup = model.kind === "group" || model.kind === "collective";
    updatePatient(assignPatient.id, {
      careModelId: model.id,
      status: "active",
      recurrence: isGroup ? "weekly" : assignPatient.recurrence === "none" ? "biweekly" : assignPatient.recurrence,
      preferredWeekday: model.schedule?.weekday ?? assignPatient.preferredWeekday,
    });
    push(`${assignPatient.name} encaminhado para ${model.name}.`);
    setAssignPatient(null);
  };

  const groupNext = (model: CareModel) => groupNextMeeting(state, model);

  return (
    <div className="stack stack--lg">
      <PageHeader
        eyebrow="Fluxo de cuidado"
        title="Filas e prioridades"
        description="Matriciamento, encaixes e continuidade. Prioridades aparecem primeiro; o restante segue a data de encaminhamento."
        actions={
          <>
            <Button variant="ghost" icon="settings" onClick={() => navigate({ name: "settings", tab: "agenda" })}>Capacidade</Button>
            <Button variant="primary" icon="calendarPlus" onClick={() => openNew()}>Encaixe manual</Button>
          </>
        }
      />

      <div className="queue-stats">
        <Card className="queue-stat">
          <span className="queue-stat__icon queue-stat__icon--clay"><Icon name="list" size={20} /></span>
          <div><strong>{waiting.length}</strong><span>aguardando matriciamento</span></div>
          <small>{priorityWaiting.length} prioritários</small>
        </Card>
        <Card className="queue-stat">
          <span className="queue-stat__icon queue-stat__icon--sand"><Icon name="alert" size={20} /></span>
          <div><strong>{unscheduled.length}</strong><span>sem vaga no horizonte</span></div>
          <small>{unscheduledPatients.length} de matriciamento ou individual</small>
        </Card>
        <Card className="queue-stat">
          <span className="queue-stat__icon queue-stat__icon--sage"><Icon name="target" size={20} /></span>
          <div><strong>{triaged.length}</strong><span>triados sem modelo</span></div>
          <small>Defina o cuidado após o matriciamento</small>
        </Card>
        <Card className="queue-stat">
          <span className="queue-stat__icon queue-stat__icon--sky"><Icon name="activity" size={20} /></span>
          <div><strong>{individualPatients.length}</strong><span>em individual</span></div>
          <small>{individualPatients.filter((item) => !item.next).length} sem próxima data</small>
        </Card>
      </div>

      {unscheduled.length > 0 ? (
        <InfoNote tone="warn" icon="alert" title="Existem pacientes sem vaga no planejamento de 90 dias">
          Ajuste a capacidade semanal, abra um dia específico ou faça um encaixe manual. Nenhum paciente é descartado da fila.
        </InfoNote>
      ) : null}

      <div className="queue-layout">
        <div className="stack">
          <Card>
            <SectionHeading
              eyebrow="Fila principal"
              title="Matriciamento"
              description="Prioritários primeiro; depois, quem espera há mais tempo."
              actions={<Badge tone="clay">{waiting.length} na fila</Badge>}
            />
            {waiting.length === 0 ? (
              <EmptyState compact icon="checkCircle" title="Fila de matriciamento vazia" description="Todos os encaminhamentos recebidos já têm data de primeiro atendimento." />
            ) : (
              <div className="queue-table">
                {waiting.map((patient, index) => {
                  const next = nextScheduled(state, patient.id);
                  return (
                    <div key={patient.id} className={`queue-table__row${patient.priority ? " is-priority" : ""}`}>
                      <span className="queue-table__rank">{index + 1}</span>
                      <Avatar name={patient.name} size="sm" />
                      <button type="button" className="queue-table__person" onClick={() => navigate({ name: "patient", patientId: patient.id })}>
                        <strong>
                          {patient.name}
                          {patient.priority ? <Badge tone="clay"><Icon name="flag" size={11} /> prioridade</Badge> : null}
                        </strong>
                        <small>{patient.referringTeam || "Equipe não informada"} · {patient.referralReason || "Motivo não informado"}</small>
                      </button>
                      <span className="queue-table__wait">
                        <strong>{daysWaiting(patient)}</strong>
                        <small>dias</small>
                      </span>
                      <span className="queue-table__next">
                        {next ? (
                          <>
                            <strong>{formatShortYear(next.date)}</strong>
                            <small>{next.time ?? "sem horário"}</small>
                          </>
                        ) : (
                          <Badge tone="warn">sem vaga</Badge>
                        )}
                      </span>
                      <Button
                        variant={next ? "ghost" : "soft"}
                        size="sm"
                        icon={next ? "calendar" : "calendarPlus"}
                        onClick={() => scheduleNext(patient, "triage")}
                      >
                        {next ? "Abrir" : "Encaixar"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <SectionHeading
              eyebrow="Depois do matriciamento"
              title="Triados sem modelo definido"
              description="O paciente já foi acolhido, mas ainda não entrou em individual, grupo ou coletivo."
              actions={<Badge tone={triaged.length ? "warn" : "ok"}>{triaged.length}</Badge>}
            />
            {triaged.length === 0 ? (
              <EmptyState compact icon="checkCircle" title="Todos com cuidado definido" description="Nenhum paciente matriculado está sem encaminhamento interno." />
            ) : (
              <div className="queue-table">
                {triaged.map((patient) => (
                  <div key={patient.id} className="queue-table__row">
                    <span className="queue-table__rank"><Icon name="target" size={15} /></span>
                    <Avatar name={patient.name} size="sm" />
                    <button type="button" className="queue-table__person" onClick={() => navigate({ name: "patient", patientId: patient.id })}>
                      <strong>{patient.name}</strong>
                      <small>Matriciado em {patient.triageDate ? formatShortYear(patient.triageDate) : "data não informada"} · {patient.referralReason || "sem motivo registrado"}</small>
                    </button>
                    <span className="queue-table__wait" />
                    <span className="queue-table__next"><Badge tone="warn">sem modelo</Badge></span>
                    <Button variant="soft" size="sm" icon="target" onClick={() => openAssign(patient)}>Definir cuidado</Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <SectionHeading
              eyebrow="Acompanhamento individual"
              title="Retornos individuais"
              description="Quem está em atendimento individual e a próxima data prevista."
              actions={<Badge tone="info">{individualPatients.length}</Badge>}
            />
            {individualPatients.length === 0 ? (
              <EmptyState compact icon="user" title="Nenhum paciente em individual" description="Pacientes com modelo individual aparecerão aqui." />
            ) : (
              <div className="queue-table">
                {individualPatients.map(({ patient, next, last }) => (
                  <div key={patient.id} className="queue-table__row">
                    <span className="queue-table__rank"><Icon name="user" size={15} /></span>
                    <Avatar name={patient.name} size="sm" />
                    <button type="button" className="queue-table__person" onClick={() => navigate({ name: "patient", patientId: patient.id })}>
                      <strong>{patient.name}</strong>
                      <small>{last ? `Último atendimento em ${formatShortYear(last.date)}` : "Sem atendimento realizado"} · {patient.recurrence === "none" ? "pontual" : patient.recurrence}</small>
                    </button>
                    <span className="queue-table__wait" />
                    <span className="queue-table__next">
                      {next ? <><strong>{formatShortYear(next.date)}</strong><small>{next.time ?? "sem horário"}</small></> : <Badge tone="warn">sem data</Badge>}
                    </span>
                    <Button variant="ghost" size="sm" icon="calendar" onClick={() => scheduleNext(patient, "individual")}>
                      {next ? "Abrir" : "Agendar"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <aside className="stack">
          <Card>
            <SectionHeading eyebrow="Sem vaga" title="Pendências do horizonte" />
            {unscheduled.length === 0 ? (
              <EmptyState compact icon="checkCircle" title="Nada pendente" description="Todos os pacientes couberam no planejamento de 90 dias." />
            ) : (
              <div className="unscheduled-list">
                {unscheduled.slice(0, 8).map((item) => {
                  const patient = getPatient(item.patientId);
                  return (
                    <div key={`${item.patientId}-${item.slotType}-${item.dueDate}`} className="unscheduled-row">
                      <span className="unscheduled-row__icon"><Icon name="alert" size={15} /></span>
                      <button type="button" onClick={() => patient && navigate({ name: "patient", patientId: patient.id })}>
                        <strong>{patient?.name ?? "Paciente"}</strong>
                        <small>{item.reason}</small>
                        <span>Desejo desde {formatShortYear(item.dueDate)}</span>
                      </button>
                      <Icon name="chevronRight" size={15} />
                    </div>
                  );
                })}
                {unscheduled.length > 8 ? <p className="muted small">+ {unscheduled.length - 8} pendências.</p> : null}
              </div>
            )}
            <Button variant="soft" size="sm" icon="settings" onClick={() => navigate({ name: "settings", tab: "agenda" })} className="btn--block">
              Ajustar capacidade semanal
            </Button>
          </Card>

          <Card>
            <SectionHeading eyebrow="Grupos" title="Ocupação dos encontros" actions={<Button variant="ghost" size="sm" onClick={() => navigate({ name: "groups" })}>Ver</Button>} />
            <div className="mini-group-list">
              {groupModels.map((model) => {
                const members = groupMembers(state, model.id);
                const max = model.maxMembers ?? members.length;
                const next = groupNext(model);
                return (
                  <div key={model.id} className="mini-group">
                    <span className="model-dot" style={{ background: model.color }} />
                    <div className="mini-group__text">
                      <strong>{model.name}</strong>
                      <small>{next ? `próximo em ${formatShortYear(next)}` : "sem data definida"} · {members.length}/{max}</small>
                      <ProgressBar value={members.length} max={Math.max(1, max)} tone="sage" />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="soft-card">
            <p className="eyebrow">Regra de prioridade</p>
            <h3>Prioritários ocupam a próxima vaga</h3>
            <p className="muted">
              Gestantes, situações de violência, risco de autoagressão e outros critérios definidos pela equipe entram antes na fila de matriciamento. O app apenas ordena; a equipe decide.
            </p>
          </Card>
        </aside>
      </div>

      <AppointmentDetail appointmentId={appointmentId} onClose={() => setAppointmentId(null)} />
      <NewAppointmentModal open={newOpen} onClose={() => setNewOpen(false)} defaultDate={addDays(today, 1)} defaultPatientId={newPatient} />

      <Modal
        open={Boolean(assignPatient)}
        onClose={() => setAssignPatient(null)}
        title="Definir modelo de cuidado"
        description={assignPatient ? `${assignPatient.name} · matriciado em ${assignPatient.triageDate ? formatShortYear(assignPatient.triageDate) : "data não informada"}` : ""}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssignPatient(null)}>Cancelar</Button>
            <Button variant="primary" icon="target" onClick={saveAssign} disabled={!assignModel}>Encaminhar</Button>
          </>
        }
      >
        <Field label="Modelo de cuidado" htmlFor="assign-model" required>
          <Select id="assign-model" value={assignModel} onChange={(event) => setAssignModel(event.target.value)}>
            <option value="">Selecione…</option>
            {state.careModels.filter((model) => model.active && model.kind !== "triage").map((model) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </Select>
        </Field>
        {assignModel ? (() => {
          const model = getModel(assignModel);
          if (!model) return null;
          const members = groupMembers(state, model.id);
          const isGroup = model.kind === "group" || model.kind === "collective";
          return (
            <InfoNote icon={isGroup ? "layers" : "user"} title={isGroup ? "Grupo selecionado" : "Atendimento individual"}>
              {isGroup
                ? `${model.name} · ${model.schedule ? `encontros ${model.schedule.recurrence === "weekly" ? "semanais" : model.schedule.recurrence === "biweekly" ? "quinzenais" : "mensais"}` : "sem recorrência definida"} · ${members.length}/${model.maxMembers ?? "sem limite"} participantes.`
                : `${model.name} · o paciente entra na fila individual${assignPatient?.recurrence && assignPatient.recurrence !== "none" ? ` com recorrência ${assignPatient.recurrence}` : " como atendimento pontual"}.`}
            </InfoNote>
          );
        })() : null}
      </Modal>
    </div>
  );
}
