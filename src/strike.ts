// Ataque y daño de un arma con todo lo que los modifica: condiciones, bonos del jugador,
// objetivo elegido y rasgos de clase (Furia, Ataque furtivo, Golpe preciso…). Puro.
import { fmtMod, type Character, type Weapon } from "./pathbuilder";
import type { PcState } from "./live";
import type { Extras } from "./extras";
import { conditionMods, modsText, stackMods, type Conditions, type Mod } from "./rules";
import {
  antithesisBonus,
  guessSlinger,
  preciseStrike,
  rageDamage,
  rangerPrecisionDice,
  slingerDamage,
  strategicStrikeDice,
  type Features,
  type SlingerKind,
} from "./classes";

export interface StrikeTarget {
  // "npc:<tokenId>"
  key: string;
  tok: string;
  cond: Conditions;
}

export interface StrikeOpts {
  target?: StrikeTarget;
  // Golpe de gracia (requiere Panache)
  finisher?: boolean;
  // Primer ataque del turno contra la presa (ventaja Precisión)
  preyFirst?: boolean;
  // Usar la tirada guardada de Divisar estratagema
  stratagem?: boolean;
  // Ataque furtivo forzado a mano (si el objetivo no figura desprevenido)
  sneak?: boolean;
  // Ráfaga contra la presa forzada a mano
  flurry?: boolean;
}

export interface StrikeContext {
  c: Character;
  s?: PcState;
  x: Extras;
  f: Features;
  slinger?: SlingerKind;
}

const customMods = (x: Extras, to: "atk" | "dmg"): Mod[] =>
  (x.mods ?? []).filter((m) => m.on && m.to === to && m.value).map((m) => ({ label: m.label || "Ajuste", type: m.type, value: m.value }));

// Ventajas que solo cuentan contra la presa
const isPrey = (ctx: StrikeContext, o: StrikeOpts) => !!o.target && ctx.s?.cls?.prey === o.target.tok;

export function weaponAbility(c: Character, w: Weapon) {
  if (w.ranged) return c.abilities.dex;
  if (w.finesse) return Math.max(c.abilities.dex, c.abilities.str);
  return c.abilities.str;
}

export function mapStep(w: Weapon, ctx: StrikeContext, o: StrikeOpts) {
  const flurry = ctx.f.edge === "flurry" && (isPrey(ctx, o) || o.flurry);
  if (flurry) return w.agile ? 2 : 3;
  return w.agile ? 4 : 5;
}

export function strikeAttack(w: Weapon, ctx: StrikeContext, o: StrikeOpts, mapIndex: number) {
  const { c, s, x } = ctx;
  let base = w.attack;
  const strat = o.stratagem ? s?.cls?.strat : undefined;
  // Estratagema: el ataque usa Inteligencia y el d20 guardado
  if (strat) base = w.attack - weaponAbility(c, w) + c.abilities.int;
  const mods = [
    ...conditionMods(s?.cond, { kind: "attack", melee: !w.ranged, finesse: w.finesse, target: o.target?.key }),
    ...customMods(x, "atk"),
  ];
  const { total, applied } = stackMods(mods);
  const value = base + total - mapStep(w, ctx, o) * mapIndex;
  const notes = [modsText(applied), strat ? `Estratagema (d20 = ${strat.v})` : ""].filter(Boolean).join(" · ");
  return { value, notes, formula: strat ? `${strat.v}${fmtMod(value)}` : `1d20${fmtMod(value)}`, base };
}

export function strikeDamage(w: Weapon, ctx: StrikeContext, o: StrikeOpts) {
  const { c, s, x, f } = ctx;
  const melee = !w.ranged;
  const cls = s?.cls;
  const level = c.level;
  const mods: Mod[] = [...conditionMods(s?.cond, { kind: "damage", melee }), ...customMods(x, "dmg")];
  const dice: { f: string; label: string }[] = [];
  const typeNotes: string[] = [];

  if (cls?.rage && melee && f.rage) {
    const custom = x.cls?.rageDmg?.trim();
    if (custom && /d/.test(custom)) dice.push({ f: custom, label: `Furia${x.cls?.rageType ? ` (${x.cls.rageType})` : ""}` });
    else mods.push({ label: `Furia${x.cls?.rageType ? ` (${x.cls.rageType})` : ""}`, type: "untyped", value: custom ? parseInt(custom, 10) || 0 : rageDamage(w.agile) });
  }
  if (f.empower && (x.cls?.empower ?? true)) mods.push({ label: "Potenciación del implemento", type: "untyped", value: 2 });
  if (cls?.exploit?.mode === "anti" && o.target && cls.exploit.tok === o.target.tok) {
    mods.push({ label: "Antítesis personal", type: "untyped", value: antithesisBonus(level) });
  }
  if (cls?.od?.b) {
    mods.push({ label: `Sobrecarga${cls.od.fire ? " (fuego)" : ""}`, type: "untyped", value: cls.od.b });
    if (cls.od.fire) typeNotes.push("+1 de fuego");
  }

  // Daño de precisión de las clases
  const precisionAuto = f.precise || f.sneak > 0 || f.stratagem;
  for (const e of w.extra) {
    if (!e.active) continue;
    if (precisionAuto && /precision/i.test(e.type)) continue;
    dice.push({ f: `${e.dice}d${e.sides}`, label: e.type || "extra" });
  }
  if (f.edge === "precision" && o.preyFirst && isPrey(ctx, o)) dice.push({ f: `${rangerPrecisionDice(level)}d8`, label: "Precisión (presa)" });
  const sk = ctx.slinger ?? guessSlinger(w);
  const sling = f.slinger ? slingerDamage(sk, f.slingerLegend) : null;
  if (sling && w.ranged) dice.push({ f: sling, label: "Precisión del pistolero" });
  const targetOffGuard = !!o.target && (o.target.cond.offGuard || (o.target.cond.buffs ?? []).some((b) => (b.ac ?? 0) < 0 && /desprevenido/i.test(b.n)));
  const sneakWeapon = w.ranged || w.agile || w.finesse || (f.ruffian && !!o.sneak);
  if (f.sneak > 0 && sneakWeapon && (targetOffGuard || o.sneak)) dice.push({ f: `${f.sneak}d6`, label: "Ataque furtivo" });
  if (f.precise && (w.agile || w.finesse)) {
    const ps = preciseStrike(level);
    if (o.finisher && cls?.panache) dice.push({ f: `${ps.dice}d6`, label: "Golpe de gracia" });
    else mods.push({ label: "Golpe preciso", type: "untyped", value: ps.flat });
  }
  if (o.stratagem && cls?.strat && f.stratagem) dice.push({ f: `${strategicStrikeDice(level)}d6`, label: "Golpe estratégico" });

  const { total, applied } = stackMods(mods);
  // La bomba del alquimista (u otra arma con daño editado) usa su propia fórmula
  const baseDice = w.dmgFormula?.trim() || `${w.diceCount}d${w.dieSides}`;
  const flat = (w.damageBonus ?? 0) + total;
  const formula = `${baseDice}${flat ? fmtMod(flat) : ""}${dice.map((d) => (d.f.startsWith("-") ? d.f : `+${d.f}`)).join("")}`.replace(/^\+/, "");
  const notes = [modsText(applied), ...dice.map((d) => `${d.label} ${d.f}`), ...typeNotes].filter(Boolean).join(" · ");
  return { formula, notes, sneak: dice.some((d) => d.label === "Ataque furtivo"), finisher: dice.some((d) => d.label === "Golpe de gracia") };
}
