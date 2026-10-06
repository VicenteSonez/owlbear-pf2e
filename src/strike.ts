// Ataque y daño de un arma con todo lo que los modifica: condiciones, bonos del jugador,
// objetivo elegido y rasgos de clase (Furia, Ataque furtivo, Golpe preciso…). Puro.
import { fmtMod, type Character, type Weapon } from "./pathbuilder";
import type { PcState } from "./live";
import type { CustomWeapon, Extras } from "./extras";
import type { PersistentSpec } from "./shared";
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
  // Tirada de daño crítico (para lo que solo aparece con crítico)
  crit?: boolean;
}

export interface StrikeContext {
  c: Character;
  s?: PcState;
  x: Extras;
  f: Features;
  slinger?: SlingerKind;
}

const customMods = (x: Extras, to: "atk" | "dmg", crit = false): Mod[] =>
  (x.mods ?? [])
    .filter((m) => m.on && m.to === to && m.value && !m.dice && !m.pers && (!m.critOnly || crit))
    .map((m) => ({ label: m.label || "Ajuste", type: m.type, value: m.value }));

// Arma agregada a mano → arma de la hoja
export function customWeapon(w: CustomWeapon): Weapon {
  return {
    name: w.name || "Ataque",
    key: `custom:${w.id}`,
    attack: w.attack,
    diceCount: 1,
    dieSides: 4,
    damageBonus: 0,
    damageType: w.ty,
    extra: [],
    agile: !!w.agile,
    finesse: !!w.finesse,
    ranged: !!w.ranged,
    dmgFormula: w.dmg || "1d4",
    custom: true,
  };
}

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
  // Las arrojadizas suman Fuerza al daño: Débil las penaliza (las bombas no)
  const str = !!w.thrown && !w.bomb;
  const mods: Mod[] = [...conditionMods(s?.cond, { kind: "damage", melee, str }), ...customMods(x, "dmg", o.crit)];
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
  // Dados extra del jugador (+1d4 de fuego…)
  for (const m of x.mods ?? []) {
    if (!m.on || m.to !== "dmg" || !m.dice || m.pers) continue;
    if (m.critOnly && !o.crit) continue;
    dice.push({ f: m.dice, label: `${m.label || "Extra"}${m.dt ? ` (${m.dt})` : ""}` });
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
  // Daño persistente: el del arma y el de los bonos del jugador (los de "solo crítico" requieren crítico)
  const pers: PersistentSpec[] = [];
  if (w.pers?.f && (!w.pers.crit || o.crit)) pers.push(w.pers);
  for (const m of x.mods ?? []) {
    if (!m.on || m.to !== "dmg" || !m.pers) continue;
    if (m.critOnly && !o.crit) continue;
    const f = m.dice || (m.value ? String(m.value) : "");
    if (f) pers.push({ f, ty: m.dt ?? "" });
  }
  const notes = [
    modsText(applied),
    ...dice.map((d) => `${d.label} ${d.f}`),
    ...typeNotes,
    ...pers.map((p) => `${p.f}${o.crit ? " ×2" : ""} persistente ${p.ty}`.trim()),
  ]
    .filter(Boolean)
    .join(" · ");
  // Dados de otro tipo, para que el GM sepa qué parte del daño es de cada tipo
  const typed = (x.mods ?? []).filter((m) => m.on && m.to === "dmg" && m.dice && !m.pers && m.dt && (!m.critOnly || o.crit)).map((m) => `${m.dice} ${m.dt}`);
  return {
    formula,
    notes,
    pers,
    typed,
    sneak: dice.some((d) => d.label === "Ataque furtivo"),
    finisher: dice.some((d) => d.label === "Golpe de gracia"),
  };
}
