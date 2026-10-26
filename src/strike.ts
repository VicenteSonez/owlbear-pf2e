// Ataque y daño de un arma con todo lo que los modifica: condiciones, bonos del jugador,
// objetivo elegido y rasgos de clase (Furia, Ataque furtivo, Golpe preciso…). Puro.
import { fmtMod, type Character, type Weapon } from "./pathbuilder";
import type { PcState } from "./live";
import type { CustomMod, CustomWeapon, Extras } from "./extras";
import type { PersistentSpec } from "./shared";
import { parseFormula } from "./dice";
import { GHOST_TOUCH, conditionMods, modsText, normType, stackMods, type Conditions, type Mod } from "./rules";
import {
  antithesisBonus,
  guessSlinger,
  immanentIkon,
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
  hp?: number;
  maxHp?: number;
  // Desprevenido ante este ataque aunque no tenga la condición (el atacante está escondido)
  og?: boolean;
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
  // Arrojar un arma cuerpo a cuerpo (daga, lanza…): ataque a distancia con Destreza
  thrown?: boolean;
}

export interface StrikeContext {
  c: Character;
  s?: PcState;
  x: Extras;
  f: Features;
  slinger?: SlingerKind;
}

// Dados de daño del arma: el dado base más los de las runas de golpe (no Letal ni dados extra)
export function weaponDice(w: Weapon): number {
  if (w.dmgFormula?.trim()) {
    try {
      return Math.max(1, parseFormula(w.dmgFormula).dice[0]?.count ?? 1);
    } catch {
      return 1;
    }
  }
  return Math.max(1, w.diceCount);
}

// Dados extra de Letal según la runa de golpe: 1 (base y golpe), 2 (mayor), 3 (superior)
export const deadlyDice = (w: Weapon) => (weaponDice(w) >= 4 ? 3 : weaponDice(w) >= 3 ? 2 : 1);

// Valor de un bono del jugador: plano o multiplicado por los dados del arma
function modAmount(m: CustomMod, w: Weapon): number {
  return m.perDie ? m.value * weaponDice(w) : m.value;
}
function modDice(m: CustomMod, w: Weapon): string {
  if (!m.perDie || !m.dice) return m.dice ?? "";
  const n = weaponDice(w);
  return m.dice.replace(/^(\d*)d/i, (_, c: string) => `${(parseInt(c || "1", 10) || 1) * n}d`);
}

const customMods = (x: Extras, w: Weapon, to: "atk" | "dmg", crit = false): Mod[] =>
  (x.mods ?? [])
    .filter((m) => m.on && m.to === to && m.value && !m.dice && !m.pers && !m.splash && (!m.critOnly || crit))
    // Los de "solo crítico" no se multiplican: van aparte (critOnlyFlat)
    .filter((m) => !m.critOnly)
    .map((m) => ({ label: m.label || "Ajuste", type: m.type, value: modAmount(m, w) }));

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

// Ícono de arma con la chispa inmanente, si es esta arma
export function weaponIkon(w: Weapon, ctx: StrikeContext) {
  const ik = immanentIkon(ctx.s);
  if (!ik?.dmg || !ctx.s?.cls?.spark) return undefined;
  const key = ctx.x.cls?.ikonWpn?.[ik.n];
  return key && key === w.key ? ik : undefined;
}

// Tags del golpe para las resistencias y debilidades: material y runas especiales
export function weaponTags(w: Weapon): string[] {
  const out: string[] = [];
  if (w.mat) out.push(w.mat);
  if ((w.runes ?? []).some((r) => /ghost touch|toque fantasmal/i.test(r.n))) out.push(GHOST_TOUCH);
  return out;
}

// ¿Se conserva al arrojarla? (runa Retornante, Funda de sombras)
export const keepsThrown = (w: Weapon, ctx: StrikeContext) =>
  !!w.keep || (w.runes ?? []).some((r) => /returning|retornante/i.test(r.n)) || weaponIkon(w, ctx)?.id === "sheath";

export function strikeAttack(w: Weapon, ctx: StrikeContext, o: StrikeOpts, mapIndex: number) {
  const { c, s, x } = ctx;
  let base = w.attack;
  // Arrojar un arma cuerpo a cuerpo: a distancia solo se usa Destreza
  const thrown = !!o.thrown && !w.ranged;
  if (thrown) base = w.attack - weaponAbility(c, w) + c.abilities.dex;
  const strat = o.stratagem ? s?.cls?.strat : undefined;
  // Estratagema: el ataque usa Inteligencia y el d20 guardado
  if (strat) base = base - (thrown ? c.abilities.dex : weaponAbility(c, w)) + c.abilities.int;
  const melee = !w.ranged && !thrown;
  const mods = [
    ...conditionMods(s?.cond, { kind: "attack", melee, finesse: w.finesse || thrown, target: o.target?.key }),
    ...customMods(x, w, "atk"),
  ];
  const { total, applied } = stackMods(mods);
  const value = base + total - mapStep(w, ctx, o) * mapIndex;
  const notes = [modsText(applied), strat ? `Estratagema (d20 = ${strat.v})` : "", thrown ? "Arrojada (Destreza)" : ""].filter(Boolean).join(" · ");
  return { value, notes, formula: strat ? `${strat.v}${fmtMod(value)}` : `1d20${fmtMod(value)}`, base };
}

// Grupo de daño de la tirada: la fórmula, su tipo y si se duplica con crítico
export interface DamageGroup {
  f: string;
  ty: string;
  label: string;
  mult: boolean;
  splash?: boolean;
}

export interface StrikeDamage {
  // Fórmula principal (se duplica con crítico)
  formula: string;
  // Partes aparte: otros tipos, lo que solo da el crítico (no se duplica) y la salpicadura
  groups: DamageGroup[];
  // Fórmula completa para mostrar
  shown: string;
  notes: string;
  pers: PersistentSpec[];
  splash?: { f: string; ty: string; r: number };
  tags: string[];
  sneak: boolean;
  finisher: boolean;
}

export function strikeDamage(w: Weapon, ctx: StrikeContext, o: StrikeOpts): StrikeDamage {
  const { c, s, x, f } = ctx;
  const thrown = !!o.thrown && !w.ranged;
  const melee = !w.ranged && !thrown;
  const cls = s?.cls;
  const level = c.level;
  const crit = !!o.crit;
  const nDice = weaponDice(w);
  const wType = w.damageType || "";
  // Las arrojadizas suman Fuerza al daño: Débil las penaliza (las de salpicadura, como las bombas, no)
  const str = (!!w.thrown || thrown) && !w.bomb && !w.splash;
  const mods: Mod[] = [...conditionMods(s?.cond, { kind: "damage", melee, str }), ...customMods(x, w, "dmg", crit)];
  // Dados que se suman a la fórmula: con su tipo y si se duplican con crítico
  const dice: { f: string; label: string; ty?: string; mult: boolean }[] = [];
  const splash: { f: string; ty: string; label: string }[] = [];
  const typeNotes: string[] = [];

  if (cls?.rage && melee && f.rage) {
    const custom = x.cls?.rageDmg?.trim();
    if (custom && /d/.test(custom)) dice.push({ f: custom, label: `Furia${x.cls?.rageType ? ` (${x.cls.rageType})` : ""}`, ty: x.cls?.rageType, mult: true });
    else mods.push({ label: `Furia${x.cls?.rageType ? ` (${x.cls.rageType})` : ""}`, type: "untyped", value: custom ? parseInt(custom, 10) || 0 : rageDamage(w.agile) });
  }
  // Potenciación del implemento: +2 por dado de daño del arma
  if (f.empower && (x.cls?.empower ?? true)) mods.push({ label: "Potenciación del implemento", type: "untyped", value: 2 * nDice });
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
    dice.push({ f: `${e.dice}d${e.sides}`, label: e.type || "extra", ty: /precision/i.test(e.type) ? undefined : e.type, mult: true });
  }
  // Bonos del jugador al daño: dados (+1d4 de fuego…), los de solo crítico (no se multiplican) y salpicadura
  for (const m of x.mods ?? []) {
    if (!m.on || m.to !== "dmg" || m.pers) continue;
    if (m.critOnly && !crit) continue;
    const amount = m.dice ? modDice(m, w) : m.value ? String(modAmount(m, w)) : "";
    if (!amount) continue;
    const label = `${m.label || "Extra"}${m.dt ? ` (${m.dt})` : ""}`;
    if (m.splash) splash.push({ f: amount, ty: m.dt ?? "", label });
    else if (m.dice || m.critOnly) dice.push({ f: amount, label, ty: m.dt, mult: !m.critOnly });
  }
  if (f.edge === "precision" && o.preyFirst && isPrey(ctx, o)) dice.push({ f: `${rangerPrecisionDice(level)}d8`, label: "Precisión (presa)", mult: true });
  const sk = ctx.slinger ?? guessSlinger(w);
  const sling = f.slinger ? slingerDamage(sk, f.slingerLegend) : null;
  if (sling && w.ranged) dice.push({ f: sling, label: "Precisión del pistolero", mult: true });
  const targetOffGuard =
    !!o.target && (o.target.cond.offGuard || !!o.target.og || (o.target.cond.buffs ?? []).some((b) => (b.ac ?? 0) < 0 && /desprevenido/i.test(b.n)));
  const sneakWeapon = w.ranged || thrown || w.agile || w.finesse || (f.ruffian && !!o.sneak);
  if (f.sneak > 0 && sneakWeapon && (targetOffGuard || o.sneak)) dice.push({ f: `${f.sneak}d6`, label: "Ataque furtivo", mult: true });
  if (f.precise && (w.agile || w.finesse)) {
    const ps = preciseStrike(level);
    if (o.finisher && cls?.panache) dice.push({ f: `${ps.dice}d6`, label: "Golpe de gracia", mult: true });
    else mods.push({ label: "Golpe preciso", type: "untyped", value: ps.flat });
  }
  if (o.stratagem && cls?.strat && f.stratagem) dice.push({ f: `${strategicStrikeDice(level)}d6`, label: "Golpe estratégico", mult: true });

  // Runas escritas a mano: daño extra normal, persistente o de salpicadura
  const pers: PersistentSpec[] = [];
  for (const r of w.runes ?? []) {
    for (const d of r.dmg ?? []) {
      if (!d.f.trim() || (d.crit && !crit)) continue;
      const label = `${r.n || "Runa"}${d.ty ? ` (${d.ty})` : ""}`;
      if (d.kind === "pers") pers.push({ f: d.f, ty: d.ty, crit: d.crit || undefined });
      else if (d.kind === "splash") splash.push({ f: d.f, ty: d.ty, label });
      else dice.push({ f: d.f, label, ty: d.ty, mult: !d.crit });
    }
  }

  // Ícono del ejemplar con la chispa inmanente
  const ik = weaponIkon(w, ctx);
  if (ik?.dmg) {
    const d = ik.dmg;
    const half = !!o.target?.maxHp && (o.target.hp ?? 0) < o.target.maxHp / 2;
    const per = d.vsHalf && half ? d.vsHalf : d.vsOffGuard && targetOffGuard ? d.vsOffGuard : d.per;
    const amount = per * nDice;
    if (d.splash) splash.push({ f: String(amount), ty: "espíritu", label: ik.n });
    else if (d.pers) pers.push({ f: String(amount), ty: "espíritu" });
    else if (d.critDie && crit) dice.push({ f: `${nDice}d${d.critDie}`, label: ik.n, ty: "espíritu", mult: false });
    else dice.push({ f: String(amount), label: ik.n, ty: "espíritu", mult: true });
  }

  // Rasgos de crítico: Fatal cambia el dado del arma y suma uno; Letal suma dados. No se duplican.
  let baseDice = w.dmgFormula?.trim() || `${w.diceCount}d${w.dieSides}`;
  if (crit && w.fatal) {
    baseDice = baseDice.replace(/^(\d*)d\d+/i, (_, n: string) => `${n || "1"}d${w.fatal}`);
    dice.push({ f: `1d${w.fatal}`, label: `Fatal d${w.fatal}`, mult: false });
  }
  if (crit && w.deadly) dice.push({ f: `${deadlyDice(w)}d${w.deadly}`, label: `Letal d${w.deadly}`, mult: false });

  // Salpicadura del arma
  if (w.splash?.f.trim()) splash.unshift({ f: w.splash.f, ty: w.splash.ty || wType, label: "Salpicadura" });

  const { total, applied } = stackMods(mods);
  const flat = (w.damageBonus ?? 0) + total;
  // Lo del mismo tipo que el arma (o sin tipo) va en la fórmula principal; el resto, aparte por tipo
  const same = (ty?: string) => !ty?.trim() || normType(ty) === normType(wType);
  const join = (list: string[]) => list.map((d) => (d.startsWith("-") ? d : `+${d}`)).join("").replace(/^\+/, "");
  const mainDice = dice.filter((d) => d.mult && same(d.ty)).map((d) => d.f);
  const formula = `${baseDice}${flat ? fmtMod(flat) : ""}${mainDice.length ? `+${join(mainDice)}` : ""}`;
  const groups: DamageGroup[] = [];
  const pushGroup = (list: typeof dice, mult: boolean) => {
    const byType = new Map<string, { ty: string; fs: string[]; labels: string[] }>();
    for (const d of list) {
      const ty = d.ty?.trim() || wType;
      const k = normType(ty);
      const g = byType.get(k) ?? { ty, fs: [], labels: [] };
      g.fs.push(d.f);
      g.labels.push(d.label);
      byType.set(k, g);
    }
    for (const g of byType.values()) groups.push({ f: join(g.fs), ty: g.ty, label: g.labels.join(", "), mult });
  };
  pushGroup(dice.filter((d) => d.mult && !same(d.ty)), true);
  pushGroup(dice.filter((d) => !d.mult), false);
  // Toda la salpicadura en un grupo (se tira una vez y se aplica a todos los salpicados)
  const splashTy = splash[0]?.ty || wType;
  const splashF = join(splash.map((x) => x.f));
  if (splashF) groups.push({ f: splashF, ty: splashTy, label: "Salpicadura", mult: false, splash: true });

  // Daño persistente: el del arma y el de los bonos del jugador (los de "solo crítico" requieren crítico)
  if (w.pers?.f && (!w.pers.crit || crit)) pers.unshift(w.pers);
  for (const m of x.mods ?? []) {
    if (!m.on || m.to !== "dmg" || !m.pers) continue;
    if (m.critOnly && !crit) continue;
    const pf = m.dice ? modDice(m, w) : m.value ? String(modAmount(m, w)) : "";
    if (pf) pers.push({ f: pf, ty: m.dt ?? "", crit: m.critOnly || undefined });
  }
  const shown = [crit ? `2×(${formula})` : formula, ...groups.map((g) => (crit && g.mult ? `2×(${g.f})` : g.f))].join(" + ");
  const notes = [
    modsText(applied),
    ...dice.map((d) => `${d.label} ${d.f}${d.ty && !same(d.ty) ? ` ${d.ty}` : ""}${crit && !d.mult ? " (sin ×2)" : ""}`),
    ...splash.map((sp) => `${sp.label} ${sp.f}${sp.ty ? ` ${sp.ty}` : ""}`),
    ...typeNotes,
    // Con crítico se duplica, salvo el que solo da el crítico
    ...pers.map((p) => `${p.f}${crit && !p.crit ? " ×2" : ""} persistente ${p.ty}`.trim()),
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    formula,
    groups,
    shown,
    notes,
    pers,
    splash: splashF ? { f: splashF, ty: splashTy, r: w.splash?.r ?? 5 } : undefined,
    tags: weaponTags(w),
    sneak: dice.some((d) => d.label === "Ataque furtivo"),
    finisher: dice.some((d) => d.label === "Golpe de gracia"),
  };
}
