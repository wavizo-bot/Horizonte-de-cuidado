import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import sharp from "sharp";

/*
 * Gera os assets da ficha do Google Play a partir do app web empacotado.
 * As capturas usam dados fictícios do onboarding e saem em 1080x1920
 * (viewport 540x960 com deviceScaleFactor 2), proporção 9:16 aceita pela loja.
 *
 * Uso:
 *   node tools/serve-docs.mjs        # em outro terminal, porta 4190
 *   node tools/make-play-assets.mjs
 */

const root = process.cwd();
const appUrl = process.env.APP_URL || "http://127.0.0.1:4190/app/";
const out = `${root}/entregas/play`;
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const executablePath = process.env.BROWSER_PATH || (existsSync(edge) ? edge : chrome);

await mkdir(out, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 2,
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
  reducedMotion: "reduce",
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
    content:
      "html{scrollbar-width:none!important}body{scrollbar-width:none!important}" +
      "::-webkit-scrollbar{display:none!important}",
  });
}

async function completeOnboarding() {
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await settle(500);
  if (!(await page.locator(".onboarding").count())) return;
  await page.getByRole("button", { name: /Continuar/ }).click();
  await page.getByRole("button", { name: /Continuar/ }).click();
  const demo = page.locator(".onboarding-choice", {
    hasText: "Explorar com dados fictícios",
  });
  if (await demo.count()) await demo.click();
  await page.locator(".checkbox").click();
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await settle(1200);
}

async function go(hash) {
  await page.goto(`${appUrl}#/${hash}`, { waitUntil: "networkidle" });
  await settle();
  await hideScrollbars();
}

async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  const meta = await sharp(`${out}/${name}.png`).metadata();
  if (meta.width !== 1080 || meta.height !== 1920) {
    throw new Error(`${name}: esperado 1080x1920, obtido ${meta.width}x${meta.height}`);
  }
  console.log(`play ${name} ${meta.width}x${meta.height}`);
}

await completeOnboarding();

await go("hoje");
await shot("telefone-01-hoje");

await go("agenda");
await shot("telefone-02-agenda");

await go("pacientes");
await shot("telefone-03-pacientes");

await page.locator(".patient-row").first().click();
await settle();
await shot("telefone-04-ficha");

await go("mensagens");
await shot("telefone-05-mensagens");

await go("filas");
await shot("telefone-06-filas");

// Tablet: as capturas 1366x768 já existentes mostram o layout de tablet.
for (const [source, target] of [
  ["01-hoje.png", "tablet-01-hoje.png"],
  ["02-agenda.png", "tablet-02-agenda.png"],
  ["03-pacientes.png", "tablet-03-pacientes.png"],
  ["04-ficha.png", "tablet-04-ficha.png"],
  ["05-filas.png", "tablet-05-filas.png"],
  ["06-relatorios.png", "tablet-06-relatorios.png"],
]) {
  const from = `${root}/entregas/store/${source}`;
  if (existsSync(from)) {
    await copyFile(from, `${out}/${target}`);
    console.log(`play ${target} (1366x768)`);
  }
}

await copyFile(`${root}/public/icons/icon-512.png`, `${out}/icone-512.png`);
await copyFile(`${root}/docs/assets/feature-1024x500.png`, `${out}/feature-1024x500.png`);
console.log("play icone-512.png e feature-1024x500.png");

const iconMeta = await sharp(`${out}/icone-512.png`).metadata();
const featureMeta = await sharp(`${out}/feature-1024x500.png`).metadata();
if (iconMeta.width !== 512 || iconMeta.height !== 512) throw new Error("ícone fora de 512x512");
if (featureMeta.width !== 1024 || featureMeta.height !== 500) {
  throw new Error("feature graphic fora de 1024x500");
}

const privacy = "https://wavizo-bot.github.io/Horizonte-de-cuidado/politica-de-privacidade.html";
const ficha = `# Google Play — Horizonte de Cuidado

## Identidade

- Nome do aplicativo: **Horizonte de Cuidado**
- Pacote: \`horizonte.de.cuidado\`
- Versão: 1.0.0 (versionCode 1)
- Categoria: Medicina (ou Saúde e fitness)
- Público-alvo: profissionais e equipes de saúde mental (18+)
- Classificação etária: definir no questionário do Play; não direcionado a crianças
- Preço: gratuito, sem compras no aplicativo

## Textos

### Nome (30 caracteres)

Horizonte de Cuidado

### Descrição curta (80 caracteres)

Agenda, filas e contatos para equipes de saúde mental, com dados no aparelho.

### Descrição completa (até 4.000 caracteres)

O Horizonte de Cuidado organiza o trabalho diário de equipes de saúde mental:
encaminhamentos, fila de matriciamento, agenda de 90 dias, grupos, atendimentos
individuais, mensagens prontas para WhatsApp e relatórios de continuidade.

- Filas com tempo de espera, prioridade e próxima vaga de matriciamento.
- Agenda com capacidade por tipo de vaga, dias fechados, exceções e encaixes.
- Grupos semanais, quinzenais ou mensais, com participantes e limite.
- Ficha de acompanhamento com anotações e registro de tentativas de contato.
- Mensagens prontas; o envio pelo WhatsApp continua sendo uma decisão humana.
- Importação de planilha e exportação dos dados.
- Backup opcional na pasta privada do Google Drive (drive.appdata).

O caderno fica no aparelho, cifrado com AES-GCM de 256 bits. Não há servidor
próprio, anúncios, analytics ou venda de dados. O backup na nuvem é opcional e
usa a conta Google do próprio usuário.

O Horizonte de Cuidado é uma ferramenta independente de apoio à organização.
Não é prontuário eletrônico, sistema oficial do SUS, dispositivo médico ou canal
de emergência. Não decide diagnóstico, prescrição, risco ou internação. As
sugestões de agenda são operacionais; a decisão final é sempre da equipe
profissional.

### Novidades da versão 1.0.0

Primeira versão para Android: agenda, filas, pacientes, grupos, mensagens,
relatórios, importação/exportação e backup opcional no Google Drive.

## Privacidade e segurança

- Política de privacidade: ${privacy}
- O token do Google fica cifrado no Android Keystore.
- O aplicativo não solicita localização, câmera, microfone, contatos ou SMS.
- Permissões: internet (Google Drive). No Android 7–9, o app pede permissão de
  armazenamento apenas para salvar exportações em Downloads; do Android 10 em
  diante usa MediaStore sem permissão. A importação usa o seletor de arquivos do
  sistema (SAF), sem acesso amplo ao armazenamento.
- Login Google nativo, sem WebView de login e sem navegador externo.

## Segurança de dados (respostas sugeridas)

- O app coleta dados? Sim, para funcionalidade e backup opcional: informações
  pessoais (nome, telefone, data de nascimento) e informações de saúde
  (encaminhamento, prioridade, atendimentos, anotações).
- Os dados são compartilhados? Não com o desenvolvedor nem com terceiros. O
  backup opcional vai para a pasta privada \`appDataFolder\` da conta Google do
  próprio usuário; o desenvolvedor não tem acesso.
- Os dados são cifrados em trânsito? Sim (HTTPS/TLS). Em repouso, o caderno local
  usa AES-GCM; o backup no Drive é JSON claro protegido pela conta Google.
- Os dados são opcionais? Sim. O app funciona sem conta Google e sem backup.
- Exclusão: o usuário pode apagar os dados locais em Ajustes e excluir o backup
  no Drive; também pode desinstalar o app. Contato de privacidade disponível.
- Anúncios ou rastreamento? Não. Sem Advertising ID, analytics ou venda de dados.
- Público infantil? Não. Ferramenta para profissionais; não direcionada a menores.

## Assets nesta pasta

- \`icone-512.png\` — ícone 512x512.
- \`feature-1024x500.png\` — feature graphic.
- \`telefone-01-hoje.png\` a \`telefone-06-filas.png\` — 6 capturas 1080x1920.
- \`tablet-01-hoje.png\` a \`tablet-06-relatorios.png\` — 6 capturas 1366x768.

## Checklist de envio

1. Criar o app no Play Console com o pacote \`horizonte.de.cuidado\`.
2. Ativar o Play App Signing. O SHA-1 do certificado do Play
   (\`12:5B:4F:5D:22:58:61:40:7C:59:12:FD:B4:52:29:E5:37:F7:72:D8\`) precisa
   estar cadastrado no cliente OAuth Android do projeto. Para testar o APK
   local, cadastre também o SHA-1 da upload key
   (\`35:14:75:E6:C6:E1:EE:F8:DF:3F:5D:03:70:C5:DC:5C:A1:B8:74:F6\`).
3. Enviar \`app-release.aab\` em teste interno; instalar pelo Play e concluir o
   login Google/Drive no aparelho. O APK assinado localmente não autentica
   enquanto o SHA-1 da upload key não estiver no Console.
4. Preencher a ficha, classificação de conteúdo, segurança de dados e público.
5. Revisar os documentos legais e publicar em produção.
`;

await writeFile(`${out}/ficha-play.md`, ficha, "utf8");
await writeFile(
  `${out}/descricao-pt-br.txt`,
  `Horizonte de Cuidado\n\n` +
    `O Horizonte de Cuidado organiza o trabalho diário de equipes de saúde mental: ` +
    `encaminhamentos, fila de matriciamento, agenda de 90 dias, grupos, atendimentos ` +
    `individuais, mensagens prontas para WhatsApp e relatórios de continuidade.\n\n` +
    `O caderno fica no aparelho, cifrado com AES-GCM de 256 bits. O backup no Google ` +
    `Drive é opcional e usa a conta do próprio usuário. Não há servidor próprio, ` +
    `anúncios ou analytics.\n\n` +
    `Ferramenta independente de apoio à organização. Não é prontuário eletrônico, ` +
    `sistema oficial do SUS, dispositivo médico ou canal de emergência.\n`,
  "utf8",
);

console.log("ERRORS", JSON.stringify(errors.slice(0, 20), null, 2));
await browser.close();
