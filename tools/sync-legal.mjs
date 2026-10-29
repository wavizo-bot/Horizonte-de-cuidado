import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = process.cwd();
const source = join(root, "public", "legal");
const target = join(root, "docs");
const files = [
  "legal.css",
  "politica-de-privacidade.html",
  "termos-de-servico.html",
  "aviso-legal.html",
  "suporte.html",
];

await mkdir(target, { recursive: true });
for (const file of files) {
  const from = join(source, file);
  const to = join(target, file);
  const bytes = await readFile(from);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${file}: BOM encontrado; salve em UTF-8 sem BOM.`);
  }
  const text = bytes.toString("utf8");
  if (text.includes("\uFFFD")) throw new Error(`${file}: caractere U+FFFD encontrado.`);
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, bytes);
}
console.log(`Documentos legais sincronizados: ${files.length} arquivos em docs/.`);
