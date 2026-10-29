/**
 * Gera dados/importacao-planilha.json a partir da planilha real de encaminhamentos.
 *
 * O arquivo gerado contém dados pessoais e NUNCA deve ser publicado. Ele é
 * ignorado pelo git (dados/) e serve para importar o conteúdo no aplicativo
 * pelo fluxo "Dados e importação → Importar JSON".
 *
 * Uso:
 *   pnpm import-sheet
 *   pnpm import-sheet -- --url "https://.../gviz/tq?tqx=out:csv&sheet=encaminhamentos"
 *   pnpm import-sheet -- --out "C:/caminho/seguro/importacao.json"
 *
 * Variáveis opcionais:
 *   SHEET_CSV_URL  URL CSV publicada da planilha
 *   SHEET_NAME     nome da aba (usado só no metadado)
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";

const DEFAULT_URL =
  "https://docs.google.com/spreadsheets/d/1hlywJQV4E8tERijJbCA-DUA5xx_NQRzxDomAssmc69w/gviz/tq?tqx=out:csv&sheet=encaminhamentos";

function argValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const url = argValue("url") || process.env.SHEET_CSV_URL || DEFAULT_URL;
const sheet = argValue("sheet") || process.env.SHEET_NAME || "encaminhamentos";
const out = resolve(argValue("out") || "dados/importacao-planilha.json");

function fail(message) {
  console.error(`\nERRO: ${message}\n`);
  process.exitCode = 1;
}

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) {
    const value = item[key] ?? "(vazio)";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  console.log(`Baixando planilha: ${url}`);
  const response = await fetch(url, {
    headers: { "user-agent": "HorizonteDeCuidado/1.0 (importacao local)" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`a planilha respondeu HTTP ${response.status}. Confira se o link está publicado para leitura.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const csv = await response.text();
  if (!csv.trim()) throw new Error("a planilha veio vazia.");
  if (/^\s*<(!doctype|html)/i.test(csv)) {
    throw new Error("o link devolveu HTML, não CSV. Use a URL gviz com tqx=out:csv ou publique a aba como CSV.");
  }
  if (!/text\/csv|text\/plain|application\/octet-stream/i.test(contentType)) {
    console.warn(`Aviso: content-type inesperado (${contentType || "ausente"}). Seguindo como CSV.`);
  }

  // Usa exatamente o mesmo importador do aplicativo (via SSR do Vite), para
  // que o JSON gerado tenha o mesmo formato do fluxo de importação da interface.
  const server = await createServer({
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true },
  });
  let payload;
  try {
    const defaults = await server.ssrLoadModule("/src/lib/defaults.ts");
    const importer = await server.ssrLoadModule("/src/lib/import.ts");
    const base = defaults.emptyState();
    const result = importer.importFromTable(base, csv);
    const imported = result.state.patients.filter((patient) => patient.source === "importacao-planilha");
    if (imported.length === 0) {
      throw new Error("nenhum paciente foi reconhecido. Confira o cabeçalho e as colunas A–J.");
    }
    const referencedModels = new Set(imported.map((patient) => patient.careModelId).filter(Boolean));
    payload = {
      app: "horizonte-de-cuidado",
      version: 1,
      generatedAt: new Date().toISOString(),
      source: {
        url,
        sheet,
        rowCount: imported.length,
        sha256: createHash("sha256").update(csv, "utf8").digest("hex"),
      },
      patients: imported,
      careModels: result.state.careModels.filter((model) => referencedModels.has(model.id)),
    };

    console.log("\nResumo da importação");
    console.log(`- linhas processadas: ${result.summary.added + result.summary.updated + result.summary.skipped}`);
    console.log(`- pacientes únicos: ${imported.length}`);
    console.log(`- novos pacientes: ${result.summary.added}`);
    console.log(`- consolidados por cadastro repetido: ${result.summary.updated}`);
    console.log(`- ignorados: ${result.summary.skipped}`);
    if (result.summary.updated > 0) {
      console.log("  (a planilha tem mais de uma linha para o mesmo cadastro; ficou a última ocorrência)");
    }
    console.log(`- modelos de cuidado referenciados: ${payload.careModels.length}`);
    if (result.summary.createdModels.length) {
      console.log(`- modelos criados: ${result.summary.createdModels.join(", ")}`);
    }
    const withoutPhone = imported.filter((patient) => !patient.phone).length;
    const withoutTriage = imported.filter((patient) => !patient.triageDate).length;
    const priority = imported.filter((patient) => patient.priority).length;
    console.log(`- sem telefone: ${withoutPhone}`);
    console.log(`- sem data de triagem: ${withoutTriage}`);
    console.log(`- marcados como prioritários por sinal textual: ${priority}`);
    console.log("\nDistribuição por modelo:");
    for (const [modelId, total] of countBy(imported, "careModelId")) {
      const model = payload.careModels.find((item) => item.id === modelId);
      console.log(`  ${model?.name ?? modelId}: ${total}`);
    }
    if (result.summary.warnings.length) {
      console.log("\nAvisos:");
      for (const warning of result.summary.warnings) console.log(`  - ${warning}`);
    }
  } finally {
    await server.close();
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`\nArquivo gerado: ${out}`);
  console.log("ATENÇÃO: este arquivo contém dados pessoais. Não publique, não envie por e-mail e mantenha fora do repositório.");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
