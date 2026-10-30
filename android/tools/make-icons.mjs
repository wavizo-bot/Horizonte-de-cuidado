/**
 * Gera os ícones Android a partir de public/icons/.
 *
 * - ic_launcher.png: ícone legado (quadrado) em todas as densidades.
 * - ic_launcher_round.png: mesma arte recortada em círculo.
 * - ic_launcher_foreground.png: camada do ícone adaptativo (Android 8+),
 *   com a arte maskable centralizada na zona segura de 108 dp.
 * - mipmap-anydpi-v26/ic_launcher*.xml: declaração do ícone adaptativo.
 *
 * Uso: node android/tools/make-icons.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const res = join(root, "android", "app", "src", "main", "res");
const source = join(root, "public", "icons", "icon-512.png");
const maskable = join(root, "public", "icons", "maskable-512.png");

const DENSITIES = [
  { name: "mdpi", launcher: 48, foreground: 108 },
  { name: "hdpi", launcher: 72, foreground: 162 },
  { name: "xhdpi", launcher: 96, foreground: 216 },
  { name: "xxhdpi", launcher: 144, foreground: 324 },
  { name: "xxxhdpi", launcher: 192, foreground: 432 },
];

const BACKGROUND = "#174A3A";

async function circleMask(size) {
  const r = size / 2;
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      `<circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`,
  );
}

for (const density of DENSITIES) {
  const dir = join(res, `mipmap-${density.name}`);
  await mkdir(dir, { recursive: true });

  const square = await sharp(source)
    .resize(density.launcher, density.launcher, { fit: "cover" })
    .png()
    .toBuffer();
  await writeFile(join(dir, "ic_launcher.png"), square);

  const mask = await circleMask(density.launcher);
  const round = await sharp(square)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  await writeFile(join(dir, "ic_launcher_round.png"), round);

  // A arte maskable ocupa 64% da camada de 108 dp: fica inteira dentro da
  // zona segura (66 dp) e o quadrado verde se funde ao fundo da mesma cor.
  const art = Math.round(density.foreground * 0.64);
  const offset = Math.round((density.foreground - art) / 2);
  const foreground = await sharp({
    create: {
      width: density.foreground,
      height: density.foreground,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp(maskable).resize(art, art, { fit: "cover" }).png().toBuffer(),
        left: offset,
        top: offset,
      },
    ])
    .png()
    .toBuffer();
  await writeFile(join(dir, "ic_launcher_foreground.png"), foreground);
}

const anydpi = join(res, "mipmap-anydpi-v26");
await mkdir(anydpi, { recursive: true });
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
await writeFile(join(anydpi, "ic_launcher.xml"), adaptive);
await writeFile(join(anydpi, "ic_launcher_round.xml"), adaptive);

await writeFile(
  join(res, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BACKGROUND}</color>
</resources>
`,
);

console.log("Ícones Android gerados em android/app/src/main/res/.");
