import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const executablePath = process.env.BROWSER_PATH || (existsSync(edge) ? edge : chrome);
const out = "C:/Users/Maycon/AppData/Local/Temp/opencode/shots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push(String(err)));

async function settle() {
  await page.waitForTimeout(500);
}

async function shot(name, fullPage = true) {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage });
  console.log("shot", name);
}

await page.goto("http://127.0.0.1:4180/", { waitUntil: "networkidle" });
if (await page.locator(".onboarding").count()) {
  await page.getByRole("button", { name: /Continuar/ }).click();
  await page.getByRole("button", { name: /Continuar/ }).click();
  await page.locator(".checkbox").click();
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await page.waitForTimeout(900);
}
await shot("today");

const routes = [
  ["agenda", "agenda"],
  ["patients", "pacientes"],
  ["queues", "filas"],
  ["groups", "grupos"],
  ["messages", "mensagens"],
  ["reports", "relatorios"],
  ["settings", "ajustes"],
];
for (const [name, hash] of routes) {
  await page.goto(`http://127.0.0.1:4180/#/${hash}`);
  await settle();
  await shot(name);
}

// patient detail
await page.goto("http://127.0.0.1:4180/#/pacientes");
await settle();
await page.locator(".patient-row").first().click();
await settle();
await shot("patient-detail");

// agenda modes
await page.goto("http://127.0.0.1:4180/#/agenda");
await settle();
for (const label of ["Semana", "Mês"]) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await settle();
  await shot(`agenda-${label.toLowerCase()}`);
}

// settings tabs
await page.goto("http://127.0.0.1:4180/#/ajustes");
await settle();
for (const label of ["Agenda e capacidade", "Modelos de cuidado", "Mensagens", "Dados e importação", "Nuvem", "Sobre"]) {
  await page.getByRole("tab", { name: label, exact: true }).click();
  await settle();
  await shot(`settings-${label.split(" ")[0].toLowerCase()}`);
}

// mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:4180/#/hoje");
await settle();
await shot("mobile-today", false);
await page.goto("http://127.0.0.1:4180/#/pacientes");
await settle();
await shot("mobile-patients", false);

console.log("ERRORS", JSON.stringify(errors.slice(0, 30), null, 2));
await browser.close();
