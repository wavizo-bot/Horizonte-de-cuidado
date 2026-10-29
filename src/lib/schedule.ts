import type {
  AppState,
  Appointment,
  CareModel,
  DaySummary,
  ISODate,
  Patient,
  PlanResult,
  SlotType,
  UnscheduledItem,
  Weekday,
} from "../types";
import {
  addDays,
  addMonths,
  compareISO,
  diffDays,
  nthWeekdayOfMonth,
  parseISO,
  recurrenceDays,
  todayISO,
  toISO,
  weekdayOf,
} from "./date";
import { deterministicId } from "./id";

const SLOT_TYPES: SlotType[] = ["triage", "individual", "group", "collective", "makeup"];
const CLOSED_STATUSES = new Set(["discharged", "transferred", "refused", "deceased"]);

export function emptyCapacity(): Record<SlotType, number> {
  return { triage: 0, individual: 0, group: 0, collective: 0, makeup: 0 };
}

export function capacityForDate(state: AppState, date: ISODate): {
  capacity: Record<SlotType, number>;
  closed: boolean;
  reason?: string;
} {
  const override = state.settings.dayOverrides.find((item) => item.date === date);
  if (override?.closed) {
    return { capacity: emptyCapacity(), closed: true, reason: override.reason };
  }
  const weekday = weekdayOf(date);
  const base = state.settings.weeklyCapacity.find((item) => item.weekday === weekday);
  const isWorkday = state.settings.workdays.includes(weekday);
  const capacity = emptyCapacity();
  for (const type of SLOT_TYPES) {
    const overrideValue = override?.capacity?.[type];
    const baseValue = base?.[type] ?? 0;
    capacity[type] = overrideValue !== undefined ? overrideValue : isWorkday ? baseValue : 0;
  }
  const anyOverride = override?.capacity && Object.keys(override.capacity).length > 0;
  if (!isWorkday && !anyOverride) {
    return { capacity: emptyCapacity(), closed: false };
  }
  return { capacity, closed: false, reason: override?.reason };
}

export function isDayClosed(state: AppState, date: ISODate): boolean {
  return capacityForDate(state, date).closed;
}

export function isPatientActive(patient: Patient): boolean {
  return patient.status === "active" || patient.status === "waiting_triage" || patient.status === "paused";
}

export function isSchedulable(patient: Patient): boolean {
  return !CLOSED_STATUSES.has(patient.status) && patient.status !== "paused";
}

export function careModelOf(state: AppState, patient: Patient): CareModel | undefined {
  return state.careModels.find((model) => model.id === patient.careModelId);
}

export function modelKindOf(state: AppState, patient: Patient): CareModel["kind"] | undefined {
  return careModelOf(state, patient)?.kind;
}

export function appointmentsForPatient(state: AppState, patientId: string): Appointment[] {
  return state.appointments
    .filter((appointment) => appointment.patientId === patientId)
    .sort((a, b) => compareISO(a.date, b.date));
}

export function lastDone(state: AppState, patientId: string, slotType?: SlotType): Appointment | undefined {
  return state.appointments
    .filter(
      (appointment) =>
        appointment.patientId === patientId &&
        appointment.status === "done" &&
        (!slotType || appointment.slotType === slotType),
    )
    .sort((a, b) => compareISO(b.date, a.date))[0];
}

export function nextScheduled(state: AppState, patientId: string): Appointment | undefined {
  const today = todayISO();
  return state.appointments
    .filter(
      (appointment) =>
        appointment.patientId === patientId &&
        appointment.status === "scheduled" &&
        appointment.date >= today,
    )
    .sort((a, b) => compareISO(a.date, b.date))[0];
}

export function usedOnDate(state: AppState, date: ISODate): Record<SlotType, number> {
  const used = emptyCapacity();
  for (const appointment of state.appointments) {
    if (appointment.date !== date) continue;
    if (appointment.status === "cancelled") continue;
    used[appointment.slotType] += 1;
  }
  return used;
}

export function daySummary(state: AppState, date: ISODate): DaySummary {
  const { capacity, closed, reason } = capacityForDate(state, date);
  const appointments = state.appointments
    .filter((appointment) => appointment.date === date && appointment.status !== "cancelled")
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  return {
    date,
    closed,
    reason,
    capacity,
    used: usedOnDate(state, date),
    appointments,
    reminders: state.reminders.filter((reminder) => reminder.date === date),
  };
}

function firstOnOrAfter(date: ISODate, weekday: Weekday): ISODate {
  const current = weekdayOf(date);
  const delta = (weekday - current + 7) % 7;
  return addDays(date, delta);
}

export function meetingDates(model: CareModel, start: ISODate, end: ISODate): ISODate[] {
  const rule = model.schedule;
  if (!rule || rule.recurrence === "none") return [];
  const dates: ISODate[] = [];
  if (rule.recurrence === "weekly") {
    let cursor = firstOnOrAfter(start, rule.weekday);
    while (cursor <= end) {
      dates.push(cursor);
      cursor = addDays(cursor, 7);
    }
    return dates;
  }
  if (rule.recurrence === "biweekly") {
    const anchor = rule.anchorDate ?? start;
    let cursor = firstOnOrAfter(anchor, rule.weekday);
    while (cursor < start) cursor = addDays(cursor, 14);
    while (cursor <= end) {
      dates.push(cursor);
      cursor = addDays(cursor, 14);
    }
    return dates;
  }
  // monthly: nth weekday of each month
  const first = parseISO(start);
  const last = parseISO(end);
  let year = first.getFullYear();
  let month = first.getMonth();
  const endYear = last.getFullYear();
  const endMonth = last.getMonth();
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const date = nthWeekdayOfMonth(year, month, rule.weekday, rule.monthlyWeek ?? 1);
    if (date >= start && date <= end) dates.push(date);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return dates;
}

function nextDueForRecurrence(lastDate: ISODate, recurrence: Patient["recurrence"], preferredWeekday?: Weekday): ISODate {
  if (recurrence === "monthly") {
    const base = addMonths(lastDate, 1);
    return preferredWeekday === undefined ? base : firstOnOrAfter(base, preferredWeekday);
  }
  const days = recurrenceDays(recurrence);
  if (!days) return lastDate;
  return addDays(lastDate, days);
}

function slotTime(model: CareModel | undefined, type: SlotType, index: number): string | undefined {
  if (type === "group" || type === "collective") return model?.schedule?.time;
  if (type === "triage") {
    const minutes = 8 * 60 + index * 40;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  if (type === "individual") {
    const minutes = 8 * 60 + index * 50;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  return undefined;
}

interface PlannerState {
  today: ISODate;
  used: Record<string, Record<SlotType, number>>;
  patientDates: Map<string, Set<ISODate>>;
  planned: Appointment[];
  unscheduled: UnscheduledItem[];
}

function ensureUsed(planner: PlannerState, date: ISODate): Record<SlotType, number> {
  if (!planner.used[date]) planner.used[date] = emptyCapacity();
  return planner.used[date];
}

function ensurePatientDates(planner: PlannerState, patientId: string): Set<ISODate> {
  if (!planner.patientDates.has(patientId)) planner.patientDates.set(patientId, new Set());
  return planner.patientDates.get(patientId)!;
}

function addUnscheduled(planner: PlannerState, item: UnscheduledItem): void {
  const exists = planner.unscheduled.some(
    (entry) =>
      entry.patientId === item.patientId &&
      entry.slotType === item.slotType &&
      entry.dueDate === item.dueDate,
  );
  if (!exists) planner.unscheduled.push(item);
}

function available(
  state: AppState,
  planner: PlannerState,
  date: ISODate,
  type: SlotType,
  patientId: string,
): boolean {
  if (date < planner.today) return false;
  if (isDayClosed(state, date)) return false;
  if (ensurePatientDates(planner, patientId).has(date)) return false;
  const capacity = capacityForDate(state, date).capacity[type];
  return ensureUsed(planner, date)[type] < capacity;
}

function takeSlot(
  state: AppState,
  planner: PlannerState,
  patient: Patient,
  date: ISODate,
  type: SlotType,
  model: CareModel | undefined,
): Appointment | null {
  if (!available(state, planner, date, type, patient.id)) return null;
  const used = ensureUsed(planner, date);
  const index = used[type];
  used[type] += 1;
  ensurePatientDates(planner, patient.id).add(date);
  const now = new Date().toISOString();
  const appointment: Appointment = {
    id: deterministicId(["auto", patient.id, date, type, model?.id ?? "sem-modelo"]),
    patientId: patient.id,
    careModelId: model?.id ?? "",
    date,
    time: slotTime(model, type, index),
    slotType: type,
    status: "scheduled",
    source: "auto",
    createdAt: now,
    updatedAt: now,
  };
  planner.planned.push(appointment);
  return appointment;
}

function findSlot(
  state: AppState,
  planner: PlannerState,
  patient: Patient,
  type: SlotType,
  from: ISODate,
  until: ISODate,
  preferredWeekday?: Weekday,
): ISODate | null {
  let cursor = from < planner.today ? planner.today : from;
  let guard = 0;
  while (cursor <= until && guard < 1000) {
    guard += 1;
    if (preferredWeekday !== undefined && weekdayOf(cursor) !== preferredWeekday) {
      cursor = addDays(cursor, 1);
      continue;
    }
    if (available(state, planner, cursor, type, patient.id)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return null;
}

function historyAndBase(state: AppState, today: ISODate): {
  history: Appointment[];
  planner: PlannerState;
} {
  const history = state.appointments.filter(
    (appointment) =>
      appointment.status !== "scheduled" ||
      appointment.locked ||
      appointment.date < today ||
      appointment.source === "manual",
  );
  const planner: PlannerState = {
    today,
    used: {},
    patientDates: new Map(),
    planned: [],
    unscheduled: [],
  };
  for (const appointment of history) {
    ensurePatientDates(planner, appointment.patientId).add(appointment.date);
    if (appointment.status === "cancelled") continue;
    ensureUsed(planner, appointment.date)[appointment.slotType] += 1;
  }
  return { history, planner };
}

function triageDemands(state: AppState): Patient[] {
  return state.patients
    .filter((patient) => isSchedulable(patient) && !patient.triageDate)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      const byReferral = compareISO(a.referralDate, b.referralDate);
      if (byReferral !== 0) return byReferral;
      return a.name.localeCompare(b.name, "pt-BR");
    });
}

function individualDemands(state: AppState, today: ISODate, end: ISODate): Array<{
  patient: Patient;
  due: ISODate;
  occurrence: number;
}> {
  const demands: Array<{ patient: Patient; due: ISODate; occurrence: number }> = [];
  for (const patient of state.patients) {
    const model = careModelOf(state, patient);
    if (!model || model.kind !== "individual") continue;
    if (patient.status !== "active") continue;
    if (!patient.triageDate) continue;
    const lastIndividual = lastDone(state, patient.id, "individual");
    if (patient.recurrence === "none" && lastIndividual) continue;
    const hasFixedFuture = state.appointments.some(
      (appointment) =>
        appointment.patientId === patient.id &&
        appointment.slotType === "individual" &&
        appointment.status === "scheduled" &&
        appointment.date >= today &&
        (appointment.locked || appointment.source === "manual"),
    );
    if (hasFixedFuture) continue;
    let due: ISODate;
    if (lastIndividual) {
      due = nextDueForRecurrence(lastIndividual.date, patient.recurrence, patient.preferredWeekday);
    } else {
      due = patient.triageDate > today ? patient.triageDate : today;
    }
    if (due <= end) demands.push({ patient, due, occurrence: 0 });
  }
  return demands;
}

export function buildPlan(state: AppState, options?: { today?: ISODate; horizonDays?: number }): PlanResult {
  const today = options?.today ?? todayISO();
  const horizonDays = options?.horizonDays ?? state.settings.horizonDays ?? 90;
  const end = addDays(today, Math.max(1, horizonDays) - 1);
  const { planner } = historyAndBase(state, today);

  // 1. Matriciamento: prioritários primeiro, depois data de encaminhamento.
  for (const patient of triageDemands(state)) {
    const hasFixedTriage = state.appointments.some(
      (appointment) =>
        appointment.patientId === patient.id &&
        appointment.slotType === "triage" &&
        appointment.status === "scheduled" &&
        appointment.date >= today &&
        (appointment.locked || appointment.source === "manual"),
    );
    if (hasFixedTriage) continue;
    const from = patient.referralDate > today ? patient.referralDate : today;
    const date = findSlot(state, planner, patient, "triage", from, end);
    if (!date) {
      addUnscheduled(planner, {
        patientId: patient.id,
        careModelId: patient.careModelId,
        slotType: "triage",
        dueDate: from,
        reason: "Sem vaga de matriciamento no horizonte.",
      });
      continue;
    }
    takeSlot(state, planner, patient, date, "triage", careModelOf(state, patient));
  }

  // 2. Individual: uma ocorrência por vez, reordenando a fila a cada vaga.
  let individualQueue = individualDemands(state, today, end);
  const occurrences = new Map<string, number>();
  let guard = 0;
  while (individualQueue.length > 0 && guard < 5000) {
    guard += 1;
    individualQueue.sort((a, b) => {
      if (a.patient.priority !== b.patient.priority) return a.patient.priority ? -1 : 1;
      const byDue = compareISO(a.due, b.due);
      if (byDue !== 0) return byDue;
      return a.patient.name.localeCompare(b.patient.name, "pt-BR");
    });
    const demand = individualQueue.shift()!;
    const model = careModelOf(state, demand.patient);
    const date = findSlot(
      state,
      planner,
      demand.patient,
      "individual",
      demand.due,
      end,
      demand.patient.preferredWeekday,
    );
    if (!date) {
      addUnscheduled(planner, {
        patientId: demand.patient.id,
        careModelId: demand.patient.careModelId,
        slotType: "individual",
        dueDate: demand.due,
        reason:
          demand.patient.preferredWeekday !== undefined
            ? "Sem vaga no dia da semana preferido."
            : "Sem vaga individual no horizonte.",
      });
      continue;
    }
    takeSlot(state, planner, demand.patient, date, "individual", model);
    if (demand.patient.recurrence !== "none") {
      const nextDue = nextDueForRecurrence(date, demand.patient.recurrence, demand.patient.preferredWeekday);
      const count = (occurrences.get(demand.patient.id) ?? 0) + 1;
      occurrences.set(demand.patient.id, count);
      if (nextDue <= end && count < 40) {
        individualQueue.push({ patient: demand.patient, due: nextDue, occurrence: count });
      }
    }
  }

  // 3. Grupos e atividades coletivas: encontros recorrentes e membros ativos.
  const groupModels = state.careModels
    .filter((model) => model.active && (model.kind === "group" || model.kind === "collective"))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  for (const model of groupModels) {
    const members = state.patients
      .filter(
        (patient) =>
          patient.careModelId === model.id &&
          patient.status === "active" &&
          Boolean(patient.triageDate) &&
          isSchedulable(patient),
      )
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority ? -1 : 1;
        return a.name.localeCompare(b.name, "pt-BR");
      });
    const maxMembers = model.maxMembers ?? members.length;
    const eligible = members.slice(0, Math.max(0, maxMembers));
    for (const patient of members.slice(Math.max(0, maxMembers))) {
      addUnscheduled(planner, {
        patientId: patient.id,
        careModelId: model.id,
        slotType: model.slotType,
        dueDate: today,
        reason: `Grupo acima do limite de ${maxMembers} participantes.`,
      });
    }
    const dates = meetingDates(model, today, end);
    for (const date of dates) {
      if (isDayClosed(state, date)) continue;
      for (const patient of eligible) {
        if (ensurePatientDates(planner, patient.id).has(date)) continue;
        if (!available(state, planner, date, model.slotType, patient.id)) {
          addUnscheduled(planner, {
            patientId: patient.id,
            careModelId: model.id,
            slotType: model.slotType,
            dueDate: date,
            reason: `Sem vaga de ${model.kind === "collective" ? "atividade coletiva" : "grupo"} neste dia.`,
          });
          continue;
        }
        takeSlot(state, planner, patient, date, model.slotType, model);
      }
    }
  }

  return { appointments: planner.planned, unscheduled: planner.unscheduled };
}

/** Próxima vaga livre de um tipo, considerando os agendamentos atuais. */
export function nextAvailableDate(
  state: AppState,
  patientId: string,
  slotType: SlotType,
  from: ISODate = todayISO(),
  preferredWeekday?: Weekday,
  horizonDays = state.settings.horizonDays,
): ISODate | null {
  const end = addDays(from, Math.max(1, horizonDays) - 1);
  const used: Record<string, Record<SlotType, number>> = {};
  const patientDates = new Map<string, Set<ISODate>>();
  for (const appointment of state.appointments) {
    if (appointment.status === "cancelled") continue;
    if (!used[appointment.date]) used[appointment.date] = emptyCapacity();
    used[appointment.date][appointment.slotType] += 1;
    if (!patientDates.has(appointment.patientId)) patientDates.set(appointment.patientId, new Set());
    patientDates.get(appointment.patientId)!.add(appointment.date);
  }
  let cursor = from;
  let guard = 0;
  while (cursor <= end && guard < 1000) {
    guard += 1;
    if (preferredWeekday !== undefined && weekdayOf(cursor) !== preferredWeekday) {
      cursor = addDays(cursor, 1);
      continue;
    }
    const capacity = capacityForDate(state, cursor).capacity[slotType];
    const count = used[cursor]?.[slotType] ?? 0;
    const busy = patientDates.get(patientId)?.has(cursor) ?? false;
    if (!isDayClosed(state, cursor) && count < capacity && !busy) return cursor;
    cursor = addDays(cursor, 1);
  }
  return null;
}

export function daysUntil(date: ISODate, reference: ISODate = todayISO()): number {
  return diffDays(reference, date);
}

export function monthGridRange(monthStart: ISODate): { start: ISODate; end: ISODate } {
  const date = parseISO(monthStart);
  const start = toISO(new Date(date.getFullYear(), date.getMonth(), 1, 12));
  const end = toISO(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12));
  return { start, end };
}
