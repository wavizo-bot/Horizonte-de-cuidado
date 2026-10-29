import type {
  AppState,
  Appointment,
  CareModel,
  ISODate,
  MessageCategory,
  MessageContext,
  Patient,
  PatientStatus,
  SlotType,
} from "../types";
import {
  addDays,
  compareISO,
  diffDays,
  formatLong,
  recurrenceLabel,
  todayISO,
  weekdayName,
} from "./date";
import { firstName, formatPhone } from "./whatsapp";
import { appointmentsForPatient, careModelOf, lastDone, meetingDates, nextScheduled } from "./schedule";

export const STATUS_LABELS: Record<PatientStatus, string> = {
  waiting_triage: "Aguardando matriciamento",
  active: "Em acompanhamento",
  paused: "Pausado",
  discharged: "Alta",
  transferred: "Transferido",
  refused: "Recusou",
  deceased: "Óbito",
};

export const STATUS_TONE: Record<PatientStatus, string> = {
  waiting_triage: "warn",
  active: "ok",
  paused: "muted",
  discharged: "muted",
  transferred: "muted",
  refused: "danger",
  deceased: "muted",
};

export function patientModel(state: AppState, patient: Patient): CareModel | undefined {
  return careModelOf(state, patient);
}

export function patientModelName(state: AppState, patient: Patient): string {
  return patientModel(state, patient)?.name ?? "Modelo não definido";
}

export function daysWaiting(patient: Patient): number {
  return Math.max(0, diffDays(patient.referralDate, todayISO()));
}

export function waitingTriage(state: AppState): Patient[] {
  return state.patients
    .filter((patient) => !patient.triageDate && !["discharged", "transferred", "refused", "deceased"].includes(patient.status))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      return compareISO(a.referralDate, b.referralDate);
    });
}

export function triagedWithoutModel(state: AppState): Patient[] {
  return state.patients.filter((patient) => {
    if (!patient.triageDate) return false;
    const model = careModelOf(state, patient);
    return !model || model.kind === "triage";
  });
}

export function groupMembers(state: AppState, modelId: string): Patient[] {
  return state.patients
    .filter((patient) => patient.careModelId === modelId && patient.status === "active")
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
}

export function groupNextMeeting(_state: AppState, model: CareModel): ISODate | null {
  if (!model.schedule) return null;
  const today = todayISO();
  const dates = meetingDates(model, today, addDays(today, 365));
  return dates[0] ?? null;
}

export function groupMeetings(_state: AppState, model: CareModel, days = 90): ISODate[] {
  if (!model.schedule) return [];
  const today = todayISO();
  return meetingDates(model, today, addDays(today, days - 1));
}

export function nextAppointment(state: AppState, patientId: string): Appointment | undefined {
  return nextScheduled(state, patientId);
}

export function upcomingForPatient(state: AppState, patientId: string, limit = 5): Appointment[] {
  const today = todayISO();
  return appointmentsForPatient(state, patientId)
    .filter((appointment) => appointment.date >= today && appointment.status === "scheduled")
    .slice(0, limit);
}

export function lastDoneForPatient(state: AppState, patientId: string): Appointment | undefined {
  return lastDone(state, patientId);
}

export function patientsByModel(state: AppState): Array<{ model: CareModel; patients: Patient[] }> {
  return state.careModels
    .filter((model) => model.active)
    .map((model) => ({
      model,
      patients: state.patients.filter(
        (patient) =>
          patient.careModelId === model.id &&
          !["discharged", "transferred", "refused", "deceased"].includes(patient.status),
      ),
    }))
    .sort((a, b) => a.model.name.localeCompare(b.model.name, "pt-BR"));
}

export function modelScheduleLabel(model: CareModel): string {
  if (!model.schedule) return "Dia de atendimento não definido";
  const day = weekdayName(model.schedule.weekday, true);
  const rec = recurrenceLabel(model.schedule.recurrence);
  if (model.schedule.recurrence === "monthly") {
    const weeks = ["1ª", "2ª", "3ª", "4ª", "última"];
    return `${weeks[(model.schedule.monthlyWeek ?? 1) - 1] ?? "1ª"} ${day} do mês · ${rec}`;
  }
  return `${day} · ${rec}${model.schedule.time ? ` · ${model.schedule.time}` : ""}`;
}

export function slotLabel(slot: SlotType): string {
  return slot === "triage"
    ? "Matriciamento"
    : slot === "individual"
      ? "Individual"
      : slot === "group"
        ? "Grupo"
        : slot === "collective"
          ? "Atividade coletiva"
          : "Reposição de falta";
}

export function appointmentContext(
  state: AppState,
  patient: Patient,
  appointment?: Appointment,
  extra?: string,
): MessageContext {
  return {
    patient,
    careModel: careModelOf(state, patient),
    date: appointment?.date,
    time: appointment?.time,
    status: appointment?.status,
    extra,
  };
}

export function suggestedCategory(patient: Patient, appointment?: Appointment): MessageCategory {
  if (appointment?.status === "missed") return "no_show";
  if (!patient.triageDate) return "first";
  const model = patient.careModelId?.includes("group") ? "group" : "return";
  return model as MessageCategory;
}

export function renderTemplate(template: string, state: AppState, context: MessageContext): string {
  const patient = context.patient;
  const model = context.careModel;
  const date = context.date ? formatLong(context.date) : "data a confirmar";
  const time = context.time ?? "horário a confirmar";
  const values: Record<string, string> = {
    nome: patient?.name ?? "",
    primeiro_nome: firstName(patient?.name ?? ""),
    data: date,
    hora: time,
    grupo: model?.name ?? "grupo",
    modelo: model?.name ?? "atendimento",
    profissional: state.settings.professionalName,
    unidade: state.settings.unitName,
    equipe: patient?.referringTeam ?? state.settings.teamName,
    motivo: patient?.referralReason ?? "",
    telefone: formatPhone(patient?.phone),
    assinatura: state.settings.messageSignature || state.settings.professionalName,
    mensagem: context.extra ?? "",
  };
  return template.replace(/\{([a-z_]+)\}/gi, (match, key: string) => {
    const value = values[key.toLowerCase()];
    return value === undefined ? match : value;
  });
}

export function defaultTemplateFor(state: AppState, category: MessageCategory): string {
  return state.templates.find((template) => template.category === category && template.active)?.body ?? "";
}

export function priorityLabel(patient: Patient): string {
  if (!patient.priority) return "";
  return patient.priorityReason ? `Prioritário · ${patient.priorityReason}` : "Prioritário";
}

export function contactLabel(patient: Patient): string {
  if (patient.noWhatsapp) return "Sem WhatsApp";
  if (!patient.phone) return "Sem telefone";
  return formatPhone(patient.phone);
}

export function lastContact(patient: Patient): string | undefined {
  return patient.contactAttempts
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at))[0]?.at;
}

export function contactPending(patient: Patient, days = 7): boolean {
  const last = lastContact(patient);
  if (!last) return true;
  return diffDays(last.slice(0, 10), todayISO()) >= days;
}
