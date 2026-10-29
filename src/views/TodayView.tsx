import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { AppointmentCard } from "../components/AppointmentCard";
import { AppointmentDetail } from "../components/AppointmentDetail";
import { NewAppointmentModal } from "../components/NewAppointmentModal";
import { ReminderModal } from "../components/ReminderModal";
import { Avatar, Badge, Button, Card, EmptyState, Icon, IconButton, InfoNote, SectionHeading } from "../components/ui";
import { navigate } from "../navigation";
import { addDays, formatLong, formatShort, greetingForNow, todayISO, weekdayName, weekdayShort } from "../lib/date";
import { daySummary, nextScheduled } from "../lib/schedule";
import { contactPending, daysWaiting, waitingTriage } from "../lib/selectors";
import { firstName } from "../lib/whatsapp";
import type { Reminder } from "../types";

export function TodayView() {
  const { state, unscheduled, markAppointment, updateReminder, getPatient, getModel } = useStore();
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | undefined>();
  const today = todayISO();
  const summary = daySummary(state, today);
  const waiting = waitingTriage(state);
  const nextSeven = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = addDays(today, index);
        return { date, summary: daySummary(state, date) };
      }),
    [state, today],
  );
  const upcomingReminders = state.reminders
    .filter((reminder) => !reminder.done && reminder.date >= today && reminder.date <= addDays(today, 7))
    .sort((a, b) => `${a.date} ${a.time ?? "99:99"}`.localeCompare(`${b.date} ${b.time ?? "99:99"}`));
  const contactCount = state.patients.filter(
    (patient) => ["active", "waiting_triage", "paused"].includes(patient.status) && patient.phone && !patient.noWhatsapp && contactPending(patient),
  ).length;
  const groupsToday = state.careModels.filter(
    (model) => model.active && (model.kind === "group" || model.kind === "collective") && model.schedule?.weekday === new Date(`${today}T12:00:00`).getDay(),
  );
  const professionalFirst =
    firstName(state.settings.professionalName.replace(/^(dra?\.?|prof\.?|sr\.?|sra\.?)\s+/i, "")) || "profissional";
  const todayDone = summary.appointments.filter((appointment) => appointment.status === "done").length;
  const todayMissed = summary.appointments.filter((appointment) => appointment.status === "missed").length;

  return (
    <div className="stack stack--lg">
      <section className="today-hero">
        <div className="today-hero__content">
          <p className="eyebrow eyebrow--light">
            {weekdayName(today, true)} · {formatLong(today)}
          </p>
          <h1>
            {greetingForNow()}, {professionalFirst}.
          </h1>
          <p>
            {summary.appointments.length === 0
              ? "Sua agenda está livre hoje. Aproveite para revisar a fila e preparar os próximos encontros."
              : `Hoje há ${summary.appointments.length} ${summary.appointments.length === 1 ? "atendimento" : "atendimentos"} previstos${groupsToday.length ? ` e ${groupsToday.length} ${groupsToday.length === 1 ? "grupo em encontro" : "grupos em encontro"}` : ""}.`}
          </p>
          <div className="today-hero__actions">
            <Button variant="primary" icon="plus" onClick={() => navigate({ name: "patient-new" })}>
              Novo cadastro
            </Button>
            <Button variant="ghost" icon="calendarPlus" onClick={() => setNewOpen(true)} className="btn--on-dark">
              Encaixar atendimento
            </Button>
          </div>
        </div>
        <div className="today-hero__panel">
          <div className="today-hero__ring" style={{ ["--done" as string]: summary.appointments.length ? `${(todayDone / summary.appointments.length) * 100}%` : "0%" }}>
            <div>
              <strong>{todayDone}</strong>
              <small>de {summary.appointments.length} realizados</small>
            </div>
          </div>
          <div className="today-hero__mini">
            <span><i className="dot dot--ok" /> {todayDone} realizados</span>
            <span><i className="dot dot--danger" /> {todayMissed} faltas</span>
            <span><i className="dot dot--warm" /> {Math.max(0, summary.appointments.length - todayDone - todayMissed)} a acontecer</span>
          </div>
        </div>
      </section>

      {unscheduled.length > 0 ? (
        <InfoNote tone="warn" icon="alert" title={`${unscheduled.length} ${unscheduled.length === 1 ? "paciente ficou" : "pacientes ficaram"} sem vaga no horizonte`}>
          Revise a fila, ajuste a capacidade semanal ou abra vagas em dias específicos.{" "}
          <button type="button" className="link-button" onClick={() => navigate({ name: "queues" })}>
            Abrir filas e prioridades <Icon name="arrowRight" size={14} />
          </button>
        </InfoNote>
      ) : null}

      <div className="stat-grid">
        <Card className="stat-card">
          <span className="stat-card__icon stat-card__icon--clay"><Icon name="calendar" size={20} /></span>
          <div>
            <strong>{summary.appointments.length}</strong>
            <span>na agenda de hoje</span>
          </div>
          <small>{summary.used.triage} matriciamentos · {summary.used.individual} individuais</small>
        </Card>
        <Card className="stat-card">
          <span className="stat-card__icon stat-card__icon--sand"><Icon name="list" size={20} /></span>
          <div>
            <strong>{waiting.length}</strong>
            <span>aguardando matriciamento</span>
          </div>
          <small>{waiting.filter((patient) => patient.priority).length} com prioridade</small>
        </Card>
        <Card className="stat-card">
          <span className="stat-card__icon stat-card__icon--sage"><Icon name="layers" size={20} /></span>
          <div>
            <strong>{groupsToday.length}</strong>
            <span>{groupsToday.length === 1 ? "grupo hoje" : "grupos hoje"}</span>
          </div>
          <small>{groupsToday.map((group) => group.name.replace(/^Grupo de /, "")).join(", ") || "Nenhum encontro"}</small>
        </Card>
        <Card className="stat-card">
          <span className="stat-card__icon stat-card__icon--sky"><Icon name="message" size={20} /></span>
          <div>
            <strong>{contactCount}</strong>
            <span>contatos a revisar</span>
          </div>
          <small>Sem contato nos últimos 7 dias</small>
        </Card>
      </div>

      <div className="today-layout">
        <div className="stack">
          <Card className="today-agenda">
            <SectionHeading
              eyebrow="Agenda do dia"
              title={summary.appointments.length ? "Atendimentos de hoje" : "Um dia sem atendimentos"}
              description={summary.closed ? summary.reason ?? "O serviço está fechado hoje." : `${summary.appointments.length} atendimentos · capacidade usada: ${summary.used.triage + summary.used.individual + summary.used.group + summary.used.collective + summary.used.makeup}`}
              actions={
                <Button variant="ghost" size="sm" iconRight="arrowRight" onClick={() => navigate({ name: "agenda", date: today })}>
                  Ver agenda
                </Button>
              }
            />
            {summary.appointments.length === 0 ? (
              <EmptyState
                icon="sun"
                title="Nenhum atendimento previsto"
                description="Você pode encaixar um atendimento manual ou revisar as filas para adiantar pendências."
                action={<Button variant="soft" icon="calendarPlus" onClick={() => setNewOpen(true)}>Agendar atendimento</Button>}
              />
            ) : (
              <div className="appointment-list">
                {summary.appointments.map((appointment) => (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    patient={getPatient(appointment.patientId)}
                    model={getModel(appointment.careModelId)}
                    onOpen={() => setAppointmentId(appointment.id)}
                    onDone={() => markAppointment(appointment.id, "done")}
                    onMissed={() => markAppointment(appointment.id, "missed")}
                  />
                ))}
              </div>
            )}
          </Card>

          <div className="day-strip">
            {nextSeven.map(({ date, summary: day }) => (
              <button
                key={date}
                type="button"
                className={`day-strip__item${date === today ? " is-today" : ""}${day.closed ? " is-closed" : ""}`}
                onClick={() => navigate({ name: "agenda", date })}
              >
                <span>{weekdayShort(date)}</span>
                <strong>{formatShort(date)}</strong>
                <small>{day.closed ? "fechado" : day.appointments.length ? `${day.appointments.length} atend.` : "livre"}</small>
              </button>
            ))}
          </div>
        </div>

        <aside className="stack">
          <Card className="queue-preview">
            <SectionHeading
              eyebrow="Prioridades"
              title="Próximos da fila"
              actions={<IconButton icon="arrowUpRight" label="Abrir filas" onClick={() => navigate({ name: "queues" })} />}
            />
            {waiting.length === 0 ? (
              <EmptyState compact icon="checkCircle" title="Fila em dia" description="Ninguém aguardando matriciamento." />
            ) : (
              <div className="queue-preview__list">
                {waiting.slice(0, 4).map((patient) => {
                  const next = nextScheduled(state, patient.id);
                  return (
                    <button
                      key={patient.id}
                      type="button"
                      className="queue-row"
                      onClick={() => navigate({ name: "patient", patientId: patient.id })}
                    >
                      <Avatar name={patient.name} size="sm" />
                      <span className="queue-row__main">
                        <span className="queue-row__name">
                          {patient.name}
                          {patient.priority ? <Badge tone="clay">Prioridade</Badge> : null}
                        </span>
                        <small>
                          {daysWaiting(patient)} dias de espera · {next ? `matriciamento em ${formatShort(next.date)}` : "sem vaga"}
                        </small>
                      </span>
                      <Icon name="chevronRight" size={16} />
                    </button>
                  );
                })}
              </div>
            )}
            <Button variant="ghost" size="sm" iconRight="arrowRight" onClick={() => navigate({ name: "queues" })} className="btn--block">
              Ver toda a fila
            </Button>
          </Card>

          <Card>
            <SectionHeading
              eyebrow="Lembretes"
              title="Não esquecer"
              actions={<IconButton icon="plus" label="Novo lembrete" variant="soft" onClick={() => { setEditingReminder(undefined); setReminderOpen(true); }} />}
            />
            {upcomingReminders.length === 0 ? (
              <EmptyState compact icon="bell" title="Nenhum lembrete" description="Crie um lembrete para preparar um grupo ou retornar uma ligação." />
            ) : (
              <div className="reminder-list">
                {upcomingReminders.slice(0, 5).map((reminder) => (
                  <div key={reminder.id} className={`reminder-row${reminder.date === today ? " is-today" : ""}`}>
                    <button
                      type="button"
                      className="reminder-row__check"
                      aria-label="Marcar lembrete como feito"
                      onClick={() => updateReminder(reminder.id, { done: true })}
                    >
                      <Icon name="circle" size={18} />
                    </button>
                    <button type="button" className="reminder-row__text" onClick={() => { setEditingReminder(reminder); setReminderOpen(true); }}>
                      <strong>{reminder.title}</strong>
                      <small>
                        {reminder.date === today ? "hoje" : formatShort(reminder.date)}
                        {reminder.time ? ` · ${reminder.time}` : ""}
                        {reminder.careModelId ? ` · ${getModel(reminder.careModelId)?.name ?? ""}` : ""}
                      </small>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="soft-card">
            <p className="eyebrow">Planejamento</p>
            <h3>Horizonte de 90 dias</h3>
            <p className="muted">
              A agenda é recalculada a partir das filas, prioridades, grupos e capacidade. Atendimentos manuais e fixos são preservados.
            </p>
            <Button variant="soft" size="sm" icon="target" onClick={() => navigate({ name: "reports" })} className="btn--block">
              Ver planejamento
            </Button>
          </Card>
        </aside>
      </div>

      <AppointmentDetail appointmentId={appointmentId} onClose={() => setAppointmentId(null)} />
      <NewAppointmentModal open={newOpen} onClose={() => setNewOpen(false)} defaultDate={today} />
      <ReminderModal open={reminderOpen} onClose={() => setReminderOpen(false)} reminder={editingReminder} defaultDate={today} />
    </div>
  );
}
