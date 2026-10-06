// Tiradas automáticas (sin dados 3D): daño persistente, pruebas planas que lanza el GM, etc.
// Se publican igual que las tiradas normales, así aparecen en el registro y en las tarjetas.
import { evaluate, parseFormula, randomDie, randomValues } from "./dice";
import { degreeOf, persistentByType, type Degree, type PersistentDamage } from "./rules";
import { newId, type RollEntry } from "./shared";

export interface Roller {
  playerId: string;
  playerName: string;
  playerColor: string;
}

export function autoRoll(
  who: Roller,
  charName: string | undefined,
  label: string,
  formula: string,
  kind: RollEntry["kind"],
  crit = false,
): RollEntry {
  const f = parseFormula(formula);
  const out = evaluate(f, randomValues(f), { check: kind !== "damage", crit });
  return {
    id: newId(),
    time: Date.now(),
    ...who,
    charName,
    label,
    formula: crit ? `2×(${formula})` : formula,
    detail: out.detail,
    total: out.total,
    kind,
    nat: out.nat,
  };
}

// Prueba plana: solo importa si el d20 llega a la CD
export function autoFlat(who: Roller, charName: string | undefined, label: string, dc: number): RollEntry & { degree: Degree } {
  const d20 = randomDie(20);
  return {
    id: newId(),
    time: Date.now(),
    ...who,
    charName,
    label,
    formula: "1d20",
    detail: String(d20),
    total: d20,
    kind: "flat",
    dc,
    degree: d20 >= dc ? "success" : "failure",
    nat: d20 === 20 ? 20 : d20 === 1 ? 1 : undefined,
  };
}

// Tirada de recuperación: aquí sí cuentan el éxito/fallo crítico y el 20/1 natural
export function autoRecovery(who: Roller, charName: string | undefined, dying: number): RollEntry & { degree: Degree } {
  const d20 = randomDie(20);
  const dc = 10 + dying;
  return {
    id: newId(),
    time: Date.now(),
    ...who,
    charName,
    label: "Tirada de recuperación",
    formula: "1d20",
    detail: String(d20),
    total: d20,
    kind: "flat",
    dc,
    degree: degreeOf(d20, dc, d20),
    nat: d20 === 20 ? 20 : d20 === 1 ? 1 : undefined,
  };
}

// Resuelve todo el daño persistente de un objetivo: tira el daño, luego la prueba plana CD 15.
// Del mismo tipo solo cuenta el mayor y se hace una sola prueba plana, que lo termina entero.
// Devuelve el daño total, los efectos que terminan y las tiradas para publicar.
export function resolvePersistent(who: Roller, charName: string, list: PersistentDamage[]) {
  const entries: RollEntry[] = [];
  let damage = 0;
  const ended: string[] = [];
  for (const { top: p, ids } of persistentByType(list)) {
    let dmg: RollEntry;
    try {
      dmg = autoRoll(who, charName, `Daño persistente${p.type ? ` (${p.type})` : ""}`, p.formula, "damage", !!p.crit);
    } catch {
      continue;
    }
    damage += Math.max(0, dmg.total);
    entries.push(dmg);
    const flat = autoFlat(who, charName, `Fin del daño persistente${p.type ? ` (${p.type})` : ""}`, 15);
    entries.push(flat);
    if (flat.degree === "success") ended.push(...ids);
  }
  return { damage, ended, entries };
}
