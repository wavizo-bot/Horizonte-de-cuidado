/**
 * Copia o build de produção do Vite para docs/app/, que é publicado pelo
 * GitHub Pages no mesmo commit da landing. O build é gerado, não editado à mão.
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const source = join(root, "dist");
const target = join(root, "docs", "app");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

const sourceInfo = await stat(source).catch(() => null);
if (!sourceInfo?.isDirectory()) {
  throw new Error("dist/ não existe. Rode o build do Vite antes de copiar docs/app/.");
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

const textExtensions = new Set([".html", ".css", ".js", ".mjs", ".json", ".txt", ".svg", ".xml", ".webmanifest"]);
const files = await walk(target);
let total = 0;
for (const file of files) {
  const bytes = await readFile(file);
  total += bytes.length;
  if (!textExtensions.has(file.slice(file.lastIndexOf(".")).toLowerCase())) continue;
  const text = bytes.toString("utf8");
  if (text.includes("\uFFFD")) {
    throw new Error(`${relative(root, file)}: caractere U+FFFD encontrado.`);
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${relative(root, file)}: BOM encontrado; salve em UTF-8 sem BOM.`);
  }
}

await writeFile(
  join(target, "BUILD.txt"),
  `Build de produção copiado de dist/ em ${new Date().toISOString()}.\n` +
    "Não editar arquivos gerados à mão; rode pnpm build.\n",
  "utf8",
);

console.log(`docs/app/ atualizado: ${files.length} arquivos, ${Math.round(total / 1024)} KB.`);
