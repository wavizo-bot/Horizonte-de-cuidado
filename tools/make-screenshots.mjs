import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import sharp from "sharp";

const root = process.cwd();
const appUrl = process.env.APP_URL || "http://127.0.0.1:4180/";
const outWeb = `${root}/docs/assets/screens`;
const outStore = `${root}/entregas/store`;
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const executablePath = process.env.BROWSER_PATH || (existsSync(edge) ? edge : chrome);

await Promise.all([
  mkdir(outWeb, { recursive: true }),
  mkdir(outStore, { recursive: true }),
]);

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  deviceScaleFactor: 1,
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
});
const page = await context.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(String(error)));

async function settle(ms = 700) {
  await page.waitForTimeout(ms);
}

async function hideScrollbars() {
  await page.addStyleTag({
    content: "html{scrollbar-width:none!important}body{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}",
  });
}

async function completeOnboarding() {
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await settle(500);
  if (await page.locator(".onboarding").count()) {
    await page.getByRole("button", { name: /Continuar/ }).click();
    await page.getByRole("button", { name: /Continuar/ }).click();
    await page.locator(".checkbox").click();
    await page.getByRole("button", { name: "Começar", exact: true }).click();
    await settle(1100);
  }
}

async function go(hash) {
  await page.goto(`${appUrl}#/${hash}`, { waitUntil: "networkidle" });
  await settle();
  await hideScrollbars();
}

async function capture(name, saveToStore = true) {
  const png = await page.screenshot({ fullPage: false });
  if (saveToStore) await writeFile(`${outStore}/${name}.png`, png);
  return png;
}

await completeOnboarding();

// 01 — visão geral
await go("hoje");
const today = await capture("01-hoje");

// 02 — agenda semanal
await go("agenda");
await page.getByRole("button", { name: "Semana", exact: true }).click();
await settle();
const agenda = await capture("02-agenda");

// 03 — pacientes
await go("pacientes");
const patients = await capture("03-pacientes");

// 04 — ficha do paciente
await page.locator(".patient-row").first().click();
await settle();
const patient = await capture("04-ficha");

// 05 — filas e prioridades
await go("filas");
const queues = await capture("05-filas");

// 06 — relatórios
await go("relatorios");
const reports = await capture("06-relatorios");

// 07 — grupos (somente landing; a loja usa seis capturas)
await go("grupos");
const groups = await capture("07-grupos", false);

// 08 — mensagens (somente landing)
await go("mensagens");
const messages = await capture("08-mensagens", false);

// 09 — ajustes / capacidade (somente landing)
await go("ajustes");
await page.getByRole("tab", { name: "Agenda e capacidade", exact: true }).click();
await settle();
const settings = await capture("09-ajustes", false);

// Mobile real (landing)
await page.setViewportSize({ width: 390, height: 844 });
await go("hoje");
const mobileToday = await page.screenshot({ fullPage: false });
await go("pacientes");
const mobilePatients = await page.screenshot({ fullPage: false });

// Landing: WebP com largura de 1366 px (desktop) e 390 px (celular).
const webShots = [
  ["tela-hoje.webp", today],
  ["tela-agenda.webp", agenda],
  ["tela-pacientes.webp", patients],
  ["tela-ficha.webp", patient],
  ["tela-filas.webp", queues],
  ["tela-relatorios.webp", reports],
  ["tela-grupos.webp", groups],
  ["tela-mensagens.webp", messages],
  ["tela-ajustes.webp", settings],
  ["tela-celular-hoje.webp", mobileToday],
  ["tela-celular-pacientes.webp", mobilePatients],
];

for (const [name, png] of webShots) {
  const mobile = name.includes("celular");
  const width = mobile ? 390 : 1366;
  const output = await sharp(png)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 80, effort: 6 })
    .toBuffer();
  if (output.length > 250 * 1024) {
    throw new Error(`${name}: ${Math.round(output.length / 1024)} KB excede o limite de 250 KB.`);
  }
  await writeFile(`${outWeb}/${name}`, output);
  console.log(`landing ${name} ${Math.round(output.length / 1024)} KB`);
}

// Store PNGs já estão em 1366x768. WebP não é reutilizado como original.

// Arte 9:16 (720x1080) e 1:1 (1080x1080) com telas reais.
const logo = await readFile(`${root}/docs/assets/logo.svg`);
const logoPng = await sharp(logo).resize(96, 96).png().toBuffer();

function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function posterSvg(width, height, titleLines, subtitle, lines) {
  const margin = Math.round(width * 0.07);
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#F6F1E6"/>
    <rect x="0" y="0" width="${width}" height="${Math.round(height * 0.30)}" fill="#174A3A"/>
    <text x="${margin}" y="${Math.round(height * 0.082)}" fill="#D9C9A8" font-family="Segoe UI, sans-serif" font-size="${Math.round(width * 0.021)}" letter-spacing="4">HORIZONTE DE CUIDADO</text>
    <text x="${margin}" y="${Math.round(height * 0.157)}" fill="#F6F1E6" font-family="Georgia, serif" font-size="${Math.round(width * 0.055)}">${escapeXml(titleLines[0])}</text>
    <text x="${margin}" y="${Math.round(height * 0.207)}" fill="#F6F1E6" font-family="Georgia, serif" font-size="${Math.round(width * 0.055)}">${escapeXml(titleLines[1])}</text>
    <text x="${margin}" y="${Math.round(height * 0.256)}" fill="#C9D6C9" font-family="Segoe UI, sans-serif" font-size="${Math.round(width * 0.023)}">${escapeXml(subtitle)}</text>
    <text x="${margin}" y="${Math.round(height * 0.288)}" fill="#D9C9A8" font-family="Segoe UI, sans-serif" font-size="${Math.round(width * 0.017)}">APOIO À ORGANIZAÇÃO DO CUIDADO · NÃO É PRONTUÁRIO</text>
    ${lines.map((line, index) => `<text x="${margin}" y="${Math.round(height * (width < 800 ? 0.70 : 0.83) + index * height * 0.033)}" fill="#174A3A" font-family="Segoe UI, sans-serif" font-size="${Math.round(width * 0.023)}">• ${escapeXml(line)}</text>`).join("")}
    ${width < 800 ? `<rect x="0" y="${Math.round(height * 0.88)}" width="${width}" height="${Math.round(height * 0.12)}" fill="#174A3A"/><text x="${margin}" y="${Math.round(height * 0.925)}" fill="#F6F1E6" font-family="Georgia, serif" font-size="${Math.round(width * 0.034)}">Cuidado organizado, decisão humana.</text><text x="${margin}" y="${Math.round(height * 0.958)}" fill="#C9D6C9" font-family="Segoe UI, sans-serif" font-size="${Math.round(width * 0.021)}">Windows 10/11 · MSIX · dados no seu dispositivo</text>` : `<text x="${margin}" y="${Math.round(height * 0.96)}" fill="#6F786F" font-family="Segoe UI, sans-serif" font-size="${Math.round(width * 0.017)}">Windows 10/11 · MSIX · apoio à organização do cuidado</text>`}
  </svg>`;
}

async function poster(name, width, height, png, titleLines, subtitle, lines) {
  const shotWidth = Math.round(width * 0.86);
  const shotHeight = Math.round(shotWidth * (768 / 1366));
  const top = Math.round(height * 0.315);
  const shot = await sharp(png).resize(shotWidth, shotHeight).png().toBuffer();
  const background = await sharp(Buffer.from(posterSvg(width, height, titleLines, subtitle, lines))).png().toBuffer();
  const composed = await sharp(background)
    .composite([
      { input: shot, left: Math.round(width * 0.07), top },
      { input: logoPng, left: width - 106, top: Math.round(height * 0.035) },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(`${outStore}/${name}`, composed);
  console.log(`store ${name}`);
}

await poster(
  "arte-720x1080.png",
  720,
  1080,
  today,
  ["O cuidado inteiro,", "num só horizonte."],
  "Filas, agenda, grupos e contatos com clareza.",
  ["Prioridades e matriciamento visíveis", "Planejamento de 90 dias preservando encaixes", "Mensagens prontas e registro de contatos", "Backup opcional na sua conta Google"],
);
await poster(
  "arte-1080x1080.png",
  1080,
  1080,
  agenda,
  ["Agenda que nasce", "da sua semana real."],
  "Capacidade por tipo, exceções e reposições.",
  ["Dias e vagas configuráveis", "Grupos semanais, quinzenais ou mensais", "Faltas e reposições registradas", "Relatórios de continuidade do cuidado"],
);

console.log("ERRORS", JSON.stringify(errors.slice(0, 20), null, 2));
await browser.close();
