import type {
  AppState,
  CareModel,
  DayCapacity,
  MessageTemplate,
  Patient,
  Settings,
  Weekday,
} from "../types";
import { todayISO, addDays, nowISOString } from "./date";
import { DEMO_PATIENTS } from "../data/demoPatients";

export const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export const SLOT_LABELS = {
  triage: "Matriciamento",
  individual: "Individual",
  group: "Grupo",
  collective: "Coletivo",
  makeup: "Reposição",
} as const;

export const SLOT_SHORT = {
  triage: "Matric.",
  individual: "Indiv.",
  group: "Grupo",
  collective: "Coletivo",
  makeup: "Reposição",
} as const;

export const SLOT_COLORS = {
  triage: "#b9684e",
  individual: "#486b78",
  group: "#5b7a63",
  collective: "#a97b32",
  makeup: "#7b6a9a",
} as const;

export function defaultCareModels(): CareModel[] {
  return [
    {
      id: "cm-triage",
      name: "Matriciamento (triagem)",
      kind: "triage",
      slotType: "triage",
      color: "#b9684e",
      active: true,
      description: "Primeiro atendimento e definição do cuidado.",
    },
    {
      id: "cm-individual",
      name: "Atendimento individual",
      kind: "individual",
      slotType: "individual",
      color: "#486b78",
      active: true,
      description: "Acompanhamento individual, recorrente ou pontual.",
    },
    {
      id: "cm-group-children",
      name: "Grupo de crianças",
      kind: "group",
      slotType: "group",
      color: "#5b7a63",
      active: true,
      maxMembers: 15,
      schedule: { weekday: 1, recurrence: "weekly", time: "14:00" },
    },
    {
      id: "cm-group-women",
      name: "Grupo de mulheres",
      kind: "group",
      slotType: "group",
      color: "#b9684e",
      active: true,
      maxMembers: 12,
      schedule: { weekday: 1, recurrence: "weekly", time: "15:00" },
    },
    {
      id: "cm-group-anxiety",
      name: "Grupo de ansiedade",
      kind: "group",
      slotType: "group",
      color: "#a97b32",
      active: true,
      maxMembers: 12,
      schedule: { weekday: 4, recurrence: "weekly", time: "14:00" },
    },
    {
      id: "cm-group-crafts",
      name: "Grupo de artesanato",
      kind: "group",
      slotType: "group",
      color: "#7b6a9a",
      active: true,
      maxMembers: 10,
      schedule: { weekday: 1, recurrence: "biweekly", anchorDate: todayISO(), time: "10:00" },
    },
    {
      id: "cm-group-elderly",
      name: "Grupo de idosos",
      kind: "group",
      slotType: "group",
      color: "#486b78",
      active: true,
      maxMembers: 12,
      schedule: { weekday: 3, recurrence: "monthly", monthlyWeek: 1, time: "14:00" },
    },
    {
      id: "cm-parents",
      name: "Orientação de pais",
      kind: "group",
      slotType: "group",
      color: "#5b7a63",
      active: true,
      maxMembers: 8,
      schedule: { weekday: 2, recurrence: "biweekly", anchorDate: todayISO(), time: "09:00" },
    },
    {
      id: "cm-stimulation",
      name: "Grupo de estimulação",
      kind: "group",
      slotType: "group",
      color: "#a97b32",
      active: true,
      maxMembers: 10,
      schedule: { weekday: 5, recurrence: "weekly", time: "10:00" },
    },
    {
      id: "cm-collective",
      name: "Atividade coletiva",
      kind: "collective",
      slotType: "collective",
      color: "#95503b",
      active: true,
      maxMembers: 30,
      schedule: { weekday: 5, recurrence: "monthly", monthlyWeek: 5, time: "15:00" },
    },
  ];
}

export function defaultWeeklyCapacity(): DayCapacity[] {
  return WEEKDAY_ORDER.map((weekday) => ({
    weekday,
    triage: weekday === 2 || weekday === 4 ? 4 : weekday === 3 || weekday === 5 ? 2 : 0,
    individual: weekday >= 1 && weekday <= 5 ? 4 : 0,
    group: weekday === 1 ? 60 : weekday === 2 ? 15 : weekday === 3 ? 15 : weekday === 4 ? 20 : weekday === 5 ? 15 : 0,
    collective: weekday === 5 ? 30 : 0,
    makeup: weekday >= 1 && weekday <= 5 ? 2 : 0,
  }));
}

export function defaultSettings(): Settings {
  return {
    unitName: "Unidade de Saúde",
    teamName: "Equipe de Saúde Mental",
    professionalName: "Profissional",
    professionalRole: "Psicóloga(o)",
    workdays: [1, 2, 3, 4, 5],
    weeklyCapacity: defaultWeeklyCapacity(),
    dayOverrides: [],
    horizonDays: 90,
    defaultTriageModelId: "cm-triage",
    defaultIndividualModelId: "cm-individual",
    messageSignature: "Equipe de Saúde Mental",
    defaultDdd: "11",
    onboarded: false,
  };
}

export function defaultTemplates(): MessageTemplate[] {
  const now = nowISOString();
  return [
    {
      id: "tpl-group-next",
      name: "Próximo encontro do grupo",
      category: "group",
      active: true,
      updatedAt: now,
      body:
        "Olá, {primeiro_nome}! Tudo bem?\n\nO {grupo} se encontra na {data}, às {hora}.\nSua presença é importante para o grupo. Se precisar remarcar ou tiver alguma dúvida, responda esta mensagem.\n\n{assinatura}",
    },
    {
      id: "tpl-return",
      name: "Retorno de atendimento",
      category: "return",
      active: true,
      updatedAt: now,
      body:
        "Olá, {primeiro_nome}!\n\nSeu próximo atendimento está marcado para {data}, às {hora}.\nSe precisar remarcar, responda esta mensagem com antecedência.\n\n{assinatura}",
    },
    {
      id: "tpl-no-show",
      name: "Falta ao atendimento",
      category: "no_show",
      active: true,
      updatedAt: now,
      body:
        "Olá, {primeiro_nome}!\n\nSentimos sua falta no atendimento de {data}. Tudo bem com você?\nPodemos conversar e encontrar uma nova data. Responda esta mensagem quando puder.\n\n{assinatura}",
    },
    {
      id: "tpl-first",
      name: "Primeira consulta (matriciamento)",
      category: "first",
      active: true,
      updatedAt: now,
      body:
        "Olá, {primeiro_nome}!\n\nSeu primeiro atendimento (matriciamento) está marcado para {data}, às {hora}.\nChegue com alguns minutos de antecedência. Se precisar remarcar, responda esta mensagem.\n\n{assinatura}",
    },
    {
      id: "tpl-group-return",
      name: "Retorno ao grupo",
      category: "group",
      active: true,
      updatedAt: now,
      body:
        "Olá, {primeiro_nome}!\n\nO {grupo} volta a se reunir na {data}, às {hora}. Esperamos você!\nSe não puder comparecer, responda esta mensagem para avisarmos a equipe.\n\n{assinatura}",
    },
    {
      id: "tpl-custom",
      name: "Mensagem livre",
      category: "custom",
      active: true,
      updatedAt: now,
      body: "Olá, {primeiro_nome}! {mensagem}\n\n{assinatura}",
    },
  ];
}

export function emptyState(): AppState {
  const now = nowISOString();
  return {
    schemaVersion: 1,
    patients: [],
    careModels: defaultCareModels(),
    appointments: [],
    reminders: [],
    templates: defaultTemplates(),
    settings: defaultSettings(),
    audit: [],
    meta: { createdAt: now, updatedAt: now },
  };
}

export function demoState(): AppState {
  const now = nowISOString();
  const state = emptyState();
  state.patients = DEMO_PATIENTS.map((patient) => ({
    ...patient,
    createdAt: patient.createdAt || now,
    updatedAt: patient.updatedAt || now,
    notes: patient.notes ?? [],
    contactAttempts: patient.contactAttempts ?? [],
  }));
  state.settings = {
    ...state.settings,
    unitName: "Clínica da Família II",
    teamName: "Equipe de Saúde Mental",
    professionalName: "Dra. Marcela",
    professionalRole: "Psicóloga",
    onboarded: false,
    dayOverrides: [
      {
        date: addDays(todayISO(), 4),
        closed: true,
        reason: "Reunião de equipe e matriciamento ampliado",
      },
      {
        date: addDays(todayISO(), 8),
        closed: false,
        reason: "Capacitação: vagas reduzidas",
        capacity: { triage: 1, individual: 2 },
      },
    ],
  };
  state.reminders = [
    {
      id: "rem-demo-1",
      date: addDays(todayISO(), 1),
      time: "13:30",
      title: "Preparar material do grupo de crianças",
      notes: "Levar folhas, lápis de cor e o cronograma do encontro.",
      careModelId: "cm-group-children",
      done: false,
      createdAt: now,
    },
    {
      id: "rem-demo-2",
      date: addDays(todayISO(), 6),
      time: "08:00",
      title: "Revisar fila de matriciamento",
      notes: "Conferir prioritários e pacientes com mais de 30 dias de espera.",
      done: false,
      createdAt: now,
    },
  ];
  state.meta = { ...state.meta, seedSource: "demonstracao" };
  return state;
}

export function demoPatients(): Patient[] {
  return DEMO_PATIENTS;
}
