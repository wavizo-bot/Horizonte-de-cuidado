import { describe, expect, it } from "vitest";
import {
  applyCloudGeneration,
  buildPayload,
  checksum,
  createSyncMeta,
  mergePayloads,
  parsePayload,
  recordLocalChanges,
  resolveConflict,
  seedMissingDocs,
  type CloudPayload,
  type SyncOp,
} from "../src/lib/sync";
import { patient, testState } from "./fixtures";

function makeOp(overrides: Partial<SyncOp> & Pick<SyncOp, "opId" | "docId" | "version" | "baseVersion">): SyncOp {
  return {
    deviceId: "remote-device",
    type: "put",
    value: null,
    createdAt: "2026-11-01T12:00:00.000Z",
    ...overrides,
  };
}

function payload(deviceId: string, generation: number, ops: SyncOp[]): CloudPayload {
  const body = { v: 1 as const, app: "horizonte" as const, generation, deviceId, ops };
  return { ...body, checksum: checksum(body) };
}

function stateWithPatient(name = "Pessoa Local") {
  const state = testState();
  state.patients = [patient({ id: "p1", name, registrationNumber: "1" })];
  return state;
}

describe("recordLocalChanges", () => {
  it("registra inclusão, alteração e exclusão de documentos", () => {
    const meta = createSyncMeta();
    const previous = testState();
    const next = stateWithPatient();
    const created = recordLocalChanges(meta, previous, next);
    const put = created.ops.find((item) => item.docId === "patient:p1");
    expect(put).toMatchObject({ type: "put", baseVersion: 0 });
    expect(put?.value).toMatchObject({ id: "p1", name: "Pessoa Local" });

    const changedState = stateWithPatient("Pessoa Alterada");
    const changed = recordLocalChanges(created, next, changedState);
    const changedOp = changed.ops.filter((item) => item.docId === "patient:p1" && item.value).at(-1);
    expect(changedOp?.value).toMatchObject({ name: "Pessoa Alterada" });

    const removed = recordLocalChanges(changed, changedState, testState());
    expect(removed.ops.filter((item) => item.docId === "patient:p1").at(-1)?.type).toBe("del");
  });

  it("não cria operação quando nada mudou", () => {
    const meta = createSyncMeta();
    const state = stateWithPatient();
    const result = recordLocalChanges(meta, state, state);
    expect(result.ops).toHaveLength(0);
    expect(result.lamport).toBe(meta.lamport);
  });
});

describe("payload", () => {
  it("faz round-trip com checksum", () => {
    const meta = createSyncMeta();
    meta.ops = [makeOp({ opId: "op-1", docId: "patient:p1", version: 1, baseVersion: 0, value: { id: "p1" } })];
    const text = buildPayload(meta);
    const parsed = parsePayload(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.deviceId).toBe(meta.deviceId);
    expect(parsed?.ops).toHaveLength(1);
  });

  it("rejeita payload adulterado", () => {
    const meta = createSyncMeta();
    meta.ops = [makeOp({ opId: "op-1", docId: "patient:p1", version: 1, baseVersion: 0, value: { id: "p1" } })];
    const tampered = JSON.parse(buildPayload(meta));
    tampered.ops[0].value = { id: "outro" };
    expect(parsePayload(JSON.stringify(tampered))).toBeNull();
  });
});

describe("mergePayloads", () => {
  it("aceita valor remoto idêntico sem criar conflito", () => {
    const state = stateWithPatient();
    const meta = seedMissingDocs(createSyncMeta(), state);
    const remoteOp = makeOp({
      opId: "remote-1",
      docId: "patient:p1",
      version: 1,
      baseVersion: 0,
      value: state.patients[0],
    });
    const result = mergePayloads(meta, state, [payload("remote-device", 0, [remoteOp])]);
    expect(result.conflicts).toBe(0);
    expect(result.state.patients[0].name).toBe("Pessoa Local");
    expect(result.meta.conflicts).toHaveLength(0);
  });

  it("preserva conflito quando o valor remoto difere do local", () => {
    const state = stateWithPatient("Pessoa Local");
    const meta = seedMissingDocs(createSyncMeta(), state);
    const remoteOp = makeOp({
      opId: "remote-1",
      docId: "patient:p1",
      version: 2,
      baseVersion: 0,
      value: { ...state.patients[0], name: "Pessoa Remota" },
    });
    const result = mergePayloads(meta, state, [payload("remote-device", 0, [remoteOp])]);
    expect(result.conflicts).toBe(1);
    expect(result.state.patients[0].name).toBe("Pessoa Local");
    expect(result.meta.conflicts[0]).toMatchObject({
      docId: "patient:p1",
      remoteValue: expect.objectContaining({ name: "Pessoa Remota" }),
    });
  });

  it("aplica operações em ordem causal", () => {
    const state = testState();
    const meta = createSyncMeta();
    const op1 = makeOp({
      opId: "remote-1",
      docId: "patient:p1",
      version: 1,
      baseVersion: 0,
      value: { id: "p1", name: "Primeira" },
    });
    const op2 = makeOp({
      opId: "remote-2",
      docId: "patient:p1",
      version: 2,
      baseVersion: 1,
      value: { id: "p1", name: "Segunda" },
    });
    const result = mergePayloads(meta, state, [payload("remote-device", 0, [op2, op1])]);
    expect(result.conflicts).toBe(0);
    expect(result.state.patients).toEqual([expect.objectContaining({ id: "p1", name: "Segunda" })]);
  });

  it("ignora operações da própria origem", () => {
    const state = stateWithPatient();
    const meta = seedMissingDocs(createSyncMeta(), state);
    const ownOp = makeOp({
      opId: "own-1",
      deviceId: meta.deviceId,
      docId: "patient:p1",
      version: 99,
      baseVersion: 0,
      value: { ...state.patients[0], name: "Não deve aplicar" },
    });
    const result = mergePayloads(meta, state, [payload(meta.deviceId, 0, [ownOp])]);
    expect(result.state.patients[0].name).toBe("Pessoa Local");
    expect(result.meta.appliedOpIds).toContain("own-1");
  });

  it("detecta geração mais nova sem aplicar automaticamente", () => {
    const state = stateWithPatient();
    const meta = createSyncMeta();
    const result = mergePayloads(meta, state, [payload("remote-device", 2, [])]);
    expect(result.newGeneration).toBe(2);
    expect(result.state.patients).toHaveLength(1);
  });
});

describe("resolveConflict", () => {
  it("permite escolher local ou remoto e registra a resolução", () => {
    const state = stateWithPatient("Pessoa Local");
    const meta = seedMissingDocs(createSyncMeta(), state);
    const remoteOp = makeOp({
      opId: "remote-1",
      docId: "patient:p1",
      version: 2,
      baseVersion: 0,
      value: { ...state.patients[0], name: "Pessoa Remota" },
    });
    const merged = mergePayloads(meta, state, [payload("remote-device", 0, [remoteOp])]);
    const conflictId = merged.meta.conflicts[0].id;
    const remote = resolveConflict(merged.meta, merged.state, conflictId, "remote");
    expect(remote.state.patients[0].name).toBe("Pessoa Remota");
    expect(remote.meta.conflicts).toHaveLength(0);
    expect(remote.meta.ops.at(-1)?.resolves).toContain("remote-1");
  });
});

describe("applyCloudGeneration", () => {
  it("substitui a base local pela geração remota", () => {
    const state = stateWithPatient("Pessoa Local");
    const meta = createSyncMeta();
    const remotePatient = patient({ id: "p2", name: "Pessoa Remota", registrationNumber: "2" });
    const remoteOp = makeOp({
      opId: "remote-1",
      docId: "patient:p2",
      version: 1,
      baseVersion: 0,
      value: remotePatient,
    });
    const result = applyCloudGeneration(meta, state, [payload("remote-device", 3, [remoteOp])], 3);
    expect(result.state.patients.map((item) => item.name)).toEqual(["Pessoa Remota"]);
    expect(result.meta.generation).toBe(3);
    expect(result.meta.lastError).toContain("geração");
  });
});
