import type { AppState } from "../types";
import { newId } from "./id";

/**
 * Sincronização por operações — modelo v2 (portado do Caderno de Cuidado):
 * - meta.ops é a UNIÃO de todas as operações já vistas (locais + remotas),
 *   então cada payload enviado carrega o histórico completo do dispositivo;
 * - recomputeOps reconstrói cabeças e conflitos de forma determinística
 *   (ordem por contador lógico e, no empate, por opId — nunca relógio);
 * - divergência com ancestral comum é mesclada campo a campo (amMerge):
 *   só um lado mexeu → vale esse lado; os dois mexeram → Lamport maior
 *   vence, com opId de desempate; exclusão vence edição (tombstone);
 *   itens com id (listas) são unidos. A resolução vira operação com
 *   "resolves" e o histórico continua completo — a tela manual fica para
 *   o caso raro (valores escalares). Sem ancestral armazenado (conflitos
 *   legados da migração v1), um lado vence inteiro pelo opId.
 */

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
  localVersion: number;
  remoteVersion: number;
  localDeleted: boolean;
  remoteDeleted: boolean;
  /** Operação remota completa quando conhecida (conflitos derivados do recompute). */
  remoteOp: SyncOp | null;
  detectedAt: string;
}

export interface SyncHead {
  opId: string;
  deviceId: string;
  version: number;
  deleted: boolean;
  value: unknown;
}

export interface SyncMeta {
  v: 2;
  app: "horizonte";
  deviceId: string;
  generation: number;
  lamport: number;
  /** União de todas as operações conhecidas (locais + remotas). */
  ops: SyncOp[];
  /** Derivado das cabeças (recompute); usado para encadear novas edições locais. */
  docVersions: Record<string, { version: number; opId: string }>;
  conflicts: SyncConflict[];
  /**
   * Documentos cujo valor atual passou a vir da nuvem na migração v1→v2
   * (vencedor por opId). seedMissingDocs não deve ressuscitar o estado
   * obsoleto desses documentos; limpo no primeiro merge que materializa.
   */
  adoptedDocs?: string[];
  lastSeenRemote: Record<string, number>;
  lastUploadHash: string;
  lastSyncAt?: string;
  lastError?: string;
}

export interface CloudPayload {
  v: 2;
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
    v: 2,
    app: "horizonte",
    deviceId: crypto.randomUUID ? crypto.randomUUID() : newId("device"),
    generation: 0,
    lamport: 0,
    ops: [],
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

// ---------------------------------------------------------------- modelo --

export function validOp(op: unknown): op is SyncOp {
  if (!op || typeof op !== "object") return false;
  const value = op as SyncOp;
  if (typeof value.opId !== "string" || !value.opId) return false;
  if (typeof value.deviceId !== "string" || !value.deviceId) return false;
  if (typeof value.docId !== "string" || !value.docId) return false;
  if (value.type !== "put" && value.type !== "del") return false;
  if (!Number.isInteger(value.version) || !Number.isInteger(value.baseVersion)) return false;
  if (value.createdAt !== undefined && typeof value.createdAt !== "string") return false;
  if (value.resolves !== undefined) {
    if (!Array.isArray(value.resolves)) return false;
    if (value.resolves.some((item) => typeof item !== "string")) return false;
  }
  return true;
}

function headFromOp(op: SyncOp): SyncHead {
  return {
    opId: op.opId,
    deviceId: op.deviceId,
    version: op.version,
    deleted: op.type === "del",
    value: op.type === "del" ? null : op.value,
  };
}

function isAncestor(ancestorId: string, headId: string, byId: Record<string, SyncOp>): boolean {
  let guard = 0;
  let current: SyncOp | null | undefined = byId[headId];
  while (current && guard++ < 5000) {
    if (current.opId === ancestorId) return true;
    current = current.baseOpId ? byId[current.baseOpId] : null;
  }
  return false;
}

function addConflict(conflicts: SyncConflict[], docId: string, head: SyncHead, op: SyncOp): void {
  if (conflicts.some((conflict) => conflict.docId === docId && conflict.remoteOpId === op.opId)) return;
  conflicts.push({
    id: `conflito:${docId}:${op.opId}`,
    docId,
    localValue: head.deleted ? null : head.value,
    remoteValue: op.type === "del" ? null : op.value,
    localOpId: head.opId,
    remoteOpId: op.opId,
    localVersion: head.version,
    remoteVersion: op.version,
    localDeleted: head.deleted,
    remoteDeleted: op.type === "del",
    remoteOp: op,
    detectedAt: op.createdAt || new Date().toISOString(),
  });
}

// Remove apenas os conflitos que a operação de resolução realmente encerrou.
// Uma terceira ramificação do mesmo documento continua visível (com o lado
// local atualizado para a nova cabeça).
function dropResolvedConflicts(
  conflicts: SyncConflict[],
  docId: string,
  resolvedIds: string[],
  newHead: SyncHead,
): void {
  const keep: SyncConflict[] = [];
  for (const conflict of conflicts) {
    if (conflict.docId !== docId) {
      keep.push(conflict);
      continue;
    }
    if (resolvedIds.includes(conflict.remoteOpId)) continue;
    if (conflict.localOpId && resolvedIds.includes(conflict.localOpId)) {
      if (newHead.opId === conflict.remoteOpId) continue;
      keep.push({
        ...conflict,
        localOpId: newHead.opId,
        localVersion: newHead.version,
        localDeleted: newHead.deleted,
        localValue: newHead.deleted ? null : newHead.value,
      });
      continue;
    }
    keep.push(conflict);
  }
  conflicts.splice(0, conflicts.length, ...keep);
}

/**
 * Reconstrói cabeças e conflitos a partir de TODAS as operações. A ordem é
 * por contador lógico e, no empate, por opId (nunca pelo relógio). Uma
 * operação de resolução (resolves: [opA, opB]) encerra o conflito e vira a
 * cabeça, mesmo em outro aparelho que ainda estava na outra ramificação.
 */
export function recomputeOps(ops: SyncOp[]): {
  heads: Record<string, SyncHead>;
  conflicts: SyncConflict[];
} {
  const all = ops
    .filter(validOp)
    .slice()
    .sort((a, b) => a.version - b.version || (a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0));
  const heads: Record<string, SyncHead> = {};
  const conflicts: SyncConflict[] = [];
  const byId: Record<string, SyncOp> = {};
  for (const op of all) byId[op.opId] = op;
  for (const op of all) {
    const head = heads[op.docId];
    if (!head) {
      heads[op.docId] = headFromOp(op);
      continue;
    }
    if (head.opId === op.opId) continue;
    if (op.resolves && op.resolves.length > 0) {
      const resolvesHead = op.resolves.includes(head.opId);
      const nextHead = resolvesHead ? headFromOp(op) : head;
      if (resolvesHead) heads[op.docId] = nextHead;
      dropResolvedConflicts(conflicts, op.docId, op.resolves, nextHead);
      continue;
    }
    if (isAncestor(op.opId, head.opId, byId)) continue;
    if (op.baseOpId && op.baseOpId === head.opId) {
      heads[op.docId] = headFromOp(op);
      continue;
    }
    // Mesma alteração em outro aparelho: idempotente.
    if (op.type === (head.deleted ? "del" : "put") && sameValue(op.value, head.value)) continue;
    // Concorrência real ou base desatualizada: preserva as duas versões.
    addConflict(conflicts, op.docId, head, op);
  }
  return { heads, conflicts };
}

function docVersionsFromHeads(heads: Record<string, SyncHead>): SyncMeta["docVersions"] {
  const versions: SyncMeta["docVersions"] = {};
  for (const [docId, head] of Object.entries(heads)) {
    versions[docId] = { version: head.version, opId: head.opId };
  }
  return versions;
}

function headsFingerprint(heads: Record<string, SyncHead>): string {
  return Object.keys(heads)
    .sort()
    .map((key) => {
      const head = heads[key];
      return `${key}:${head.opId}:${head.version}:${head.deleted ? 1 : 0}:${canonical(head.value)}`;
    })
    .join("|");
}

// ------------------------------------------- mesclagem automática (amMerge) --

function amCanonLoose(value: unknown): string {
  if (Array.isArray(value)) {
    const parts = value.map(amCanonLoose);
    parts.sort();
    return `[${parts.join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const key of Object.keys(record).sort()) out[key] = amCanonLoose(record[key]);
    return JSON.stringify(out);
  }
  return JSON.stringify(value === undefined ? null : value);
}

function amEq(a: unknown, b: unknown): boolean {
  return amCanonLoose(a) === amCanonLoose(b);
}

/** Identificador estável de um item de lista: campo id, ou chave derivada. */
function amIdOf(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  if (typeof record.id === "string" && record.id) return record.id;
  const date = typeof record.date === "string" ? record.date : "";
  const professional = typeof record.professional === "string" ? record.professional : "";
  const kind = record.kind ?? record.status ?? "";
  const composite = `${date}|${professional}|${typeof kind === "string" ? kind : JSON.stringify(kind)}`;
  return date || professional || kind ? composite : null;
}

function findMergeBase(
  local: SyncOp | null,
  remote: SyncOp | null,
  byId: Record<string, SyncOp>,
): unknown {
  if (!local || !remote) return undefined;
  const seen: Record<string, true> = {};
  let guard = 0;
  let current: SyncOp | null = remote;
  while (current && guard++ < 5000) {
    seen[current.opId] = true;
    current = current.baseOpId ? byId[current.baseOpId] ?? null : null;
  }
  guard = 0;
  current = local;
  while (current && guard++ < 5000) {
    if (seen[current.opId]) return current.type === "del" ? null : current.value ?? null;
    current = current.baseOpId ? byId[current.baseOpId] ?? null : null;
  }
  return undefined;
}

/**
 * Mescla campo a campo contra a base comum. `aWins` decide os campos em que
 * os dois lados mudaram (Lamport maior vence; empate resolve por opId) e é
 * fixo para a mesclagem inteira — sem base comum, um lado vinte inteiro.
 */
function amMerge(base: unknown, a: unknown, b: unknown, aWins: boolean): unknown {
  if (amEq(a, b)) return a;
  const baseObj = base && typeof base === "object" && !Array.isArray(base) ? (base as Record<string, unknown>) : null;
  const has = (source: unknown, key: string) =>
    !!source && typeof source === "object" && Object.prototype.hasOwnProperty.call(source, key);
  if (
    a && b && typeof a === "object" && typeof b === "object" &&
    !Array.isArray(a) && !Array.isArray(b)
  ) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys: Record<string, true> = {};
    const sources: Array<Record<string, unknown>> = [baseObj ?? {}, aObj, bObj];
    for (const source of sources) {
      for (const key of Object.keys(source)) keys[key] = true;
    }
    for (const key of Object.keys(keys)) {
      const hasBase = !!(baseObj && Object.prototype.hasOwnProperty.call(baseObj, key));
      const baseValue = hasBase ? baseObj[key] : undefined;
      const aHas = has(aObj, key);
      const bHas = has(bObj, key);
      const aValue = aHas ? aObj[key] : undefined;
      const bValue = bHas ? bObj[key] : undefined;
      if (hasBase && amEq(aValue, baseValue)) {
        if (bHas) out[key] = bValue;
      } else if (hasBase && amEq(bValue, baseValue)) {
        if (aHas) out[key] = aValue;
      } else if (!hasBase && aHas && !bHas) {
        out[key] = aValue; // campo novo, só o lado a tem: adição entra
      } else if (!hasBase && bHas && !aHas) {
        out[key] = bValue; // campo novo, só o lado b tem: adição entra
      } else if (
        aValue && bValue && typeof aValue === "object" && typeof bValue === "object" &&
        Array.isArray(aValue) === Array.isArray(bValue)
      ) {
        out[key] = amMerge(baseValue, aValue, bValue, aWins);
      } else if (aWins) {
        if (aHas) out[key] = aValue;
      } else if (bHas) {
        out[key] = bValue;
      }
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const baseArr = Array.isArray(base) ? base : [];
    const probe = [...a, ...b, ...baseArr];
    const hasIds = probe.some((item) => amIdOf(item) !== null);
    if (hasIds) {
      const mapOf = (list: unknown[]) => {
        const map: Record<string, unknown> = {};
        for (const item of list) {
          const id = amIdOf(item);
          if (id !== null) map[id] = item;
        }
        return map;
      };
      const mapA = mapOf(a);
      const mapB = mapOf(b);
      const mapBase = mapOf(baseArr);
      const ids: Record<string, true> = {};
      for (const map of [mapBase, mapA, mapB]) {
        for (const id of Object.keys(map)) ids[id] = true;
      }
      // Ordem: lado a primeiro, itens novos do lado b entram ao final.
      const order: unknown[] = [...a];
      for (const item of b) {
        const id = amIdOf(item);
        if (id === null || !order.some((existing) => amIdOf(existing) === id)) order.push(item);
      }
      const out: unknown[] = [];
      for (const item of order) {
        const id = amIdOf(item);
        if (id === null) {
          out.push(item);
          continue;
        }
        const inA = Object.prototype.hasOwnProperty.call(mapA, id) ? mapA[id] : null;
        const inB = Object.prototype.hasOwnProperty.call(mapB, id) ? mapB[id] : null;
        const inBase = Object.prototype.hasOwnProperty.call(mapBase, id) ? mapBase[id] : null;
        if (inA && inB) {
          const mergedItem = amMerge(inBase, inA, inB, aWins);
          if (mergedItem) out.push(mergedItem);
        } else if (inA && !inB && inBase) {
          // o lado b removeu o item: exclusão vence
        } else if (inB && !inA && inBase) {
          // o lado a removeu o item: exclusão vence
        } else if (inA) {
          out.push(inA);
        } else if (inB) {
          out.push(inB);
        }
      }
      return out;
    }
    if (amEq(a, base)) return b;
    if (amEq(b, base)) return a;
    return aWins ? a : b;
  }
  return aWins ? a : b;
}

/**
 * Constrói a operação que resolve um conflito por mesclagem automática.
 * Sem base comum, tenta o valor do pai imediato de cada lado. Valores
 * escalares não são mesclados (retorno null → fica para a decisão manual).
 */
function buildResolutionOp(
  conflict: SyncConflict,
  heads: Record<string, SyncHead>,
  ops: SyncOp[],
  lamport: number,
  deviceId: string,
): SyncOp | null {
  const byId: Record<string, SyncOp> = {};
  for (const op of ops) if (validOp(op)) byId[op.opId] = op;
  let localOpId = conflict.localOpId ?? "";
  let localVersion = conflict.localVersion;
  let localValue = conflict.localValue;
  let localDeleted = conflict.localDeleted;
  const current = heads[conflict.docId];
  if (current && current.opId && current.opId !== localOpId && !current.deleted) {
    // A cabeça avançou desde o registro do conflito (outra ramificação já
    // resolvida): mescla contra ela para não descartar a terceira edição.
    localOpId = current.opId;
    localVersion = current.version;
    localDeleted = false;
    localValue = current.value;
  }
  const remoteOp = (conflict.remoteOp && validOp(conflict.remoteOp) ? conflict.remoteOp : null)
    ?? (conflict.remoteOpId ? byId[conflict.remoteOpId] ?? null : null);
  const remoteVersion = remoteOp ? remoteOp.version : conflict.remoteVersion;
  const remoteValue = remoteOp ? (remoteOp.type === "del" ? null : remoteOp.value) : conflict.remoteValue;
  const aWins =
    localVersion > remoteVersion ||
    (localVersion === remoteVersion && localOpId > conflict.remoteOpId);
  const localOp = localOpId ? byId[localOpId] ?? null : null;
  const localDel = localDeleted || localOp?.type === "del";
  const remoteDel = remoteOp ? remoteOp.type === "del" : conflict.remoteDeleted;
  let base = findMergeBase(localOp, remoteOp, byId);
  if (!base && localOp?.baseOpId) {
    const parent = byId[localOp.baseOpId];
    if (parent && parent.type === "put") base = parent.value ?? null;
  }
  if (!base && remoteOp?.baseOpId) {
    const parent = byId[remoteOp.baseOpId];
    if (parent && parent.type === "put") base = parent.value ?? null;
  }
  let type: "put" | "del";
  let value: unknown;
  if (localDel || remoteDel) {
    type = "del";
    value = null;
  } else {
    type = "put";
    value = amMerge(base ?? null, localValue, remoteValue, aWins);
    if (!value || typeof value !== "object") return null;
  }
  const baseVersion = Math.max(localVersion, remoteVersion);
  const version = Math.max(lamport, baseVersion) + 1;
  return {
    opId: newId("op"),
    deviceId,
    docId: conflict.docId,
    type,
    baseVersion,
    baseOpId: localOpId || undefined,
    resolves: [localOpId, conflict.remoteOpId],
    version,
    value,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Auto-resolução: processa conflitos em fila; cada resolução vira operação
 * e o recompute roda de novo (o próximo conflito já enxerga a nova cabeça).
 * Caso raro não mesclável (escalar) interrompe o loop e fica para a tela.
 */
function convergeOps(
  ops: SyncOp[],
  lamport: number,
  deviceId: string,
): { ops: SyncOp[]; lamport: number; heads: Record<string, SyncHead>; conflicts: SyncConflict[] } {
  let current = ops;
  let currentLamport = lamport;
  for (const op of current) currentLamport = Math.max(currentLamport, op.version);
  let state = recomputeOps(current);
  let guard = current.length + 10;
  while (state.conflicts.length > 0 && guard-- > 0) {
    const op = buildResolutionOp(state.conflicts[0], state.heads, current, currentLamport, deviceId);
    if (!op) break;
    current = [...current, op];
    currentLamport = Math.max(currentLamport, op.version);
    state = recomputeOps(current);
  }
  return { ops: current, lamport: currentLamport, heads: state.heads, conflicts: state.conflicts };
}

// ------------------------------------------------------------- registro local --

export function recordLocalChanges(meta: SyncMeta, previous: AppState, next: AppState): SyncMeta {
  const before = docsFromState(previous);
  const after = docsFromState(next);
  let lamport = meta.lamport;
  const docVersions: SyncMeta["docVersions"] = { ...meta.docVersions };
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

/**
 * Cria operações para documentos do estado que ainda não têm cabeça no
 * histórico (primeira execução, migração v1). Encadeia da cabeça conhecida
 * (ou da versão legada em docVersions) para não gerar conflito artificial
 * quando a operação remota correspondente chegar da nuvem.
 */
export function seedMissingDocs(meta: SyncMeta, state: AppState): SyncMeta {
  const { heads } = recomputeOps(meta.ops);
  const docs = docsFromState(state);
  const adopted = new Set(meta.adoptedDocs ?? []);
  let lamport = meta.lamport;
  const ops = [...meta.ops];
  const createdAt = new Date().toISOString();
  for (const [key, value] of Object.entries(docs)) {
    const head = heads[key];
    if (head && sameValue(head.value, value)) continue;
    // Estado obsoleto de conflito legado: o valor da nuvem vence e será
    // materializado; semear o estado antigo ressuscitaria o lado perdedor.
    if (adopted.has(key) && head) continue;
    const knownVersion = head?.version ?? meta.docVersions[key]?.version ?? 0;
    const baseOpId = head?.opId ?? meta.docVersions[key]?.opId;
    lamport = Math.max(lamport, knownVersion) + 1;
    const op: SyncOp = {
      opId: newId("op"),
      deviceId: meta.deviceId,
      docId: key,
      type: "put",
      baseVersion: knownVersion,
      baseOpId,
      version: lamport,
      value,
      createdAt,
    };
    ops.push(op);
  }
  return { ...meta, lamport, ops };
}

// ------------------------------------------------------------------ payload --

export function buildPayload(meta: SyncMeta): string {
  const body = {
    v: 2 as const,
    app: "horizonte" as const,
    generation: meta.generation,
    deviceId: meta.deviceId,
    ops: meta.ops,
  };
  const payload: CloudPayload = { ...body, checksum: checksum(body) };
  return JSON.stringify(payload);
}

/**
 * Aceita payload v2 (histórico-união) e payload v1 (aparelho ainda na
 * versão antiga, cujas ops têm a mesma semântica). Rejeita adulteração
 * pelo checksum.
 */
export function parsePayload(text: string): CloudPayload | null {
  try {
    const value = JSON.parse(text) as {
      v?: unknown;
      app?: unknown;
      generation?: unknown;
      deviceId?: unknown;
      ops?: unknown;
      checksum?: unknown;
    };
    if (!value || typeof value !== "object") return null;
    if (value.v !== 1 && value.v !== 2) return null;
    if (value.app !== "horizonte") return null;
    const generation = value.generation;
    if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 0) return null;
    if (typeof value.deviceId !== "string" || !value.deviceId) return null;
    if (!Array.isArray(value.ops)) return null;
    const body = {
      v: value.v,
      app: value.app,
      generation,
      deviceId: value.deviceId,
      ops: value.ops,
    };
    if (value.checksum !== checksum(body)) return null;
    for (const op of value.ops) {
      if (!validOp(op)) return null;
    }
    return { ...body, v: 2, checksum: value.checksum as string } as CloudPayload;
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

function stateFromHeads(base: AppState, heads: Record<string, SyncHead>): AppState {
  const docs: Record<string, unknown> = {};
  for (const [key, head] of Object.entries(heads)) {
    if (head.deleted) continue;
    if (head.value === null || head.value === undefined) continue;
    docs[key] = head.value;
  }
  return stateFromDocs(base, docs);
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
  // 1. Documentos locais sem cabeça entram no histórico como operações.
  const seeded = seedMissingDocs(meta, state);

  // 2. Geração mais nova (nuvem reiniciada): nunca aplica sem decisão.
  let newGeneration: number | undefined;
  for (const payload of payloads) {
    if (payload.generation > seeded.generation) {
      newGeneration = Math.max(newGeneration ?? 0, payload.generation);
    }
  }
  if (newGeneration !== undefined) {
    return {
      meta: seeded,
      state,
      applied: 0,
      conflicts: seeded.conflicts.length,
      newGeneration,
    };
  }

  // 3. União: operações remotas da mesma geração que ainda não existem aqui.
  const known = new Set(seeded.ops.map((op) => op.opId));
  const fresh = payloads
    .filter((payload) => payload.generation === seeded.generation)
    .flatMap((payload) => payload.ops)
    .filter((op) => validOp(op) && !known.has(op.opId));

  const before = headsFingerprint(recomputeOps(seeded.ops).heads);
  const converged = convergeOps([...seeded.ops, ...fresh], seeded.lamport, seeded.deviceId);
  const after = headsFingerprint(converged.heads);
  const applied = fresh.length > 0 && before !== after ? fresh.length : 0;

  return {
    meta: {
      ...seeded,
      ops: converged.ops,
      lamport: converged.lamport,
      docVersions: docVersionsFromHeads(converged.heads),
      conflicts: converged.conflicts,
      adoptedDocs: undefined,
    },
    state: stateFromHeads(state, converged.heads),
    applied,
    conflicts: converged.conflicts.length,
  };
}

// ---------------------------------------------------------------- migração --

/**
 * Converte metadados da v1 (ops só locais, conflitos aguardando decisão)
 * para a v2 (histórico-união). Os conflitos legados não têm a operação
 * remota armazenada: por decisão do usuário, um lado vence inteiro pelo
 * opId (regra determinística do modelo — os dois aparelhos chegam ao
 * mesmo vencedor). O lado perdedor é marcado em adoptedDocs para o
 * materialize adotar o valor vencedor sem o seed ressuscitar o antigo.
 */
export function migrateMeta(raw: unknown): SyncMeta {
  if (
    raw && typeof raw === "object" &&
    (raw as SyncMeta).v === 2 &&
    Array.isArray((raw as SyncMeta).ops)
  ) {
    return raw as SyncMeta;
  }
  const legacy = (raw ?? {}) as Partial<SyncMeta> & { appliedOpIds?: unknown };
  const deviceId = legacy.deviceId ?? (crypto.randomUUID ? crypto.randomUUID() : newId("device"));
  const ops: SyncOp[] = [];
  for (const op of Array.isArray(legacy.ops) ? legacy.ops : []) {
    if (validOp(op)) ops.push(op);
  }
  let lamport = Number.isInteger(legacy.lamport) ? Math.max(legacy.lamport ?? 0, 0) : 0;
  for (const op of ops) lamport = Math.max(lamport, op.version);
  const legacyVersions: SyncMeta["docVersions"] = { ...(legacy.docVersions ?? {}) };
  const legacyConflicts = Array.isArray(legacy.conflicts) ? legacy.conflicts : [];
  const adopted: string[] = [];
  let { heads } = recomputeOps(ops);
  const createdAt = new Date().toISOString();
  for (const rawConflict of legacyConflicts) {
    const conflict = (rawConflict ?? {}) as Partial<SyncConflict> & {
      localValue?: unknown;
      remoteValue?: unknown;
    };
    const docId = conflict.docId;
    const remoteOpId = conflict.remoteOpId;
    if (typeof docId !== "string" || !docId) continue;
    if (typeof remoteOpId !== "string" || !remoteOpId) continue;
    const head = heads[docId];
    // Lado local vivo: a cabeça atual pode ter avançado desde a detecção.
    const localOpId = head?.opId ?? conflict.localOpId ?? legacyVersions[docId]?.opId ?? "";
    const localValue = head ? (head.deleted ? null : head.value) : conflict.localValue ?? null;
    const localVersion = head?.version ?? legacyVersions[docId]?.version ?? 0;
    const localWins = localOpId > remoteOpId;
    const value = localWins ? localValue : conflict.remoteValue ?? null;
    const baseVersion = Math.max(localVersion, legacyVersions[docId]?.version ?? 0);
    lamport = Math.max(lamport, baseVersion) + 1;
    const resolution: SyncOp = {
      opId: newId("op"),
      deviceId,
      docId,
      type: value == null ? "del" : "put",
      baseVersion,
      baseOpId: localOpId || undefined,
      version: lamport,
      value,
      createdAt,
      resolves: [localOpId, remoteOpId],
    };
    ops.push(resolution);
    if (!localWins) adopted.push(docId);
    ({ heads } = recomputeOps(ops));
  }
  const final = recomputeOps(ops);
  const lastSeenRemote: Record<string, number> = {};
  for (const [key, value] of Object.entries(legacy.lastSeenRemote ?? {})) {
    if (typeof value === "number") lastSeenRemote[key] = value;
  }
  return {
    v: 2,
    app: "horizonte",
    deviceId,
    generation: Number.isInteger(legacy.generation) ? Math.max(legacy.generation ?? 0, 0) : 0,
    lamport,
    ops,
    docVersions: docVersionsFromHeads(final.heads),
    conflicts: final.conflicts,
    adoptedDocs: adopted.length > 0 ? adopted : undefined,
    lastSeenRemote,
    lastUploadHash: typeof legacy.lastUploadHash === "string" ? legacy.lastUploadHash : "",
    lastSyncAt: legacy.lastSyncAt,
    lastError: legacy.lastError,
  };
}

// ---------------------------------------------------------- conflito manual --

export function resolveConflict(
  meta: SyncMeta,
  state: AppState,
  conflictId: string,
  choice: "local" | "remote",
): { meta: SyncMeta; state: AppState } {
  const conflict = meta.conflicts.find((item) => item.id === conflictId);
  if (!conflict) return { meta, state };
  const value = choice === "local" ? conflict.localValue : conflict.remoteValue;
  const baseVersion = Math.max(conflict.localVersion, conflict.remoteVersion);
  const version = Math.max(meta.lamport, baseVersion) + 1;
  const op: SyncOp = {
    opId: newId("op"),
    deviceId: meta.deviceId,
    docId: conflict.docId,
    type: value == null ? "del" : "put",
    baseVersion,
    baseOpId: conflict.localOpId,
    resolves: [conflict.localOpId ?? "", conflict.remoteOpId],
    version,
    value: value ?? null,
    createdAt: new Date().toISOString(),
  };
  const converged = convergeOps([...meta.ops, op], Math.max(meta.lamport, version), meta.deviceId);
  return {
    meta: {
      ...meta,
      ops: converged.ops,
      lamport: converged.lamport,
      docVersions: docVersionsFromHeads(converged.heads),
      conflicts: converged.conflicts,
      adoptedDocs: undefined,
    },
    state: stateFromHeads(state, converged.heads),
  };
}

// ----------------------------------------------------------------- geração --

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
  const result = mergePayloads(
    emptyMeta,
    baseState,
    payloads.filter((payload) => payload.generation === generation),
  );
  return {
    ...result,
    meta: {
      ...result.meta,
      generation,
      lastError: "Base local substituída pela geração mais nova da nuvem.",
    },
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
