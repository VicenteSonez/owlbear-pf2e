// Verificación rápida del parser contra el ejemplo (valores de la captura de Pathbuilder)
import { readFileSync } from "node:fs";
const { parsePathbuilder, damageFormula, mapSteps } = await import("../dist-test/pathbuilder.js");
const c = parsePathbuilder(JSON.parse(readFileSync("public/ejemplo-pathbuilder.json", "utf8")));
const get = (k) => c.skills.find((s) => s.key === k)?.mod;
const expect = {
  maxHp: [c.maxHp, 64], ac: [c.ac, 21], perception: [c.perception.mod, 11],
  fort: [c.saves[0].mod, 9], reflex: [c.saves[1].mod, 7], will: [c.saves[2].mod, 11],
  athletics: [get("athletics"), 11], medicine: [get("medicine"), 11], religion: [get("religion"), 9],
  lore: [get("lore:Scribing"), 6], nature: [get("nature"), 3], acrobatics: [get("acrobatics"), 1],
  dmg: [damageFormula(c.weapons[0]), "2d10+4"], map: [mapSteps(c.weapons[0]).join(","), "11,6,1"],
  daggerMap: [mapSteps(c.weapons[1]).join(","), "10,6,2"], speed: [c.speed, 30],
};
let fail = 0;
for (const [k, [got, want]] of Object.entries(expect)) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "OK " : "BAD"} ${k}: ${got} (esperado ${want})`);
}
process.exit(fail ? 1 : 0);
