// Copia los assets de @3d-dice/dice-box (física ammo + tema) a public/dice-box
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/@3d-dice/dice-box/dist/assets");
const dest = resolve(root, "public/dice-box");

if (!existsSync(src)) {
  console.error("No se encontraron los assets de dice-box. ¿Ejecutaste npm install?");
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("Assets de dados copiados a public/dice-box");
