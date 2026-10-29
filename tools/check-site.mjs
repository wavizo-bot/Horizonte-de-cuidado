import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const root = process.cwd();
const docs = resolve(root, "docs");
const out = resolve(root, "entregas", "qa");
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const executablePath = process.env.BROWSER_PATH || (existsSync(edge) ? edge : chrome);

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(String(error)));

const url = process.env.SITE_URL_CHECK || "http://127.0.0.1:4190/";
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
// Carrega imagens percorrendo a página antes de medir.
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 600) {
    window.scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  window.scrollTo(0, 0);
});
await page.waitForFunction(() => [...document.images].every((image) => image.complete), null, { timeout: 15000 });
await page.waitForTimeout(300);

const report = await page.evaluate(() => {
  const images = [...document.images].map((image) => ({
    src: image.getAttribute("src"),
    loaded: image.complete && image.naturalWidth > 0,
  }));
  const links = [...document.querySelectorAll("a[href]")].map((anchor) => anchor.getAttribute("href"));
  const description = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
  return {
    title: document.title,
    descriptionLength: description.length,
    h1: document.querySelectorAll("h1").length,
    images,
    links,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
});

const missing = [];
for (const href of new Set(report.links)) {
  if (!href || href.startsWith("#") || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
  const clean = decodeURIComponent(href.split("#")[0].split("?")[0]);
  if (!clean) continue;
  const file = resolve(docs, clean);
  try {
    await stat(file);
  } catch {
    missing.push(href);
  }
}

await page.screenshot({ path: `${out}/landing-1366.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 500) {
    window.scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  window.scrollTo(0, 0);
});
await page.waitForFunction(() => [...document.images].every((image) => image.complete), null, { timeout: 15000 });
await page.waitForTimeout(400);
const mobile = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  width: document.documentElement.scrollWidth,
}));
await page.screenshot({ path: `${out}/landing-390.png`, fullPage: true });

const landingErrors = [...errors];
errors.length = 0;

// Versão web publicada em docs/app/.
const appUrl = new URL("app/", url).href;
await page.setViewportSize({ width: 1366, height: 768 });
await page.goto(appUrl, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const appDesktop = await page.evaluate(() => ({
  title: document.title,
  hasBrand: document.body.innerText.includes("Horizonte"),
  onboarding: Boolean(document.querySelector(".onboarding")),
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
await page.screenshot({ path: `${out}/app-1366.png`, fullPage: false });
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(appUrl, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const appMobile = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  width: document.documentElement.scrollWidth,
}));
await page.screenshot({ path: `${out}/app-390.png`, fullPage: false });
const appErrors = [...errors];

const unloaded = report.images.filter((image) => !image.loaded);
console.log(JSON.stringify({
  title: report.title,
  descriptionLength: report.descriptionLength,
  h1: report.h1,
  unloaded,
  missing,
  overflowDesktop: report.overflow,
  overflowMobile: mobile.overflow,
  mobileWidth: mobile.width,
  consoleErrors: landingErrors,
  app: {
    url: appUrl,
    title: appDesktop.title,
    hasBrand: appDesktop.hasBrand,
    onboarding: appDesktop.onboarding,
    overflowDesktop: appDesktop.overflow,
    overflowMobile: appMobile.overflow,
    mobileWidth: appMobile.width,
    consoleErrors: appErrors,
  },
}, null, 2));

await browser.close();
