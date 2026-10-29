import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const root = process.cwd();
const iconsDir = `${root}/public/icons`;
const msixAssets = `${root}/msix/Assets`;
const docsAssets = `${root}/docs/assets`;

await Promise.all([
  mkdir(iconsDir, { recursive: true }),
  mkdir(msixAssets, { recursive: true }),
  mkdir(docsAssets, { recursive: true }),
]);

const markBody = `
  <circle cx="512" cy="390" r="138" fill="#F6F1E6"/>
  <path d="M130 640c102-122 204-122 306 0s204 122 306 0 102-82 152-41"
        fill="none" stroke="#F6F1E6" stroke-width="56" stroke-linecap="round"/>
  <path d="M130 790c102-100 198-100 292 0s190 100 284 0 112-67 188-33"
        fill="none" stroke="#D9C9A8" stroke-width="36" stroke-linecap="round" opacity=".9"/>`;

const mark = (size, background = "#174A3A") => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${background}"/>
  ${markBody.trim()}
</svg>`;

const maskable = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#174A3A"/>
  <circle cx="512" cy="380" r="108" fill="#F6F1E6"/>
  <path d="M230 620c78-92 156-92 234 0s156 92 234 0 78-62 116-31"
        fill="none" stroke="#F6F1E6" stroke-width="44" stroke-linecap="round"/>
  <path d="M230 748c78-76 150-76 222 0s144 76 216 0 86-50 142-25"
        fill="none" stroke="#D9C9A8" stroke-width="28" stroke-linecap="round" opacity=".9"/>
</svg>`;

const wide = `
<svg xmlns="http://www.w3.org/2000/svg" width="310" height="150" viewBox="0 0 310 150">
  <rect width="310" height="150" fill="#174A3A"/>
  <g transform="translate(18 31) scale(.086)">
    ${markBody}
  </g>
  <text x="118" y="75" fill="#F6F1E6" font-family="Georgia, serif" font-size="30">Horizonte</text>
  <text x="120" y="105" fill="#D9C9A8" font-family="Segoe UI, sans-serif" font-size="18" letter-spacing="1">de Cuidado</text>
</svg>`;

const splash = `
<svg xmlns="http://www.w3.org/2000/svg" width="620" height="300" viewBox="0 0 620 300">
  <rect width="620" height="300" fill="#174A3A"/>
  <g transform="translate(250 26) scale(.16)">
    ${markBody}
  </g>
  <text x="310" y="252" text-anchor="middle" fill="#F6F1E6" font-family="Georgia, serif" font-size="34">Horizonte de Cuidado</text>
</svg>`;

async function png(svg, size, file) {
  await sharp(Buffer.from(svg)).resize(size, size, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(file);
}

const sizes = [16, 32, 48, 64, 72, 96, 128, 150, 180, 192, 256, 512];
await Promise.all(sizes.map((size) => png(mark(1024), size, `${iconsDir}/icon-${size}.png`)));
await png(maskable(1024), 512, `${iconsDir}/maskable-512.png`);
await png(mark(1024), 180, `${iconsDir}/apple-touch-icon.png`);

await png(mark(1024), 44, `${msixAssets}/Square44x44Logo.png`);
await png(mark(1024), 150, `${msixAssets}/Square150x150Logo.png`);
await png(mark(1024), 50, `${msixAssets}/StoreLogo.png`);
await sharp(Buffer.from(wide)).png({ compressionLevel: 9 }).toFile(`${msixAssets}/Wide310x150Logo.png`);
await sharp(Buffer.from(splash)).png({ compressionLevel: 9 }).toFile(`${msixAssets}/SplashScreen.png`);
await png(mark(1024), 512, `${msixAssets}/Square512x512Logo.png`);
await png(mark(1024), 300, `${docsAssets}/store-logo-300.png`);

const og = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F6F1E6"/>
  <rect x="54" y="54" width="1092" height="522" rx="36" fill="#174A3A"/>
  <g transform="translate(100 115) scale(.30)">
    ${markBody}
  </g>
  <text x="475" y="252" fill="#F6F1E6" font-family="Georgia, serif" font-size="88">Horizonte</text>
  <text x="479" y="326" fill="#D9C9A8" font-family="Georgia, serif" font-size="64">de Cuidado</text>
  <text x="479" y="402" fill="#F6F1E6" font-family="Segoe UI, sans-serif" font-size="27">Agenda, filas e comunicação para a saúde mental.</text>
  <text x="479" y="450" fill="#C9D6C9" font-family="Segoe UI, sans-serif" font-size="22">Planejamento de 90 dias · grupos · contatos · relatórios</text>
  <text x="110" y="526" fill="#D9C9A8" font-family="Segoe UI, sans-serif" font-size="21" letter-spacing="3">APOIO À ORGANIZAÇÃO DO CUIDADO — NÃO É PRONTUÁRIO</text>
</svg>`;
await sharp(Buffer.from(og)).png({ compressionLevel: 9 }).toFile(`${docsAssets}/og-horizonte.png`);

const feature = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
  <rect width="1024" height="500" fill="#174A3A"/>
  <g transform="translate(70 110) scale(.25)">
    ${markBody}
  </g>
  <text x="370" y="245" fill="#F6F1E6" font-family="Georgia, serif" font-size="76">Horizonte</text>
  <text x="374" y="308" fill="#D9C9A8" font-family="Georgia, serif" font-size="54">de Cuidado</text>
  <text x="374" y="360" fill="#C9D6C9" font-family="Segoe UI, sans-serif" font-size="22">Saúde mental organizada,</text>
  <text x="374" y="392" fill="#C9D6C9" font-family="Segoe UI, sans-serif" font-size="22">sem transformar pessoas em números.</text>
</svg>`;
await sharp(Buffer.from(feature)).png({ compressionLevel: 9 }).toFile(`${docsAssets}/feature-1024x500.png`);

await writeFile(`${docsAssets}/logo.svg`, mark(1024), "utf8");
console.log("Assets gerados.");
