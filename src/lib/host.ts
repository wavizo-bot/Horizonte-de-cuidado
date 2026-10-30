export interface DriveState {
  ok: boolean;
  configured: boolean;
  signedIn: boolean;
  email?: string | null;
  error?: string;
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: number;
  size: number;
}

export interface DriveCheck {
  ok: boolean;
  exists: boolean;
  files: DriveFile[];
  modifiedTime: number;
  error?: string;
}

export interface DriveBackupResult {
  ok: boolean;
  fileId?: string;
  name?: string;
  backedUpAt?: number;
  error?: string;
}

export interface DriveRestoreResult {
  ok: boolean;
  payload?: string;
  error?: string;
}

interface HostObject {
  GetAppVersion?: () => Promise<string | null> | string | null;
  SaveTextFile?: (defaultName: string, content: string) => Promise<string | null> | string | null;
  OpenTextFile?: () => Promise<string | null> | string | null;
  Quit?: () => Promise<string> | string;
  DriveGetState?: () => Promise<string> | string;
  DriveLogin?: () => Promise<string> | string;
  DriveLogout?: () => Promise<string> | string;
  DriveCheckRemote?: () => Promise<string> | string;
  DriveRestoreFile?: (fileId: string) => Promise<string> | string;
  DriveBackup?: (payload: string) => Promise<string> | string;
  DriveResetCloud?: (payload: string) => Promise<string> | string;
}

declare global {
  interface Window {
    chrome?: {
      webview?: {
        hostObjects?: {
          horizonteHost?: HostObject;
        };
      };
    };
  }
}

function host(): HostObject | undefined {
  return window.chrome?.webview?.hostObjects?.horizonteHost;
}

export function isHostAvailable(): boolean {
  return Boolean(host());
}

export type HostPlatform = "android" | "windows" | "web";

/** Plataforma do host nativo; "web" quando roda no navegador/PWA. */
export function hostPlatform(): HostPlatform {
  if (typeof window === "undefined") return "web";
  if ((window as Window & { HorizonteAndroid?: unknown }).HorizonteAndroid) return "android";
  if (window.chrome?.webview?.hostObjects?.horizonteHost) return "windows";
  return "web";
}

async function call<T>(method: keyof HostObject, ...args: unknown[]): Promise<T | null> {
  const object = host();
  if (!object) return null;
  const fn = object[method] as ((...values: unknown[]) => Promise<T> | T) | undefined;
  if (!fn) return null;
  try {
    return await fn.apply(object, args);
  } catch {
    return null;
  }
}

export async function getAppVersion(): Promise<string | null> {
  return call<string | null>("GetAppVersion");
}

export async function saveTextFile(defaultName: string, content: string): Promise<string | null> {
  const result = await call<string | null>("SaveTextFile", defaultName, content);
  if (result !== null) return result;
  // Navegador de desenvolvimento: download comum.
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = defaultName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return defaultName;
}

export async function openTextFile(): Promise<string | null> {
  const result = await call<string | null>("OpenTextFile");
  if (result !== null) return result;
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.csv,.txt,text/plain,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve(await file.text());
    };
    input.click();
  });
}

export async function quitApp(): Promise<void> {
  await call<string>("Quit");
}

async function driveJson<T>(method: keyof HostObject): Promise<T | null> {
  const raw = await call<string>(method);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function driveState(): Promise<DriveState> {
  if (!isHostAvailable()) {
    return {
      ok: false,
      configured: false,
      signedIn: false,
      error: "A nuvem Google Drive está disponível no aplicativo instalado para Windows ou Android.",
    };
  }
  return (
    (await driveJson<DriveState>("DriveGetState")) ?? {
      ok: false,
      configured: false,
      signedIn: false,
      error: "Não foi possível consultar o estado da nuvem.",
    }
  );
}

export async function driveLogin(): Promise<DriveState> {
  return (
    (await driveJson<DriveState>("DriveLogin")) ?? {
      // O host existe (o botão só habilita com ele), então uma resposta vazia
      // não significa "nuvem não configurada": é falha/cancelamento do login.
      ok: false,
      configured: true,
      signedIn: false,
      error: "Login cancelado ou sem resposta.",
    }
  );
}

export async function driveLogout(): Promise<{ ok: boolean; error?: string }> {
  return (await driveJson<{ ok: boolean; error?: string }>("DriveLogout")) ?? { ok: false, error: "Sem resposta." };
}

export async function driveCheckRemote(): Promise<DriveCheck> {
  return (
    (await driveJson<DriveCheck>("DriveCheckRemote")) ?? {
      ok: false,
      exists: false,
      files: [],
      modifiedTime: 0,
      error: "Não foi possível consultar a nuvem.",
    }
  );
}

export async function driveRestoreFile(fileId: string): Promise<DriveRestoreResult> {
  const object = host();
  if (!object?.DriveRestoreFile) return { ok: false, error: "Nuvem indisponível." };
  try {
    const raw = await object.DriveRestoreFile(fileId);
    return JSON.parse(String(raw)) as DriveRestoreResult;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Falha ao baixar." };
  }
}

export async function driveBackup(payload: string): Promise<DriveBackupResult> {
  const object = host();
  if (!object?.DriveBackup) return { ok: false, error: "Nuvem indisponível." };
  try {
    const raw = await object.DriveBackup(payload);
    return JSON.parse(String(raw)) as DriveBackupResult;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Falha ao enviar." };
  }
}

export async function driveResetCloud(payload: string): Promise<DriveBackupResult> {
  const object = host();
  if (!object?.DriveResetCloud) return { ok: false, error: "Nuvem indisponível." };
  try {
    const raw = await object.DriveResetCloud(payload);
    return JSON.parse(String(raw)) as DriveBackupResult;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Falha ao apagar a nuvem." };
  }
}

export function printPage(): void {
  window.print();
}
