// Captura o aplicativo nos viewports de tablet usados no teste físico
// (Xiaomi 2410CRP4CG: 3200x2136 fisicas, 440dpi => 1164x777 CSS em paisagem
// e 776x1163 CSS em retrato, fator de escala 2,75).
// Uso: APP_URL=http://127.0.0.1:4173/ OUT=<pasta> node tools/emulate-tablet.mjs
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const appUrl = process.env.APP_URL || "http://127.0.0.1:4173/";
const out = process.env.OUT || "dist/emulacao-tablet";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const executablePath = process.env.BROWSER_PATH || (existsSync(edge) ? edge : chrome);

const viewports = [
  { tag: "paisagem", width: 1164, height: 777 },
  { tag: "retrato", width: 776, height: 1163 },
];

const rotas = [
  { tag: "ajustes", hash: "ajustes", aba: "Agenda e capacidade" },
  { tag: "pacientes", hash: "pacientes" },
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];

for (const vp of viewports) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2.75,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  if (await page.locator(".onboarding").count()) {
    await page.getByRole("button", { name: /Continuar/ }).click();
    await page.getByRole("button", { name: /Continuar/ }).click();
    await page.locator(".checkbox").click();
    await page.getByRole("button", { name: "Começar", exact: true }).click();
    await page.waitForTimeout(1100);
  }

  for (const rota of rotas) {
    await page.goto(`${appUrl}#/${rota.hash}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    if (rota.aba) {
      await page.getByRole("tab", { name: rota.aba, exact: true }).click();
      await page.waitForTimeout(500);
    }
    const file = `${out}/emu-tab-${rota.tag}-${vp.tag}.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log(`salvo ${file}`);
  }

  await context.close();
}

console.log("ERRORS", JSON.stringify(errors.slice(0, 10), null, 2));
await browser.close();
