import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Confere se dados reais da planilha local vazaram para arquivos públicos.
 * A base real fica em dados/importacao-planilha.json, ignorada pelo git.
 * Sem essa base, a verificação é pulada (ex.: clone público).
 */
const root = process.cwd();
const dataPath = join(root, "dados", "importacao-planilha.json");
if (!existsSync(dataPath)) {
  console.log("Privacidade: base real ausente; verificação local pulada.");
  process.exit(0);
}

const payload = JSON.parse(readFileSync(dataPath, "utf8"));
const patients = Array.isArray(payload) ? payload : payload.patients;
if (!Array.isArray(patients)) {
  throw new Error("dados/importacao-planilha.json não contém uma lista de pacientes.");
}

const binary = /\.(png|jpe?g|webp|gif|ico|ttf|woff2?|cer|pfx|p12|msix|appx|dll|exe|zip|gz|pdf)$/i;
const stopwords = new Set(["de", "da", "do", "das", "dos", "e"]);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function words(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token && !stopwords.has(token));
}

function nameWindows(name) {
  const tokens = words(name);
  if (tokens.length < 2) return [];
  if (tokens.length === 2) return [tokens.join(" ")];
  const windows = [];
  for (let index = 0; index <= tokens.length - 3; index += 1) {
    windows.push(tokens.slice(index, index + 3).join(" "));
  }
  return windows;
}

function mask(value, visible = 2) {
  const text = String(value ?? "");
  return text.length <= visible ? "***" : `***${text.slice(-visible)}`;
}

function trackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  return output.split("\0").filter(Boolean);
}

function extraFiles(directory) {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (!binary.test(entry.name)) {
        found.push(relative(root, path));
      }
    }
  };
  walk(absolute);
  return found;
}

const files = [...new Set([...trackedFiles(), ...extraFiles("dist"), ...extraFiles("msix/staging/www")])]
  .filter((file) => !binary.test(file));

const sources = [];
for (const file of files) {
  try {
    if (statSync(join(root, file)).size > 8 * 1024 * 1024) continue;
    const text = readFileSync(join(root, file), "utf8");
    sources.push({ file, text, tokens: ` ${words(text).join(" ")} ` });
  } catch {
    // Arquivo binário ou ilegível: ignorado.
  }
}

const findings = [];
patients.forEach((patient, index) => {
  const reference = `paciente #${index + 1}`;
  const windows = nameWindows(patient.name);
  const registration = String(patient.registrationNumber ?? "").replace(/\D/g, "");
  const phone = String(patient.phone ?? "").replace(/\D/g, "");
  const phonePattern = phone.length >= 9
    ? new RegExp(phone.slice(-9).split("").join("[^0-9]{0,2}"))
    : null;

  for (const source of sources) {
    const nameHit = windows.find((window) => source.tokens.includes(` ${window} `));
    if (nameHit) {
      findings.push({ file: source.file, kind: "nome", reference, value: mask(nameHit) });
    }
    if (registration.length >= 5) {
      const pattern = new RegExp(`(^|[^0-9])${registration}([^0-9]|$)`);
      if (pattern.test(source.text)) {
        findings.push({ file: source.file, kind: "matrícula", reference, value: mask(registration) });
      }
    }
    if (phonePattern && phonePattern.test(source.text)) {
      findings.push({ file: source.file, kind: "telefone", reference, value: mask(phone, 4) });
    }
  }
});

if (findings.length > 0) {
  console.error("Privacidade: possíveis dados reais encontrados em arquivos públicos.");
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.kind} do ${finding.reference} (${finding.value})`);
  }
  process.exit(1);
}

console.log(`Privacidade: ${sources.length} arquivos públicos conferidos; nenhum dado real encontrado.`);
