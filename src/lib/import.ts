import type { AppState, CareKind, CareModel, ISODate, Patient, PatientStatus } from "../types";
import { addDays, todayISO } from "./date";
import { newId } from "./id";
import { defaultCareModels } from "./defaults";

export interface ImportSummary {
  added: number;
  updated: number;
  skipped: number;
  createdModels: string[];
  warnings: string[];
}

export interface ImportResult {
  state: AppState;
  summary: ImportSummary;
}

function normalize(value: string): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function titleCase(value: string): string {
  const small = new Set(["de", "da", "do", "das", "dos", "e", "em", "a", "o"]);
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) => (index > 0 && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

export function parseDateBR(value: string | undefined): ISODate | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${year}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  return undefined;
}

function parseAge(value: string | undefined): number | undefined {
  const match = (value ?? "").match(/\d{1,3}/);
  if (!match) return undefined;
  const age = Number(match[0]);
  return Number.isFinite(age) && age >= 0 && age <= 120 ? age : undefined;
}

function cleanPhone(value: string | undefined): string | undefined {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits || undefined;
}

function inferKind(modelName: string): CareKind {
  const text = normalize(modelName);
  if (!text) return "triage";
  if (text.includes("triagem") || text.includes("matriciamento")) return "triage";
  if (text.includes("individual")) return "individual";
  if (text.includes("coletiv")) return "collective";
  if (text.includes("grupo") || text.includes("orientacao")) return "group";
  return "other";
}

function inferPriority(reason: string, observations: string): { priority: boolean; reason?: string } {
  const text = normalize(`${reason} ${observations}`);
  const triggers = [
    "gestante",
    "gestacao",
    "risco",
    "suicid",
    "autoagress",
    "automutil",
    "violencia",
    "abuso",
    "prioridade",
    "prioritario",
    "conselho tutelar",
  ];
  const found = triggers.find((trigger) => text.includes(trigger));
  return found ? { priority: true, reason: `Sinalizado na importação: ${found}` } : { priority: false };
}

function modelIdForName(models: CareModel[], name: string, created: string[]): string {
  const text = normalize(name);
  const existing = models.find((model) => normalize(model.name) === text);
  if (existing) return existing.id;
  const kind = inferKind(name);
  const id = `cm-import-${normalize(name).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || newId("modelo")}`;
  const model: CareModel = {
    id,
    name: titleCase(name),
    kind,
    slotType: kind === "triage" ? "triage" : kind === "individual" ? "individual" : kind === "collective" ? "collective" : "group",
    color: kind === "triage" ? "#b9684e" : kind === "individual" ? "#486b78" : kind === "collective" ? "#a97b32" : "#5b7a63",
    active: true,
    maxMembers: kind === "group" ? 15 : kind === "collective" ? 30 : undefined,
  };
  models.push(model);
  created.push(model.name);
  return id;
}

function resolveModel(
  state: AppState,
  modelName: string,
  triageDone: boolean,
  created: string[],
): string {
  const text = normalize(modelName);
  if (text.includes("grupo") || text.includes("orientacao") || text.includes("coletiv")) {
    return modelIdForName(state.careModels, modelName, created);
  }
  if (text.includes("individual")) return "cm-individual";
  if (text.includes("triagem") || text.includes("matriciamento")) return "cm-triage";
  if (text.includes("externo")) return modelIdForName(state.careModels, modelName, created);
  if (triageDone) return "cm-triage";
  return "cm-triage";
}

function statusFor(triageDate: ISODate | undefined, modelName: string): PatientStatus {
  if (triageDate) return "active";
  const text = normalize(modelName);
  if (text.includes("externo")) return "active";
  return "waiting_triage";
}

export function patientFromRow(
  state: AppState,
  row: Record<string, string>,
  createdModels: string[],
): Patient {
  const name = (row.name ?? "").trim();
  const registrationNumber = (row.registrationNumber ?? "").trim();
  const referralDate = parseDateBR(row.referralDate) ?? todayISO();
  const triageDate = parseDateBR(row.triageDate);
  const modelName = (row.careModel ?? "").trim();
  const careModelId = resolveModel(state, modelName, Boolean(triageDate), createdModels);
  const model = state.careModels.find((item) => item.id === careModelId);
  const priority = inferPriority(row.referralReason ?? "", row.observations ?? "");
  const now = new Date().toISOString();
  const displayName = name ? (name === name.toUpperCase() ? titleCase(name) : name) : "Paciente sem nome";
  return {
    id: newId("pac"),
    name: displayName,
    registrationNumber,
    age: parseAge(row.age),
    phone: cleanPhone(row.phone),
    noWhatsapp: !cleanPhone(row.phone),
    phoneNote: !cleanPhone(row.phone) ? "Telefone não informado na importação." : undefined,
    referralDate,
    referralReason: (row.referralReason ?? "").trim(),
    referringTeam: (row.referringTeam ?? "").trim(),
    triageDate,
    careModelId,
    status: statusFor(triageDate, modelName),
    priority: priority.priority,
    priorityReason: priority.reason,
    recurrence: model?.kind === "group" || model?.kind === "collective" ? "weekly" : "none",
    preferredWeekday: model?.schedule?.weekday,
    observations: (row.observations ?? "").trim(),
    notes: [],
    contactAttempts: [],
    createdAt: now,
    updatedAt: now,
    source: "importacao-planilha",
  };
}

const COLUMN_ALIASES: Record<string, keyof ImportRow> = {
  nome: "name",
  paciente: "name",
  "nome do paciente": "name",
  cadastro: "registrationNumber",
  "numero de cadastro": "registrationNumber",
  "n de cadastro": "registrationNumber",
  matricula: "registrationNumber",
  idade: "age",
  telefone: "phone",
  celular: "phone",
  contato: "phone",
  "data de encaminhamento": "referralDate",
  encaminhamento: "referralDate",
  "data encaminhamento": "referralDate",
  motivo: "referralReason",
  "motivo do encaminhamento": "referralReason",
  equipe: "referringTeam",
  "equipe de saude": "referringTeam",
  "equipe que encaminhou": "referringTeam",
  "data de triagem": "triageDate",
  triagem: "triageDate",
  modelo: "careModel",
  "modelo de atendimento": "careModel",
  observacoes: "observations",
  observacao: "observations",
  obs: "observations",
  "obs:": "observations",
  f: "name",
};

interface ImportRow {
  name: string;
  registrationNumber: string;
  age: string;
  phone: string;
  referralDate: string;
  referralReason: string;
  referringTeam: string;
  triageDate: string;
  careModel: string;
  observations: string;
}

function emptyRow(): ImportRow {
  return {
    name: "",
    registrationNumber: "",
    age: "",
    phone: "",
    referralDate: "",
    referralReason: "",
    referringTeam: "",
    triageDate: "",
    careModel: "",
    observations: "",
  };
}

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  if (first.includes("\t")) return "\t";
  if ((first.match(/;/g) ?? []).length > (first.match(/,/g) ?? []).length) return ";";
  return ",";
}

function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === "\t") return line.split("\t");
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export function parseTable(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) return [];
  const delimiter = detectDelimiter(clean);
  const lines = clean.split(/\r?\n/).filter((line) => line.trim());
  const firstCells = splitLine(lines[0], delimiter).map((cell) => normalize(cell));
  const hasHeader = firstCells.some((cell) => COLUMN_ALIASES[cell] !== undefined) ||
    firstCells.some((cell) => ["nome", "cadastro", "idade", "telefone"].includes(cell));
  const hasNameColumn = firstCells.some((cell) => COLUMN_ALIASES[cell] === "name");
  const rows: Record<string, string>[] = [];
  const start = hasHeader ? 1 : 0;
  for (let i = start; i < lines.length; i += 1) {
    const cells = splitLine(lines[i], delimiter);
    const row = emptyRow() as unknown as Record<string, string>;
    if (hasHeader) {
      firstCells.forEach((header, index) => {
        const key = COLUMN_ALIASES[header] ?? (!hasNameColumn && index === 0 ? "name" : undefined);
        if (key) row[key] = (cells[index] ?? "").trim();
      });
    } else {
      const keys: Array<keyof ImportRow> = [
        "name",
        "registrationNumber",
        "age",
        "phone",
        "referralDate",
        "referralReason",
        "referringTeam",
        "triageDate",
        "careModel",
        "observations",
      ];
      keys.forEach((key, index) => {
        row[key] = (cells[index] ?? "").trim();
      });
    }
    if (Object.values(row).some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

function patientKey(patient: Patient): string {
  return normalize(patient.registrationNumber) || normalize(patient.name);
}

export function mergePatients(
  state: AppState,
  incoming: Patient[],
): ImportResult {
  const summary: ImportSummary = {
    added: 0,
    updated: 0,
    skipped: 0,
    createdModels: [],
    warnings: [],
  };
  const patients = [...state.patients];
  const byKey = new Map(patients.map((patient) => [patientKey(patient), patient]));
  for (const patient of incoming) {
    if (!patient.name || patient.name === "Paciente sem nome") {
      summary.skipped += 1;
      continue;
    }
    const key = patientKey(patient);
    const existing = byKey.get(key);
    if (existing) {
      const index = patients.findIndex((item) => item.id === existing.id);
      patients[index] = {
        ...patient,
        id: existing.id,
        notes: existing.notes,
        contactAttempts: existing.contactAttempts,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      summary.updated += 1;
    } else {
      patients.push(patient);
      byKey.set(key, patient);
      summary.added += 1;
    }
  }
  return {
    state: {
      ...state,
      patients,
      meta: {
        ...state.meta,
        updatedAt: new Date().toISOString(),
        seedSource: state.meta.seedSource === "demonstracao" ? undefined : state.meta.seedSource,
      },
    },
    summary,
  };
}

export function importFromTable(state: AppState, text: string): ImportResult {
  const rows = parseTable(text);
  const createdModels: string[] = [];
  const working: AppState = {
    ...state,
    careModels: state.careModels.length ? [...state.careModels] : defaultCareModels(),
  };
  const patients = rows.map((row) => patientFromRow(working, row, createdModels));
  const result = mergePatients(working, patients);
  result.summary.createdModels = createdModels;
  if (rows.length === 0) result.summary.warnings.push("Nenhuma linha reconhecida. Confira o cabeçalho ou as colunas A–J.");
  return result;
}

export function importFromJson(state: AppState, text: string, mode: "merge" | "replace"): ImportResult {
  const parsed = JSON.parse(text) as unknown;
  const payload = parsed as Partial<AppState> & { patients?: Patient[] };
  const createdModels: string[] = [];
  if (!payload || typeof payload !== "object") {
    throw new Error("O arquivo não contém um objeto JSON válido.");
  }
  let base = mode === "replace" ? { ...state, patients: [], appointments: [], reminders: [] } : state;
  if (Array.isArray(payload.careModels) && payload.careModels.length > 0) {
    const models = [...(base.careModels ?? [])];
    for (const model of payload.careModels) {
      if (!models.some((item) => item.id === model.id || normalize(item.name) === normalize(model.name))) {
        models.push(model);
        createdModels.push(model.name);
      }
    }
    base = { ...base, careModels: models };
  }
  if (payload.settings && typeof payload.settings === "object" && !Array.isArray(payload.settings)) {
    base = { ...base, settings: { ...base.settings, ...payload.settings } };
  }
  if (Array.isArray(payload.templates) && payload.templates.length > 0) {
    const templates = [...base.templates];
    for (const template of payload.templates) {
      if (!templates.some((item) => item.id === template.id)) templates.push(template);
    }
    base = { ...base, templates };
  }
  if (!Array.isArray(payload.patients)) {
    throw new Error("O JSON precisa conter uma lista de pacientes.");
  }
  const patients = payload.patients.map((patient) => {
    const copy: Patient = {
      ...patient,
      id: patient.id || newId("pac"),
      notes: patient.notes ?? [],
      contactAttempts: patient.contactAttempts ?? [],
      noWhatsapp: patient.noWhatsapp ?? !patient.phone,
      recurrence: patient.recurrence ?? "none",
      status: patient.status ?? (patient.triageDate ? "active" : "waiting_triage"),
      priority: patient.priority ?? false,
      createdAt: patient.createdAt ?? new Date().toISOString(),
      updatedAt: patient.updatedAt ?? new Date().toISOString(),
    };
    if (!copy.careModelId && copy.triageDate) copy.careModelId = "cm-triage";
    if (!copy.careModelId && !copy.triageDate) copy.careModelId = "cm-triage";
    return copy;
  });
  if (mode === "replace") {
    base = {
      ...base,
      patients: [],
      appointments: Array.isArray(payload.appointments) ? payload.appointments : [],
      reminders: Array.isArray(payload.reminders) ? payload.reminders : [],
      audit: Array.isArray(payload.audit) ? payload.audit : [],
    };
  }
  const result = mergePatients(base, patients);
  result.summary.createdModels = createdModels;
  return result;
}

export function exportPatientsCsv(state: AppState): string {
  const header = [
    "Nome",
    "Cadastro",
    "Idade",
    "Telefone",
    "Data de encaminhamento",
    "Motivo",
    "Equipe",
    "Data de triagem",
    "Modelo",
    "Observações",
    "Prioritário",
    "Sem WhatsApp",
    "Status",
  ];
  const rows = state.patients.map((patient) => {
    const model = state.careModels.find((item) => item.id === patient.careModelId);
    return [
      patient.name,
      patient.registrationNumber,
      patient.age ?? "",
      patient.phone ?? "",
      patient.referralDate,
      patient.referralReason,
      patient.referringTeam,
      patient.triageDate ?? "",
      model?.name ?? "",
      patient.observations ?? "",
      patient.priority ? "Sim" : "Não",
      patient.noWhatsapp ? "Sim" : "Não",
      patient.status,
    ];
  });
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map(escape).join(";")).join("\r\n");
}

export function demoImportJson(state: AppState): string {
  return JSON.stringify(
    {
      app: "horizonte-de-cuidado",
      version: 1,
      exportedAt: new Date().toISOString(),
      patients: state.patients,
      careModels: state.careModels,
      settings: state.settings,
      templates: state.templates,
    },
    null,
    2,
  );
}

export function nextDays(count: number, from: ISODate = todayISO()): ISODate[] {
  return Array.from({ length: count }, (_, index) => addDays(from, index));
}
