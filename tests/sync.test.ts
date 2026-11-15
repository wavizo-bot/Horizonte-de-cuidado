import { describe, expect, it } from "vitest";
import {
  applyCloudGeneration,
  buildPayload,
  checksum,
  createSyncMeta,
  mergePayloads,
  migrateMeta,
  parsePayload,
  recomputeOps,
  recordLocalChanges,
  resolveConflict,
  seedMissingDocs,
  type CloudPayload,
  type SyncMeta,
  type SyncOp,
} from "../src/lib/sync";
import { patient, testState } from "./fixtures";
import type { Patient } from "../src/types";

function makeOp(overrides: Partial<SyncOp> & Pick<SyncOp, "opId" | "docId" | "version" | "baseVersion">): SyncOp {
  return {
    deviceId: "remote-device",
    type: "put",
    value: null,
    createdAt: "2026-11-01T12:00:00.000Z",
    ...overrides,
  };
}

function makeMeta(overrides: Partial<SyncMeta> = {}): SyncMeta {
  return { ...createSyncMeta(), deviceId: "dev-a", ...overrides };
}

/** Estado sem modelos de mensagem padrão (eles têm timestamp de criação e poluem o diff). */
function bareState(): ReturnType<typeof testState> {
  const state = testState();
  state.templates = [];
  return state;
}

/** Payload v2. */
function payload(deviceId: string, generation: number, ops: SyncOp[]): CloudPayload {
  const body = { v: 2 as const, app: "horizonte" as const, generation, deviceId, ops };
  return { ...body, checksum: checksum(body) };
}

/** Payload v1 (aparelho ainda na versão antiga): o checksum cobre o corpo v1. */
function legacyPayload(deviceId: string, generation: number, ops: SyncOp[]): string {
  const body = { v: 1 as const, app: "horizonte" as const, generation, deviceId, ops };
  return JSON.stringify({ ...body, checksum: checksum(body) });
}

const SEED: Patient = patient({ id: "p1", name: "Ana" });
const DOC = "patient:p1";

function stateWith(name: string, registrationNumber = "p1"): ReturnType<typeof testState> {
  const state = testState();
  state.patients = [{ ...SEED, name, registrationNumber }];
  return state;
}

function localMeta(name: string, registrationNumber = "p1"): SyncMeta {
  return makeMeta({
    ops: [
      makeOp({ opId: "a-seed", deviceId: "dev-a", docId: DOC, version: 1, baseVersion: 0, value: SEED }),
      makeOp({
        opId: "a-edit",
        deviceId: "dev-a",
        docId: DOC,
        version: 2,
        baseVersion: 1,
        baseOpId: "a-seed",
        value: { ...SEED, name, registrationNumber },
      }),
    ],
  });
}

describe("recordLocalChanges", () => {
  it("semente local vira operação e não duplica", () => {
    const meta = makeMeta();
    const before = testState();
    const after = { ...before, patients: [{ ...SEED, name: "Ana" }] };
    const first = recordLocalChanges(meta, before, after);
    expect(first.ops).toHaveLength(1);
    expect(first.ops[0]?.docId).toBe(DOC);
    expect(first.lamport).toBe(1);
    // Reabrir/mudar nada mantém a mesma semente.
    const second = recordLocalChanges(first, after, after);
    expect(second.ops).toHaveLength(1);
  });

  it("exclusão local vira operação del", () => {
    const meta = makeMeta({
      ops: [makeOp({ opId: "a-seed", deviceId: "dev-a", docId: DOC, version: 1, baseVersion: 0, value: SEED })],
      docVersions: { [DOC]: { version: 1, opId: "a-seed" } },
    });
    const before = stateWith("Ana");
    const after = { ...before, patients: [] };
    const next = recordLocalChanges(meta, before, after);
    // A semente já está em meta.ops; o diff acrescenta só a exclusão.
    expect(next.ops).toHaveLength(2);
    expect(next.ops[1]?.type).toBe("del");
    expect(next.ops[1]?.docId).toBe(DOC);
  });
});

describe("mergePayloads", () => {
  it("duas edições concorrentes com base comum são mescladas automaticamente", () => {
    const meta = localMeta("Ana", "2");
    const state = stateWith("Ana", "2");
    const remoteOps = [
      makeOp({ opId: "b-seed", deviceId: "dev-b", docId: DOC, version: 1, baseVersion: 0, value: SEED }),
      makeOp({
        opId: "b-edit",
        deviceId: "dev-b",
        docId: DOC,
        version: 2,
        baseVersion: 1,
        baseOpId: "b-seed",
        value: { ...SEED, name: "Ana B" },
      }),
    ];
    const result = mergePayloads(meta, state, [payload("dev-b", 0, remoteOps)]);
    expect(result.conflicts).toBe(0);
    expect(result.state.patients[0]?.name).toBe("Ana B");
    expect(result.state.patients[0]?.registrationNumber).toBe("2");
    const resolution = result.meta.ops.find((op) => op.resolves?.length === 2);
    expect(resolution?.resolves).toEqual(["a-edit", "b-edit"]);
  });

  it("conflito insolúvel (escalar) fica para decisão manual e a resolução encerra", () => {
    const meta = makeMeta({
      ops: [makeOp({ opId: "a1", docId: "config", version: 1, baseVersion: 0, value: "texto local" })],
    });
    const remote = [
      makeOp({ opId: "b1", deviceId: "dev-b", docId: "config", version: 1, baseVersion: 0, value: "texto remoto" }),
    ];
    const merged = mergePayloads(meta, testState(), [payload("dev-b", 0, remote)]);
    expect(merged.conflicts).toBe(1);
    expect(merged.meta.conflicts[0]?.id).toBe(`conflito:config:b1`);
    const resolved = resolveConflict(merged.meta, merged.state, `conflito:config:b1`, "remote");
    expect(resolved.meta.conflicts).toHaveLength(0);
    const resolution = resolved.meta.ops.find((op) => op.resolves?.length === 2);
    expect(resolution?.value).toBe("texto remoto");
    expect(recomputeOps(resolved.meta.ops).heads["config"]?.value).toBe("texto remoto");
  });

  it("sem base comum um lado vence inteiro e a resolução converge os aparelhos", () => {
    const meta = makeMeta({
      ops: [
        makeOp({
          opId: "a1",
          deviceId: "dev-a",
          docId: DOC,
          version: 1,
          baseVersion: 0,
          value: { id: "p1", name: "Ana", phone: "1" },
        }),
      ],
    });
    const remoteOps = [
      makeOp({
        opId: "b1",
        deviceId: "dev-b",
        docId: DOC,
        version: 1,
        baseVersion: 0,
        value: { id: "p1", name: "Ana (B)", phone: "2" },
      }),
    ];
    const merged = mergePayloads(meta, testState(), [payload("dev-b", 0, remoteOps)]);
    expect(merged.conflicts).toBe(0);
    // 'a1' < 'b1' → o lado remoto vence inteiro (nunca inventa).
    expect(merged.state.patients[0]).toEqual({ id: "p1", name: "Ana (B)", phone: "2" });
    // B recebe a resolução e converge (não reabre o conflito).
    const resolutionPayload = payload("dev-a", 0, merged.meta.ops.filter((op) => op.opId !== "b1"));
    const metaB = makeMeta({
      deviceId: "dev-b",
      ops: remoteOps,
    });
    const back = mergePayloads(metaB, testState(), [resolutionPayload]);
    expect(back.conflicts).toBe(0);
    expect(back.state.patients[0]).toEqual({ id: "p1", name: "Ana (B)", phone: "2" });
  });

  it("geração mais nova bloqueia a aplicação", () => {
    const meta = localMeta("Ana", "2");
    const state = stateWith("Ana", "2");
    const result = mergePayloads(meta, state, [payload("dev-b", 3, [])]);
    expect(result.newGeneration).toBe(3);
    expect(result.applied).toBe(0);
    expect(result.state.patients[0]?.name).toBe("Ana");
  });

  it("operação local ausente na nuvem permanece no histórico", () => {
    const meta = localMeta("Ana", "2");
    const state = stateWith("Ana", "2");
    const result = mergePayloads(meta, state, [payload("dev-b", 0, [])]);
    expect(result.meta.ops.some((op) => op.opId === "a-edit")).toBe(true);
    expect(result.state.patients[0]?.registrationNumber).toBe("2");
  });

  it("mesclagem idempotente: o mesmo payload aplicado duas vezes não muda nada", () => {
    const meta = localMeta("Ana", "2");
    const state = stateWith("Ana", "2");
    const remoteOps = [
      makeOp({ opId: "b-seed", deviceId: "dev-b", docId: DOC, version: 1, baseVersion: 0, value: SEED }),
      makeOp({
        opId: "b-edit",
        deviceId: "dev-b",
        docId: DOC,
        version: 2,
        baseVersion: 1,
        baseOpId: "b-seed",
        value: { ...SEED, name: "Ana B" },
      }),
    ];
    const batch = payload("dev-b", 0, remoteOps);
    const first = mergePayloads(meta, state, [batch]);
    const second = mergePayloads(first.meta, first.state, [batch]);
    expect(second.applied).toBe(0);
    expect(second.meta.ops).toHaveLength(first.meta.ops.length);
    expect(second.state.patients[0]?.name).toBe("Ana B");
  });

  it("três ramificações com a mesma base convergem sem perder edição, na ordem que chegarem", () => {
    const remoteOps = (deviceId: string, seedOpId: string, edit: Partial<Patient>) => [
      makeOp({ opId: seedOpId, deviceId, docId: DOC, version: 1, baseVersion: 0, value: SEED }),
      makeOp({
        opId: `${seedOpId}-edit`,
        deviceId,
        docId: DOC,
        version: 2,
        baseVersion: 1,
        baseOpId: seedOpId,
        value: { ...SEED, ...edit },
      }),
    ];
    const fromB = remoteOps("dev-b", "b-seed", { noWhatsapp: true });
    const fromC = remoteOps("dev-c", "c-seed", { registrationNumber: "2" });
    const run = (order: Array<CloudPayload>) => {
      const result = mergePayloads(makeMeta(), stateWith("Ana"), order);
      expect(result.conflicts).toBe(0);
      expect(result.state.patients[0]?.noWhatsapp).toBe(true);
      expect(result.state.patients[0]?.registrationNumber).toBe("2");
      expect(result.state.patients[0]?.name).toBe("Ana");
      return result.state.patients[0];
    };
    const first = run([payload("dev-b", 0, fromB), payload("dev-c", 0, fromC)]);
    const second = run([payload("dev-c", 0, fromC), payload("dev-b", 0, fromB)]);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("exclusão causal vence sozinha (tombstone), sem conflito", () => {
    const meta = localMeta("Ana", "2");
    const state = stateWith("Ana", "2");
    const remoteOps = [
      makeOp({
        opId: "d1",
        deviceId: "dev-b",
        docId: DOC,
        type: "del",
        version: 3,
        baseVersion: 2,
        baseOpId: "a-edit",
        value: null,
      }),
    ];
    const result = mergePayloads(meta, state, [payload("dev-b", 0, remoteOps)]);
    expect(result.conflicts).toBe(0);
    expect(result.state.patients).toHaveLength(0);
  });

  it("arquivos por dispositivo: dois payloads mesclados nos dois sentidos", () => {
    const fromA = [
      makeOp({
        opId: "a-file",
        deviceId: "dev-a",
        docId: "patient:pa",
        version: 1,
        baseVersion: 0,
        value: { id: "pa", name: "Ana 2" },
      }),
    ];
    const fromB = [
      makeOp({
        opId: "b-file",
        deviceId: "dev-b",
        docId: "patient:pb",
        version: 1,
        baseVersion: 0,
        value: { id: "pb", name: "Bia 2" },
      }),
    ];
    const patientOps = (meta: SyncMeta) => meta.ops.filter((op) => op.docId.startsWith("patient:"));
    const mergedB = mergePayloads(makeMeta(), bareState(), [payload("dev-a", 0, fromA), payload("dev-b", 0, fromB)]);
    expect(mergedB.conflicts).toBe(0);
    expect(mergedB.state.patients.map((p) => p.name).sort()).toEqual(["Ana 2", "Bia 2"]);
    expect(patientOps(mergedB.meta).map((op) => op.opId).sort()).toEqual(["a-file", "b-file"]);
    // A baixa os dois arquivos e recebe a edição de B.
    const metaA = makeMeta({ deviceId: "dev-a", ops: fromA });
    const mergedA = mergePayloads(metaA, bareState(), [payload("dev-a", 0, fromA), payload("dev-b", 0, fromB)]);
    expect(mergedA.state.patients.map((p) => p.name).sort()).toEqual(["Ana 2", "Bia 2"]);
  });

  it("conflito real na nuvem é mesclado automaticamente e o outro aparelho converge", () => {
    const metaA = localMeta("Ana", "2");
    const stateA = stateWith("Ana", "2");
    const metaB = makeMeta({
      deviceId: "dev-b",
      ops: [
        makeOp({ opId: "b-seed", deviceId: "dev-b", docId: DOC, version: 1, baseVersion: 0, value: SEED }),
        makeOp({
          opId: "b-edit",
          deviceId: "dev-b",
          docId: DOC,
          version: 2,
          baseVersion: 1,
          baseOpId: "b-seed",
          value: { ...SEED, name: "Ana B" },
        }),
      ],
    });
    const stateB = testState();
    stateB.patients = [{ ...SEED, name: "Ana B" }];
    // A puxa a versão de B: mesclagem automática preserva as duas edições.
    const first = mergePayloads(metaA, stateA, [buildPayload(metaB)].map((text) => JSON.parse(text) as CloudPayload));
    expect(first.conflicts).toBe(0);
    expect(first.state.patients[0]?.name).toBe("Ana B");
    expect(first.state.patients[0]?.registrationNumber).toBe("2");
    // B puxa a resolução e converge sem recriar o conflito.
    const payloadA = JSON.parse(buildPayload(first.meta)) as CloudPayload;
    const second = mergePayloads(metaB, stateB, [payloadA]);
    expect(second.conflicts).toBe(0);
    expect(JSON.stringify(second.state.patients[0])).toBe(JSON.stringify(first.state.patients[0]));
  });
});

describe("payload", () => {
  it("valida checksum e rejeita adulteração", () => {
    const meta = localMeta("Ana", "2");
    const text = buildPayload(meta);
    const ok = parsePayload(text);
    expect(ok?.ops).toHaveLength(2);
    const bad = JSON.parse(text) as { ops: Array<{ value?: unknown }> };
    bad.ops[1]!.value = { name: "Adulterado" };
    expect(parsePayload(JSON.stringify(bad))).toBeNull();
    expect(parsePayload(JSON.stringify({ v: 2, app: "horizonte", generation: 0, deviceId: "x", ops: [], checksum: "x" }))).toBeNull();
  });

  it("aceita payload v1 de aparelho antigo e rejeita op inválida", () => {
    const legacy = legacyPayload("dev-b", 0, [
      makeOp({ opId: "b1", deviceId: "dev-b", docId: "patient:pb", version: 1, baseVersion: 0, value: { id: "pb", name: "Bia" } }),
    ]);
    const parsed = parsePayload(legacy);
    expect(parsed?.ops).toHaveLength(1);
    expect(parsed?.v).toBe(2);
    const invalid = payload("dev-b", 0, [makeOp({ opId: "", docId: DOC, version: 1, baseVersion: 0 })]);
    expect(parsePayload(JSON.stringify(invalid))).toBeNull();
  });
});

describe("migração v1 → v2", () => {
  const legacyMeta = {
    v: 1,
    app: "horizonte",
    deviceId: "dev-a",
    generation: 0,
    lamport: 1,
    ops: [
      makeOp({ opId: "a1", deviceId: "dev-a", docId: DOC, version: 1, baseVersion: 0, value: { ...SEED, name: "Local" } }),
    ],
    appliedOpIds: ["z-remote"],
    docVersions: { [DOC]: { version: 1, opId: "a1" } },
    conflicts: [
      {
        id: "c1",
        docId: DOC,
        localValue: { ...SEED, name: "Local" },
        remoteValue: { ...SEED, name: "Nuvem" },
        localOpId: "a1",
        remoteOpId: "z-remote",
        detectedAt: "2026-11-01T12:00:00.000Z",
      },
    ],
    lastSeenRemote: { f1: 1000 },
    lastUploadHash: "abc",
  };

  it("converte metadados e resolve o conflito legado por opId", () => {
    const migrated = migrateMeta(legacyMeta);
    expect(migrated.v).toBe(2);
    expect(migrated.conflicts).toHaveLength(0);
    const resolution = migrated.ops.find((op) => op.resolves?.length === 2);
    expect(resolution?.resolves).toEqual(["a1", "z-remote"]);
    // 'z-remote' > 'a1' → vence a nuvem; documento marcado como adotado.
    expect((resolution?.value as { name: string }).name).toBe("Nuvem");
    expect(migrated.adoptedDocs).toEqual([DOC]);
    expect(migrated.lastSeenRemote).toEqual({ f1: 1000 });
    // Idempotente: uma meta já v2 passa intocada.
    expect(migrateMeta(migrated)).toBe(migrated);
  });

  it("conflito legado com opId local maior preserva o lado local", () => {
    const migrated = migrateMeta({
      ...legacyMeta,
      conflicts: [
        {
          id: "c1",
          docId: DOC,
          localValue: { ...SEED, name: "Local" },
          remoteValue: { ...SEED, name: "Nuvem" },
          localOpId: "a1",
          remoteOpId: "a-remote",
          detectedAt: "2026-11-01T12:00:00.000Z",
        },
      ],
    });
    const resolution = migrated.ops.find((op) => op.resolves?.length === 2);
    expect((resolution?.value as { name: string }).name).toBe("Local");
    expect(migrated.adoptedDocs).toBeUndefined();
  });

  it("no primeiro sync o valor vencedor da nuvem é adotado sem ressuscitar o antigo", () => {
    const migrated = migrateMeta(legacyMeta);
    const state = stateWith("Local");
    const merged = mergePayloads(migrated, state, []);
    expect(merged.state.patients[0]?.name).toBe("Nuvem");
    expect(merged.conflicts).toBe(0);
    expect(merged.meta.adoptedDocs).toBeUndefined();
  });
});

describe("seedMissingDocs", () => {
  it("encadeia da versão legada quando a cabeça ainda não chegou", () => {
    const meta = makeMeta({
      docVersions: { [DOC]: { version: 5, opId: "r-antiga" } },
    });
    const seeded = seedMissingDocs(meta, stateWith("Ana"));
    const op = seeded.ops.find((item) => item.docId === DOC);
    expect(op?.baseVersion).toBe(5);
    expect(op?.baseOpId).toBe("r-antiga");
    expect(seeded.lamport).toBeGreaterThanOrEqual(6);
  });
});

describe("applyCloudGeneration", () => {
  it("substitui a base local pelo conteúdo da geração nova", () => {
    const meta = makeMeta({ generation: 0 });
    const state = stateWith("Local");
    const cloudOps = [
      makeOp({
        opId: "r1",
        deviceId: "dev-b",
        docId: DOC,
        version: 1,
        baseVersion: 0,
        value: { ...SEED, name: "Da nuvem" },
      }),
    ];
    const result = applyCloudGeneration(meta, state, [payload("dev-b", 5, cloudOps)], 5);
    expect(result.meta.generation).toBe(5);
    expect(result.state.patients[0]?.name).toBe("Da nuvem");
    expect(result.conflicts).toBe(0);
  });
});
