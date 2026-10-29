import type { AppState } from "../types";

const STATE_KEY = "horizonte-state-v1";
const KEY_KEY = "horizonte-key-v1";
const PLAIN_PREFIX = "plain:";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getKey(): Promise<CryptoKey> {
  const stored = localStorage.getItem(KEY_KEY);
  if (stored) {
    const raw = fromBase64(stored);
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }
  const raw = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(KEY_KEY, toBase64(raw));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptText(text: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded));
  const combined = new Uint8Array(iv.length + cipher.length);
  combined.set(iv, 0);
  combined.set(cipher, iv.length);
  return `enc:${toBase64(combined)}`;
}

export async function decryptText(payload: string): Promise<string> {
  if (payload.startsWith(PLAIN_PREFIX)) return payload.slice(PLAIN_PREFIX.length);
  if (!payload.startsWith("enc:")) return payload;
  const key = await getKey();
  const combined = fromBase64(payload.slice(4));
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

export async function saveSecure(key: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  const encrypted = await encryptText(text);
  localStorage.setItem(key, encrypted);
}

export async function loadSecure<T>(key: string): Promise<T | null> {
  const payload = localStorage.getItem(key);
  if (!payload) return null;
  try {
    const text = await decryptText(payload);
    return JSON.parse(text) as T;
  } catch {
    // Compatibilidade com uma base antiga não cifrada.
    try {
      return JSON.parse(payload) as T;
    } catch {
      return null;
    }
  }
}

export async function removeSecure(key: string): Promise<void> {
  localStorage.removeItem(key);
}

export async function loadState(): Promise<{ state?: AppState; error?: string }> {
  try {
    const state = await loadSecure<AppState>(STATE_KEY);
    return { state: state ?? undefined };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao abrir os dados locais." };
  }
}

export async function saveState(state: AppState): Promise<void> {
  await saveSecure(STATE_KEY, state);
}

export async function clearStoredState(): Promise<void> {
  localStorage.removeItem(STATE_KEY);
}

export function storageInfo(): { keyPresent: boolean; bytes: number } {
  const payload = localStorage.getItem(STATE_KEY) ?? "";
  return { keyPresent: Boolean(localStorage.getItem(KEY_KEY)), bytes: payload.length };
}
