import type { AppState } from "../types";
import { newId } from "./id";

export interface SyncOp {
  opId: string;
  deviceId: string;
  docId: string;
  type: "put" | "del";
  baseVersion: number;
  baseOpId?: string;
  version: number;
  value: unknown;
  createdAt: string;
  resolves?: string[];
}

export interface SyncConflict {
  id: string;
  docId: string;
  localValue: unknown;
  remoteValue: unknown;
  localOpId?: string;
  remoteOpId: string;
  detectedAt: string;
  resolved?: boolean;
}

export interface SyncMeta {
  v: 1;
  app: "horizonte";
  deviceId: string;
  generation: number;
  lamport: number;
  ops: SyncOp[];
  appliedOpIds: string[];
  docVersions: Record<string, { version: number; opId: string }>;
  conflicts: SyncConflict[];
  lastSeenRemote: Record<string, number>;
  lastUploadHash: string;
  lastSyncAt?: string;
  lastError?: string;
}

export interface CloudPayload {
  v: 1;
  app: "horizonte";
  generation: number;
  deviceId: string;
  ops: SyncOp[];
  checksum: string;
}

export interface RemoteFile {
  id: string;
  name: string;
  modifiedTime: number;
  size: number;
}

export function createSyncMeta(): SyncMeta {
  return {
    v: 1,
    app: "horizonte",
    deviceId: crypto.randomUUID ? crypto.randomUUID() : newId("device"),
    generation: 0,
    lamport: 0,
    ops: [],
    appliedOpIds: [],
    docVersions: {},
    conflicts: [],
    lastSeenRemote: {},
    lastUploadHash: "",
  };
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function checksum(value: unknown): string {
  const text = canonical(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function docKey(prefix: string, id: string): string {
  return `${prefix}:${id}`;
}

/** Documentos sincronizados. Agendamentos automáticos são derivados e não sobem. */
export function docsFromState(state: AppState): Record<string, unknown> {
  const docs: Record<string, unknown> = {};
  for (const patient of state.patients) docs[docKey("patient", patient.id)] = patient;
  for (const model of state.careModels) docs[docKey("model", model.id)] = model;
  for (const appointment of state.appointments) {
    if (appointment.source === "auto" && appointment.status === "scheduled") continue;
    docs[docKey("appointment", appointment.id)] = appointment;
  }
  for (const reminder of state.reminders) docs[docKey("reminder", reminder.id)] = reminder;
  for (const template of state.templates) docs[docKey("template", template.id)] = template;
  docs["settings"] = state.settings;
  return docs;
}

function sameValue(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

export function recordLocalChanges(meta: SyncMeta, previous: AppState, next: AppState): SyncMeta {
  const before = docsFromState(previous);
  const after = docsFromState(next);
  let lamport = meta.lamport;
  const docVersions = { ...meta.docVersions };
  const ops = [...meta.ops];
  const createdAt = new Date().toISOString();
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const beforeValue = before[key];
    const afterValue = after[key];
    if (afterValue === undefined) {
      if (beforeValue === undefined) continue;
      const current = docVersions[key];
      lamport += 1;
      const op: SyncOp = {
        opId: newId("op"),
        deviceId: meta.deviceId,
        docId: key,
        type: "del",
        baseVersion: current?.version ?? 0,
        baseOpId: current?.opId,
        version: lamport,
        value: null,
        createdAt,
      };
      ops.push(op);
      docVersions[key] = { version: lamport, opId: op.opId };
      continue;
    }
    if (beforeValue !== undefined && sameValue(beforeValue, afterValue)) continue;
    const current = docVersions[key];
    lamport += 1;
    const op: SyncOp = {
      opId: newId("op"),
      deviceId: meta.deviceId,
      docId: key,
      type: "put",
      baseVersion: current?.version ?? 0,
      baseOpId: current?.opId,
      version: lamport,
      value: afterValue,
      createdAt,
    };
    ops.push(op);
    docVersions[key] = { version: lamport, opId: op.opId };
  }
  return {
    ...meta,
    lamport,
    ops,
    docVersions,
  };
}

/** Cria operações iniciais para documentos que ainda não têm versão conhecida. */
export function seedMissingDocs(meta: SyncMeta, state: AppState): SyncMeta {
  const docs = docsFromState(state);
  let lamport = meta.lamport;
  const docVersions = { ...meta.docVersions };
  const ops = [...meta.ops];
  const createdAt = new Date().toISOString();
  for (const [key, value] of Object.entries(docs)) {
    if (docVersions[key]) continue;
    lamport += 1;
    const op: SyncOp = {
      opId: newId("op"),
      deviceId: meta.deviceId,
      docId: key,
      type: "put",
      baseVersion: 0,
      version: lamport,
      value,
      createdAt,
    };
    ops.push(op);
    docVersions[key] = { version: lamport, opId: op.opId };
  }
  return { ...meta, lamport, ops, docVersions };
}

export function buildPayload(meta: SyncMeta): string {
  const body = {
    v: 1 as const,
    app: "horizonte" as const,
    generation: meta.generation,
    deviceId: meta.deviceId,
    ops: meta.ops,
  };
  const payload: CloudPayload = { ...body, checksum: checksum(body) };
  return JSON.stringify(payload);
}

export function parsePayload(text: string): CloudPayload | null {
  try {
    const value = JSON.parse(text) as CloudPayload;
    if (!value || value.v !== 1 || value.app !== "horizonte") return null;
    if (!Number.isInteger(value.generation) || value.generation < 0) return null;
    if (!value.deviceId || !Array.isArray(value.ops)) return null;
    const body = {
      v: value.v,
      app: value.app,
      generation: value.generation,
      deviceId: value.deviceId,
      ops: value.ops,
    };
    if (value.checksum !== checksum(body)) return null;
    for (const op of value.ops) {
      if (!op || !op.opId || !op.deviceId || !op.docId) return null;
      if (!Number.isInteger(op.version) || !Number.isInteger(op.baseVersion)) return null;
      if (op.type !== "put" && op.type !== "del") return null;
    }
    return value;
  } catch {
    return null;
  }
}

function stateFromDocs(base: AppState, docs: Record<string, unknown>): AppState {
  const patients = Object.entries(docs)
    .filter(([key]) => key.startsWith("patient:"))
    .map(([, value]) => value as AppState["patients"][number])
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const careModels = Object.entries(docs)
    .filter(([key]) => key.startsWith("model:"))
    .map(([, value]) => value as AppState["careModels"][number])
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const appointments = Object.entries(docs)
    .filter(([key]) => key.startsWith("appointment:"))
    .map(([, value]) => value as AppState["appointments"][number])
    .sort((a, b) => `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`));
  const reminders = Object.entries(docs)
    .filter(([key]) => key.startsWith("reminder:"))
    .map(([, value]) => value as AppState["reminders"][number])
    .sort((a, b) => `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`));
  const templates = Object.entries(docs)
    .filter(([key]) => key.startsWith("template:"))
    .map(([, value]) => value as AppState["templates"][number])
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return {
    ...base,
    patients,
    careModels: careModels.length ? careModels : base.careModels,
    appointments,
    reminders,
    templates: templates.length ? templates : base.templates,
    settings: (docs["settings"] as AppState["settings"]) ?? base.settings,
    meta: { ...base.meta, updatedAt: new Date().toISOString() },
  };
}

export interface MergeResult {
  meta: SyncMeta;
  state: AppState;
  applied: number;
  conflicts: number;
  newGeneration?: number;
}

export function mergePayloads(
  meta: SyncMeta,
  state: AppState,
  payloads: CloudPayload[],
): MergeResult {
  const docs = docsFromState(state);
  const docVersions = { ...meta.docVersions };
  const appliedOpIds = new Set(meta.appliedOpIds);
  const conflicts = [...meta.conflicts];
  let lamport = meta.lamport;
  let applied = 0;
  let newGeneration: number | undefined;

  // Processa em ordem causal. Sem isso, uma operação mais nova pode ser
  // aplicada antes da operação-base e gerar conflito artificial.
  const orderedOps = payloads
    .filter((payload) => payload.generation === meta.generation)
    .flatMap((payload) => payload.ops)
    .slice()
    .sort((a, b) => a.version - b.version || a.opId.localeCompare(b.opId));

  for (const payload of payloads) {
    if (payload.generation > meta.generation) {
      newGeneration = Math.max(newGeneration ?? 0, payload.generation);
    }
  }

  for (const op of orderedOps) {
    if (appliedOpIds.has(op.opId)) continue;
    if (op.deviceId === meta.deviceId) {
      appliedOpIds.add(op.opId);
      continue;
    }
    lamport = Math.max(lamport, op.version);
    const current = docVersions[op.docId];
    const currentVersion = current?.version ?? 0;
    const localValue = docs[op.docId];
    const sameValueAlready = op.type === "put"
      ? localValue !== undefined && sameValue(localValue, op.value)
      : localValue === undefined;
    // Primeiro login: documentos locais ainda não tinham versão conhecida.
    // Se o conteúdo remoto é idêntico, apenas incorpora a versão sem criar
    // um conflito artificial. Se é diferente, preserva as duas versões.
    if (op.baseVersion >= currentVersion || sameValueAlready) {
      if (!sameValueAlready || op.version > currentVersion) {
        if (op.type === "del") delete docs[op.docId];
        else docs[op.docId] = op.value;
        docVersions[op.docId] = { version: op.version, opId: op.opId };
      }
      appliedOpIds.add(op.opId);
      applied += 1;
    } else {
      const exists = conflicts.some(
        (conflict) => conflict.docId === op.docId && conflict.remoteOpId === op.opId,
      );
      if (!exists) {
        conflicts.push({
          id: newId("conflito"),
          docId: op.docId,
          localValue: localValue ?? null,
          remoteValue: op.value,
          localOpId: current?.opId,
          remoteOpId: op.opId,
          detectedAt: new Date().toISOString(),
        });
      }
      appliedOpIds.add(op.opId);
    }
  }

  return {
    meta: {
      ...meta,
      lamport,
      appliedOpIds: [...appliedOpIds],
      docVersions,
      conflicts,
    },
    state: stateFromDocs(state, docs),
    applied,
    conflicts: conflicts.length,
    newGeneration,
  };
}

export function resolveConflict(
  meta: SyncMeta,
  state: AppState,
  conflictId: string,
  choice: "local" | "remote",
): { meta: SyncMeta; state: AppState } {
  const conflict = meta.conflicts.find((item) => item.id === conflictId);
  if (!conflict) return { meta, state };
  const docs = docsFromState(state);
  const value = choice === "local" ? conflict.localValue : conflict.remoteValue;
  if (value === null || value === undefined) delete docs[conflict.docId];
  else docs[conflict.docId] = value;
  const lamport = meta.lamport + 1;
  const current = meta.docVersions[conflict.docId];
  const op: SyncOp = {
    opId: newId("op"),
    deviceId: meta.deviceId,
    docId: conflict.docId,
    type: value === null || value === undefined ? "del" : "put",
    baseVersion: current?.version ?? 0,
    baseOpId: current?.opId,
    version: lamport,
    value: value ?? null,
    createdAt: new Date().toISOString(),
    resolves: [conflict.localOpId ?? "", conflict.remoteOpId],
  };
  const conflicts = meta.conflicts.filter((item) => item.id !== conflictId);
  return {
    meta: {
      ...meta,
      lamport,
      ops: [...meta.ops, op],
      docVersions: { ...meta.docVersions, [conflict.docId]: { version: lamport, opId: op.opId } },
      conflicts,
    },
    state: stateFromDocs(state, docs),
  };
}

export function applyCloudGeneration(
  meta: SyncMeta,
  state: AppState,
  payloads: CloudPayload[],
  generation: number,
): MergeResult {
  const emptyMeta: SyncMeta = {
    ...createSyncMeta(),
    deviceId: meta.deviceId,
    generation,
    lastSeenRemote: meta.lastSeenRemote,
  };
  const baseState: AppState = {
    ...state,
    patients: [],
    appointments: [],
    reminders: [],
    audit: [],
  };
  const result = mergePayloads(emptyMeta, baseState, payloads.filter((payload) => payload.generation === generation));
  return {
    ...result,
    meta: { ...result.meta, generation, lastError: "Base local substituída pela geração mais nova da nuvem." },
  };
}

export function syncStatusLabel(meta: SyncMeta | null, signedIn: boolean, hasRemote: boolean): string {
  if (!signedIn) return "Desconectado";
  if (!meta) return "Conectando…";
  if (meta.conflicts.length > 0) return `${meta.conflicts.length} conflito(s)`;
  if (!hasRemote) return "Sem backup na nuvem";
  if (meta.lastSyncAt) return "Sincronizado";
  return "Aguardando sincronização";
}
