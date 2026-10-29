import type {
  AppState,
  Appointment,
  CareModel,
  DayCapacity,
  Patient,
  Weekday,
} from "../src/types";
import { emptyState } from "../src/lib/defaults";

export function capacity(weekday: Weekday, values: Partial<DayCapacity> = {}): DayCapacity {
  return {
    weekday,
    triage: 0,
    individual: 0,
    group: 0,
    collective: 0,
    makeup: 0,
    ...values,
  };
}

export function testState(overrides: Partial<AppState> = {}): AppState {
  const base = emptyState();
  const weeklyCapacity = ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((weekday) =>
    capacity(weekday, { triage: 2, individual: 2, group: 10, collective: 10, makeup: 1 }),
  );
  return {
    ...base,
    patients: [],
    appointments: [],
    reminders: [],
    careModels: [],
    settings: {
      ...base.settings,
      unitName: "Unidade de teste",
      teamName: "Equipe de teste",
      professionalName: "Profissional de teste",
      professionalRole: "Psicóloga(o)",
      workdays: [1, 2, 3, 4, 5],
      weeklyCapacity,
      dayOverrides: [],
      horizonDays: 90,
      onboarded: true,
      ...(overrides.settings ?? {}),
    },
    ...overrides,
  };
}

export function triageModel(): CareModel {
  return {
    id: "cm-triage",
    name: "Matriciamento",
    kind: "triage",
    slotType: "triage",
    color: "#b9684e",
    active: true,
  };
}

export function individualModel(): CareModel {
  return {
    id: "cm-individual",
    name: "Atendimento individual",
    kind: "individual",
    slotType: "individual",
    color: "#486b78",
    active: true,
  };
}

export function groupModel(overrides: Partial<CareModel> = {}): CareModel {
  return {
    id: "cm-group",
    name: "Grupo de teste",
    kind: "group",
    slotType: "group",
    color: "#5b7a63",
    active: true,
    maxMembers: 10,
    schedule: { weekday: 1, recurrence: "weekly", time: "14:00" },
    ...overrides,
  };
}

export function patient(overrides: Partial<Patient> & Pick<Patient, "id" | "name">): Patient {
  const now = "2026-01-01T12:00:00.000Z";
  return {
    registrationNumber: overrides.registrationNumber ?? overrides.id,
    noWhatsapp: false,
    referralDate: "2026-01-01",
    referralReason: "Demanda de teste",
    referringTeam: "Equipe de teste",
    status: "waiting_triage",
    priority: false,
    recurrence: "none",
    notes: [],
    contactAttempts: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function appointment(overrides: Partial<Appointment> & Pick<Appointment, "id" | "patientId" | "date">): Appointment {
  return {
    careModelId: overrides.careModelId ?? "cm-individual",
    slotType: overrides.slotType ?? "individual",
    status: overrides.status ?? "scheduled",
    source: overrides.source ?? "manual",
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}
