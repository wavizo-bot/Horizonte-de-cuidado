import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { AppointmentCard, AppointmentChip } from "../components/AppointmentCard";
import { AppointmentDetail } from "../components/AppointmentDetail";
import { NewAppointmentModal } from "../components/NewAppointmentModal";
import { ReminderModal } from "../components/ReminderModal";
import { Button, Card, Checkbox, EmptyState, Field, Icon, IconButton, InfoNote, Input, Modal, PageHeader, ProgressBar, Segmented, SectionHeading, useToast } from "../components/ui";
import { navigate } from "../navigation";
import {
  addDays,
  addMonths,
  calendarCells,
  formatLong,
  formatMonthYear,
  formatShort,
  formatShortYear,
  monthName,
  startOfMonth,
  todayISO,
  weekdayName,
  weekdayOf,
  weekdayShort,
} from "../lib/date";
import { capacityForDate, daySummary, usedOnDate } from "../lib/schedule";
import { SLOT_LABELS } from "../lib/defaults";
import { printPage } from "../lib/host";
import type { Reminder, SlotType } from "../types";

type AgendaMode = "day" | "week" | "month";

function startOfWeek(date: string): string {
  const day = weekdayOf(date);
  return addDays(date, day === 0 ? -6 : 1 - day);
}

function periodOf(time?: string): "Manhã" | "Tarde" | "Noite" | "Sem horário" {
  if (!time) return "Sem horário";
  const hour = Number(time.slice(0, 2));
  if (hour < 12) return "Manhã";
  if (hour < 18) return "Tarde";
  return "Noite";
}

const CAPACITY_KEYS: SlotType[] = ["triage", "individual", "group", "collective", "makeup"];

export function AgendaView({ routeDate }: { routeDate?: string }) {
  const { state, setDayOverride, removeDayOverride, updateReminder, deleteReminder, getPatient, getModel } = useStore();
  const { push } = useToast();
  const today = todayISO();
  const [date, setDate] = useState(routeDate ?? today);
  const [mode, setMode] = useState<AgendaMode>("day");
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newDate, setNewDate] = useState(routeDate ?? today);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | undefined>();
  const [closed, setClosed] = useState(false);
  const [reason, setReason] = useState("");
  const [capacityDraft, setCapacityDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (routeDate) setDate(routeDate);
  }, [routeDate]);

  const go = (next: string) => {
    setDate(next);
    navigate({ name: "agenda", date: next });
  };

  const openNew = (day: string = date) => {
    setNewDate(day);
    setNewOpen(true);
  };

  const summary = daySummary(state, date);
  const override = state.settings.dayOverrides.find((item) => item.date === date);
  const capacity = capacityForDate(state, date);
  const used = usedOnDate(state, date);
  const reminders = state.reminders
    .filter((reminder) => reminder.date === date)
    .sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));

  const weekStart = startOfWeek(date);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const monthStart = startOfMonth(date);
  const monthCells = calendarCells(monthStart);

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof summary.appointments>();
    for (const appointment of summary.appointments) {
      const period = periodOf(appointment.time);
      const list = groups.get(period) ?? [];
      list.push(appointment);
      groups.set(period, list);
    }
    return ["Manhã", "Tarde", "Noite", "Sem horário"]
      .filter((period) => groups.has(period))
      .map((period) => ({ period, appointments: groups.get(period)! }));
  }, [summary.appointments]);

  const openOverride = () => {
    setClosed(override?.closed ?? false);
    setReason(override?.reason ?? "");
    const draft: Record<string, string> = {};
    for (const key of CAPACITY_KEYS) {
      const value = override?.capacity?.[key];
      draft[key] = value === undefined ? "" : String(value);
    }
    setCapacityDraft(draft);
    setOverrideOpen(true);
  };

  const saveOverride = () => {
    const capacityOverride: Partial<Record<SlotType, number>> = {};
    for (const key of CAPACITY_KEYS) {
      const raw = capacityDraft[key];
      if (raw === "" || raw === undefined) continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0) capacityOverride[key] = value;
    }
    const hasCapacity = Object.keys(capacityOverride).length > 0;
    if (!closed && !hasCapacity) {
      removeDayOverride(date);
      push("Ajuste do dia removido; a regra semanal voltou a valer.");
    } else {
      setDayOverride({
        date,
        closed,
        reason: reason.trim() || undefined,
        capacity: hasCapacity ? capacityOverride : undefined,
      });
      push(closed ? "Dia marcado como fechado." : "Capacidade do dia ajustada.");
    }
    setOverrideOpen(false);
  };

  const step = (direction: number) => {
    if (mode === "day") go(addDays(date, direction));
    else if (mode === "week") go(addDays(date, direction * 7));
    else go(addMonths(startOfMonth(date), direction));
  };

  const printDay = () => {
    go(date);
    window.setTimeout(printPage, 50);
  };

  return (
    <div className="stack stack--lg">
      <PageHeader
        eyebrow="Agenda e capacidade"
        title={mode === "day" ? weekdayName(date, true) : mode === "week" ? "Semana de cuidado" : formatMonthYear(monthStart)}
        description={
          mode === "day"
            ? `${formatLong(date)} · ${summary.appointments.length} atendimentos previstos`
            : mode === "week"
              ? `${formatShort(weekStart)} a ${formatShortYear(addDays(weekStart, 6))}`
              : "Visão geral dos encontros, matriciamentos e atividades do mês."
        }
        actions={
          <>
            <Button variant="ghost" icon="printer" onClick={printDay} className="hide-mobile">Imprimir</Button>
            <Button variant="primary" icon="calendarPlus" onClick={() => openNew()}>Novo agendamento</Button>
          </>
        }
      />

      <div className="agenda-toolbar">
        <div className="agenda-toolbar__nav">
          <IconButton icon="chevronLeft" label="Período anterior" onClick={() => step(-1)} variant="soft" />
          <Button variant="ghost" size="sm" onClick={() => go(today)}>Hoje</Button>
          <IconButton icon="chevronRight" label="Próximo período" onClick={() => step(1)} variant="soft" />
          <button type="button" className="agenda-toolbar__date" onClick={() => go(today)}>
            {mode === "day" ? formatShortYear(date) : mode === "week" ? `${formatShort(weekStart)} – ${formatShort(addDays(weekStart, 6))}` : formatMonthYear(monthStart)}
          </button>
        </div>
        <Segmented
          ariaLabel="Visualização da agenda"
          value={mode}
          onChange={setMode}
          options={[
            { value: "day", label: "Dia" },
            { value: "week", label: "Semana" },
            { value: "month", label: "Mês" },
          ]}
        />
      </div>

      {mode === "day" ? (
        <div className="agenda-layout">
          <div className="stack">
            <Card className="capacity-strip">
              <div className="capacity-strip__head">
                <div>
                  <p className="eyebrow">Capacidade do dia</p>
                  <h3>{capacity.closed ? "Dia fechado" : "Vagas por tipo de atendimento"}</h3>
                </div>
                <Button variant="ghost" size="sm" icon="settings" onClick={openOverride}>
                  Ajustar dia
                </Button>
              </div>
              {capacity.closed ? (
                <InfoNote tone="warn" icon="lock" title="Serviço fechado">
                  {capacity.reason ?? "Dia marcado como fechado."} Nenhuma vaga automática será usada nesta data.
                </InfoNote>
              ) : (
                <div className="capacity-grid">
                  {CAPACITY_KEYS.map((key) => (
                    <div key={key} className={`capacity-cell capacity-cell--${key}`}>
                      <div className="capacity-cell__top">
                        <span>{SLOT_LABELS[key]}</span>
                        <strong>{used[key]}<small>/{capacity.capacity[key]}</small></strong>
                      </div>
                      <ProgressBar
                        value={used[key]}
                        max={capacity.capacity[key]}
                        tone={key === "triage" ? "clay" : key === "individual" ? "sky" : key === "group" ? "sage" : key === "collective" ? "sand" : "plum"}
                      />
                    </div>
                  ))}
                </div>
              )}
              {override ? (
                <div className="override-note">
                  <Icon name="info" size={15} />
                  <span>
                    Ajuste específico deste dia{override.reason ? `: ${override.reason}` : "."}{" "}
                    <button type="button" className="link-button" onClick={() => { removeDayOverride(date); push("Ajuste do dia removido."); }}>
                      Remover
                    </button>
                  </span>
                </div>
              ) : null}
            </Card>

            <Card>
              <SectionHeading
                eyebrow="Atendimentos"
                title={summary.appointments.length ? "Programação do dia" : "Sem atendimentos"}
                description={summary.appointments.length ? "Toque em um atendimento para marcar presença, falta ou remarcar." : "Use o encaixe manual quando precisar abrir uma vaga fora da regra semanal."}
                actions={
                  <Button variant="soft" size="sm" icon="plus" onClick={() => openNew()}>
                    Encaixar
                  </Button>
                }
              />
              {summary.appointments.length === 0 ? (
                <EmptyState
                  icon="calendar"
                  title={capacity.closed ? "Dia fechado" : "Agenda livre"}
                  description={capacity.closed ? "Não há atendimentos porque o dia está marcado como fechado." : "Nenhum atendimento automático ou manual foi previsto para esta data."}
                  action={<Button variant="soft" icon="calendarPlus" onClick={() => openNew()}>Novo agendamento</Button>}
                />
              ) : (
                <div className="agenda-periods">
                  {grouped.map((group) => (
                    <div key={group.period} className="agenda-period">
                      <div className="agenda-period__label">
                        <span>{group.period}</span>
                        <small>{group.appointments.length}</small>
                      </div>
                      <div className="appointment-list">
                        {group.appointments.map((appointment) => (
                          <AppointmentCard
                            key={appointment.id}
                            appointment={appointment}
                            patient={getPatient(appointment.patientId)}
                            model={getModel(appointment.careModelId)}
                            onOpen={() => setAppointmentId(appointment.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <SectionHeading
                eyebrow="Lembretes do dia"
                title="Preparação e pendências"
                actions={<Button variant="soft" size="sm" icon="plus" onClick={() => { setEditingReminder(undefined); setReminderOpen(true); }}>Novo</Button>}
              />
              {reminders.length === 0 ? (
                <EmptyState compact icon="bell" title="Nenhum lembrete para este dia" description="Crie lembretes para preparar materiais, revisar filas ou retornar ligações." />
              ) : (
                <div className="reminder-list">
                  {reminders.map((reminder) => (
                    <div key={reminder.id} className={`reminder-row${reminder.done ? " is-done" : ""}`}>
                      <button
                        type="button"
                        className="reminder-row__check"
                        aria-label={reminder.done ? "Reabrir lembrete" : "Marcar como feito"}
                        onClick={() => updateReminder(reminder.id, { done: !reminder.done })}
                      >
                        <Icon name={reminder.done ? "checkCircle" : "circle"} size={18} />
                      </button>
                      <button type="button" className="reminder-row__text" onClick={() => { setEditingReminder(reminder); setReminderOpen(true); }}>
                        <strong>{reminder.title}</strong>
                        <small>
                          {reminder.time ? `${reminder.time} · ` : ""}
                          {reminder.notes ?? (reminder.careModelId ? getModel(reminder.careModelId)?.name : "")}
                        </small>
                      </button>
                      <IconButton
                        icon="trash"
                        label="Excluir lembrete"
                        size="sm"
                        onClick={() => { deleteReminder(reminder.id); push("Lembrete excluído.", "info"); }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <aside className="stack">
            <Card className="day-summary-card">
              <p className="eyebrow">Resumo</p>
              <h3>{formatLong(date)}</h3>
              <div className="day-summary-card__grid">
                <div><strong>{summary.appointments.length}</strong><span>atendimentos</span></div>
                <div><strong>{summary.appointments.filter((item) => item.status === "done").length}</strong><span>realizados</span></div>
                <div><strong>{summary.appointments.filter((item) => item.status === "missed").length}</strong><span>faltas</span></div>
                <div><strong>{summary.appointments.filter((item) => item.locked).length}</strong><span>fixos</span></div>
              </div>
              <div className="day-summary-card__status">
                <Icon name={capacity.closed ? "lock" : "checkCircle"} size={16} />
                {capacity.closed ? "Dia fechado" : "Dia aberto para atendimentos"}
              </div>
              <Button variant="secondary" icon="settings" onClick={openOverride} className="btn--block">
                Ajustar capacidade
              </Button>
              {capacity.closed ? (
                <Button
                  variant="ghost"
                  icon="unlock"
                  className="btn--block"
                  onClick={() => { removeDayOverride(date); push("Dia reaberto."); }}
                >
                  Reabrir este dia
                </Button>
              ) : null}
            </Card>

            <Card className="soft-card">
              <p className="eyebrow">Regra semanal</p>
              <h3>Como este dia foi calculado</h3>
              <p className="muted">
                {capacity.closed
                  ? "O dia foi fechado manualmente nos ajustes. A regra semanal não é aplicada."
                  : `Capacidade base para ${weekdayName(date)}: ${SLOT_LABELS.triage.toLowerCase()} ${state.settings.weeklyCapacity.find((item) => item.weekday === weekdayOf(date))?.triage ?? 0}, individual ${state.settings.weeklyCapacity.find((item) => item.weekday === weekdayOf(date))?.individual ?? 0}, grupo ${state.settings.weeklyCapacity.find((item) => item.weekday === weekdayOf(date))?.group ?? 0}.`}
              </p>
              <Button variant="ghost" size="sm" iconRight="arrowRight" onClick={() => navigate({ name: "settings", tab: "agenda" })} className="btn--block">
                Editar regra semanal
              </Button>
            </Card>

            <Card>
              <p className="eyebrow">Atalhos</p>
              <div className="quick-links">
                <button type="button" onClick={() => navigate({ name: "queues" })}><Icon name="list" size={17} /> Revisar fila</button>
                <button type="button" onClick={() => navigate({ name: "groups" })}><Icon name="layers" size={17} /> Ver grupos</button>
                <button type="button" onClick={() => navigate({ name: "messages" })}><Icon name="message" size={17} /> Mensagens</button>
              </div>
            </Card>
          </aside>
        </div>
      ) : mode === "week" ? (
        <Card className="week-board">
          <div className="week-board__grid">
            {weekDays.map((day) => {
              const dayData = daySummary(state, day);
              const isToday = day === today;
              return (
                <div key={day} className={`week-column${isToday ? " is-today" : ""}${dayData.closed ? " is-closed" : ""}`}>
                  <button type="button" className="week-column__head" onClick={() => go(day)}>
                    <span>{weekdayShort(day)}</span>
                    <strong>{formatShort(day)}</strong>
                    <small>{dayData.closed ? "fechado" : `${dayData.appointments.length} atend.`}</small>
                  </button>
                  <div className="week-column__body">
                    {dayData.closed ? (
                      <span className="week-closed"><Icon name="lock" size={13} /> Fechado</span>
                    ) : dayData.appointments.length === 0 ? (
                      <span className="week-empty">Sem atendimentos</span>
                    ) : (
                      dayData.appointments.map((appointment) => (
                        <AppointmentChip
                          key={appointment.id}
                          appointment={appointment}
                          patient={getPatient(appointment.patientId)}
                          onOpen={() => setAppointmentId(appointment.id)}
                        />
                      ))
                    )}
                  </div>
                  <button type="button" className="week-column__add" onClick={() => openNew(day)} aria-label={`Agendar em ${formatShort(day)}`}>
                    <Icon name="plus" size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card className="month-card">
          <div className="month-weekdays">
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="month-grid">
            {monthCells.map((day) => {
              const dayData = daySummary(state, day);
              const inMonth = day.slice(0, 7) === monthStart.slice(0, 7);
              const isToday = day === today;
              const types = Array.from(new Set(dayData.appointments.map((appointment) => appointment.slotType)));
              return (
                <button
                  key={day}
                  type="button"
                  className={`month-cell${inMonth ? "" : " is-outside"}${isToday ? " is-today" : ""}${dayData.closed ? " is-closed" : ""}`}
                  onClick={() => go(day)}
                >
                  <span className="month-cell__day">{Number(day.slice(8, 10))}</span>
                  <span className="month-cell__month">{inMonth ? "" : monthName(Number(day.slice(5, 7)) - 1).slice(0, 3)}</span>
                  {dayData.closed ? (
                    <span className="month-cell__closed"><Icon name="lock" size={11} /> fechado</span>
                  ) : (
                    <>
                      {dayData.appointments.length ? (
                        <span className="month-cell__count">{dayData.appointments.length} atend.</span>
                      ) : (
                        <span className="month-cell__empty">livre</span>
                      )}
                      <span className="month-cell__dots">
                        {types.slice(0, 4).map((type) => <i key={type} className={`dot-type dot-type--${type}`} />)}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div className="month-legend">
            {CAPACITY_KEYS.map((key) => <span key={key}><i className={`dot-type dot-type--${key}`} /> {SLOT_LABELS[key]}</span>)}
            <span><Icon name="lock" size={12} /> dia fechado</span>
          </div>
        </Card>
      )}

      <AppointmentDetail appointmentId={appointmentId} onClose={() => setAppointmentId(null)} />
      <NewAppointmentModal open={newOpen} onClose={() => setNewOpen(false)} defaultDate={newDate} />
      <ReminderModal open={reminderOpen} onClose={() => setReminderOpen(false)} reminder={editingReminder} defaultDate={date} />

      <Modal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Ajustar este dia"
        description={`${formatLong(date)} · a regra semanal continua valendo nos demais dias.`}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOverrideOpen(false)}>Cancelar</Button>
            <Button variant="primary" icon="save" onClick={saveOverride}>Salvar ajuste</Button>
          </>
        }
      >
        <Checkbox
          checked={closed}
          onChange={setClosed}
          label="Fechar o dia inteiro"
          description="Nenhum atendimento automático será agendado nesta data."
        />
        <Field label="Motivo do ajuste" htmlFor="override-reason">
          <Input
            id="override-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: reunião de equipe, feriado, capacitação"
          />
        </Field>
        {!closed ? (
          <div className="capacity-form">
            <p className="field__label">Capacidade específica deste dia</p>
            <p className="field__hint">Deixe em branco para manter a capacidade semanal. Preencha apenas o que muda.</p>
            <div className="capacity-form__grid">
              {CAPACITY_KEYS.map((key) => (
                <Field key={key} label={SLOT_LABELS[key]} htmlFor={`override-${key}`}>
                  <Input
                    id={`override-${key}`}
                    type="number"
                    min={0}
                    value={capacityDraft[key] ?? ""}
                    placeholder={String(capacityForDate(state, date).capacity[key])}
                    onChange={(event) => setCapacityDraft((current) => ({ ...current, [key]: event.target.value }))}
                  />
                </Field>
              ))}
            </div>
          </div>
        ) : null}
        {override ? (
          <Button variant="ghost" icon="trash" onClick={() => { removeDayOverride(date); setOverrideOpen(false); push("Ajuste do dia removido."); }}>
            Remover ajuste existente
          </Button>
        ) : null}
      </Modal>
    </div>
  );
}
