import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { AppState } from "../types";
import { nowISOString } from "../lib/date";
import { emptyState } from "../lib/defaults";
import { loadSecure, saveSecure } from "../lib/storage";
import {
  applyCloudGeneration,
  buildPayload,
  createSyncMeta,
  mergePayloads,
  parsePayload,
  recordLocalChanges,
  resolveConflict as resolveConflictOp,
  seedMissingDocs,
  type CloudPayload,
  type RemoteFile,
  type SyncMeta,
} from "../lib/sync";
import {
  driveBackup,
  driveCheckRemote,
  driveLogin,
  driveLogout,
  driveResetCloud,
  driveRestoreFile,
  driveState,
  isHostAvailable,
  type DriveState,
} from "../lib/host";

const SYNC_KEY = "horizonte-sync-v1";

export interface DriveStatus extends DriveState {
  busy: boolean;
  hasRemote: boolean;
  lastSyncAt?: string;
  error?: string;
  conflicts: number;
  pendingGeneration: number | null;
  hostAvailable: boolean;
}

interface Options {
  state: AppState;
  stateRef: React.MutableRefObject<AppState>;
  applyExternalState: (state: AppState) => void;
  loaded: boolean;
}

export function useDriveSync({ state, stateRef, applyExternalState, loaded }: Options) {
  const [meta, setMeta] = useState<SyncMeta | null>(null);
  const metaRef = useRef<SyncMeta | null>(null);
  const [drive, setDrive] = useState<DriveState>({
    ok: false,
    configured: false,
    signedIn: false,
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [hasRemote, setHasRemote] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const [error, setError] = useState<string>();
  const [pendingGeneration, setPendingGeneration] = useState<number | null>(null);
  const pendingPayloadsRef = useRef<CloudPayload[]>([]);
  const startedRef = useRef(false);

  const commitMeta = useCallback((next: SyncMeta) => {
    metaRef.current = next;
    setMeta(next);
    void saveSecure(SYNC_KEY, next);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await loadSecure<SyncMeta>(SYNC_KEY);
      if (!active) return;
      const next = stored ?? createSyncMeta();
      metaRef.current = next;
      setMeta(next);
      if (!stored) await saveSecure(SYNC_KEY, next);
    })();
    return () => {
      active = false;
    };
  }, []);

  const recordChanges = useCallback(
    (previous: AppState, next: AppState) => {
      const current = metaRef.current ?? createSyncMeta();
      const updated = recordLocalChanges(current, previous, next);
      commitMeta(updated);
    },
    [commitMeta],
  );

  const refreshDriveState = useCallback(async () => {
    if (!isHostAvailable()) {
      setDrive({
        ok: false,
        configured: false,
        signedIn: false,
        error: "A nuvem Google Drive está disponível no aplicativo instalado para Windows ou Android.",
      });
      return;
    }
    const next = await driveState();
    setDrive(next);
    if (next.error) setError(next.error);
  }, []);

  const syncNow = useCallback(
    async (silent = false) => {
      if (busyRef.current) return;
      if (!isHostAvailable()) {
        if (!silent) setError("A nuvem Google Drive está disponível no aplicativo instalado para Windows ou Android.");
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setError(undefined);
      try {
        const currentDrive = await driveState();
        setDrive(currentDrive);
        if (!currentDrive.configured) {
          if (!silent) setError(currentDrive.error ?? "O cliente OAuth do Google ainda não foi configurado neste pacote.");
          return;
        }
        if (!currentDrive.signedIn) {
          if (!silent) setError(currentDrive.error ?? "Entre com a conta Google para sincronizar.");
          return;
        }
        const check = await driveCheckRemote();
        if (!check.ok) {
          setError(check.error ?? "Não foi possível consultar a nuvem.");
          return;
        }
        setHasRemote(check.exists);
        const currentMeta = metaRef.current ?? createSyncMeta();
        const files = check.files ?? [];
        const toDownload = files.filter((file) => currentMeta.lastSeenRemote[file.id] !== file.modifiedTime);
        const payloads: CloudPayload[] = [];
        const downloaded: RemoteFile[] = [];
        for (const file of toDownload) {
          const restored = await driveRestoreFile(file.id);
          if (!restored.ok || !restored.payload) continue;
          const parsed = parsePayload(restored.payload);
          if (!parsed) continue;
          payloads.push(parsed);
          downloaded.push(file);
        }
        const newer = payloads.find((payload) => payload.generation > currentMeta.generation);
        if (newer) {
          pendingPayloadsRef.current = payloads;
          setPendingGeneration(newer.generation);
          setError("A nuvem tem uma geração mais nova (o caderno foi reiniciado em outro dispositivo). Decida como continuar.");
          return;
        }

        const localState = stateRef.current;
        const demoBase = localState.meta.seedSource === "demonstracao";
        if (demoBase && !check.exists) {
          // A base fictícia serve para conhecer o app; nunca deve virar
          // backup real nem ocupar a pasta appDataFolder do usuário.
          setHasRemote(false);
          setError("A base de demonstração não é enviada para a nuvem. Cadastre, importe ou limpe os dados para ativar o backup.");
          return;
        }
        if (demoBase && check.exists && payloads.length === 0) {
          setError("Há arquivos na nuvem, mas nenhum backup válido foi reconhecido. Nada foi enviado para evitar sobrescrever dados.");
          return;
        }

        let baseMeta = currentMeta;
        let baseState = localState;
        if (demoBase && check.exists && payloads.length > 0) {
          // Primeiro login com demonstração: a nuvem real tem prioridade.
          // Preserva apenas o aceite de termos/onboarding deste dispositivo.
          baseMeta = {
            ...createSyncMeta(),
            deviceId: currentMeta.deviceId,
            generation: currentMeta.generation,
            lastSeenRemote: currentMeta.lastSeenRemote,
          };
          baseState = {
            ...emptyState(),
            settings: {
              ...emptyState().settings,
              onboarded: localState.settings.onboarded,
              termsAcceptedAt: localState.settings.termsAcceptedAt,
              termsVersion: localState.settings.termsVersion,
            },
            meta: { ...localState.meta, seedSource: undefined },
          };
        }
        // Registra as versões dos documentos locais ANTES de reconciliar.
        // Sem isso, um documento local sem versão poderia ser sobrescrito
        // silenciosamente por uma edição remota concorrente.
        baseMeta = seedMissingDocs(baseMeta, baseState);
        const merged = mergePayloads(baseMeta, baseState, payloads);
        let nextMeta = merged.meta;
        let nextState = merged.state;
        if (merged.newGeneration) {
          pendingPayloadsRef.current = payloads;
          setPendingGeneration(merged.newGeneration);
          setError("A nuvem tem uma geração mais nova. Decida como continuar.");
          return;
        }
        nextMeta = seedMissingDocs(nextMeta, nextState);
        nextState = { ...nextState, meta: { ...nextState.meta, seedSource: demoBase ? undefined : nextState.meta.seedSource } };
        const lastSeenRemote = { ...nextMeta.lastSeenRemote };
        for (const file of downloaded) lastSeenRemote[file.id] = file.modifiedTime;
        nextMeta = { ...nextMeta, lastSeenRemote };
        const payload = buildPayload(nextMeta);
        const hash = payload.length.toString(36) + "-" + nextMeta.ops.length;
        if (hash !== currentMeta.lastUploadHash && (nextState.patients.length > 0 || nextState.appointments.length > 0)) {
          const uploaded = await driveBackup(payload);
          if (!uploaded.ok) {
            setError(uploaded.error ?? "Falha ao enviar a base para a nuvem.");
            commitMeta({ ...nextMeta, lastError: uploaded.error });
            return;
          }
          if (uploaded.fileId && uploaded.backedUpAt) {
            nextMeta = {
              ...nextMeta,
              lastSeenRemote: { ...nextMeta.lastSeenRemote, [uploaded.fileId]: uploaded.backedUpAt },
              lastUploadHash: hash,
            };
          }
        }
        nextMeta = {
          ...nextMeta,
          lastSyncAt: nowISOString(),
          lastError: undefined,
        };
        commitMeta(nextMeta);
        if (merged.applied > 0 || payloads.length > 0) applyExternalState(nextState);
        setLastSyncAt(nextMeta.lastSyncAt);
        setHasRemote(check.exists || Boolean(nextMeta.lastUploadHash));
        if (merged.conflicts > 0) {
          setError(`${merged.conflicts} conflito(s) de edição aguardando sua decisão.`);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Falha na sincronização.");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [applyExternalState, commitMeta, stateRef],
  );

  useEffect(() => {
    if (!loaded || startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      await refreshDriveState();
      const current = await driveState();
      setDrive(current);
      if (current.signedIn) void syncNow(true);
    })();
  }, [loaded, refreshDriveState, syncNow]);

  useEffect(() => {
    if (!loaded || !drive.signedIn) return;
    const timer = window.setInterval(() => {
      void syncNow(true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [drive.signedIn, loaded, syncNow]);

  const connect = useCallback(async () => {
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await driveLogin();
      setDrive(result);
      if (!result.ok) {
        setError(result.error ?? "Login não concluído.");
        return;
      }
      await syncNow(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [syncNow]);

  const disconnect = useCallback(async () => {
    const result = await driveLogout();
    if (!result.ok) {
      setError(result.error ?? "Não foi possível desconectar.");
      return;
    }
    setDrive({ ok: true, configured: drive.configured, signedIn: false });
    setHasRemote(false);
    setLastSyncAt(undefined);
  }, [drive.configured]);

  const resolveConflict = useCallback(
    (conflictId: string, choice: "local" | "remote") => {
      const current = metaRef.current;
      if (!current) return;
      const result = resolveConflictOp(current, stateRef.current, conflictId, choice);
      commitMeta(result.meta);
      applyExternalState(result.state);
      void syncNow(true);
    },
    [applyExternalState, commitMeta, stateRef, syncNow],
  );

  const applyPendingGeneration = useCallback(() => {
    if (pendingGeneration === null) return;
    const current = metaRef.current;
    if (!current) return;
    const result = applyCloudGeneration(current, stateRef.current, pendingPayloadsRef.current, pendingGeneration);
    commitMeta(result.meta);
    applyExternalState(result.state);
    setPendingGeneration(null);
    pendingPayloadsRef.current = [];
    void syncNow(true);
  }, [applyExternalState, commitMeta, pendingGeneration, stateRef, syncNow]);

  const startNewNotebook = useCallback(async () => {
    const current = metaRef.current ?? createSyncMeta();
    const nextGeneration = current.generation + 1;
    const fresh = emptyState();
    const freshMeta: SyncMeta = {
      ...createSyncMeta(),
      deviceId: current.deviceId,
      generation: nextGeneration,
      lastSeenRemote: {},
    };
    const seeded = seedMissingDocs(freshMeta, fresh);
    const payload = buildPayload(seeded);
    const uploaded = await driveResetCloud(payload);
    if (!uploaded.ok) {
      setError(uploaded.error ?? "Não foi possível reiniciar a nuvem.");
      return false;
    }
    const finalMeta: SyncMeta = {
      ...seeded,
      lastSeenRemote: uploaded.fileId && uploaded.backedUpAt ? { [uploaded.fileId]: uploaded.backedUpAt } : {},
      lastUploadHash: payload.length.toString(36) + "-" + seeded.ops.length,
      lastSyncAt: nowISOString(),
    };
    commitMeta(finalMeta);
    applyExternalState(fresh);
    setPendingGeneration(null);
    setHasRemote(true);
    setLastSyncAt(finalMeta.lastSyncAt);
    return true;
  }, [applyExternalState, commitMeta]);

  const status: DriveStatus = {
    ...drive,
    busy,
    hasRemote,
    lastSyncAt,
    error,
    conflicts: meta?.conflicts.length ?? 0,
    pendingGeneration,
    hostAvailable: isHostAvailable(),
  };

  return {
    meta,
    status,
    recordChanges,
    connect,
    disconnect,
    syncNow,
    resolveConflict,
    applyPendingGeneration,
    startNewNotebook,
    refreshDriveState,
    state,
  };
}
