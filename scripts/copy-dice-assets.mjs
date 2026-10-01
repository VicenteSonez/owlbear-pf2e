// Copia los assets de los dados 3D a public/dice-box:
// - física (ammo) y tema "default" de @3d-dice/dice-box
// - temas extra de @3d-dice/dice-themes (los que traen d4–d20)
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dest = resolve(root, "public/dice-box");
const boxAssets = resolve(root, "node_modules/@3d-dice/dice-box/dist/assets");
const themesDir = resolve(root, "node_modules/@3d-dice/dice-themes/themes");

// Debe coincidir con DICE_THEMES en src/dice.ts
const EXTRA_THEMES = ["smooth", "gemstone", "rock", "rust", "wooden", "gemstoneMarble", "blueGreenMetal", "diceOfRolling"];

if (!existsSync(boxAssets) || !existsSync(themesDir)) {
  console.error("No se encontraron los assets de los dados. ¿Ejecutaste npm install?");
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
cpSync(boxAssets, dest, { recursive: true });
for (const theme of EXTRA_THEMES) {
  cpSync(resolve(themesDir, theme), resolve(dest, "themes", theme), { recursive: true });
}
console.log(`Assets de dados copiados a public/dice-box (${EXTRA_THEMES.length + 1} temas)`);
