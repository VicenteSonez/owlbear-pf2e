// Reglas de Pathfinder 2e que usa la extensión: tipos de bonificador, condiciones,
// CA efectiva, moribundo/herido, escudo y tiradas planas.
import type { Ability } from "./pathbuilder";

// ---------- Bonificadores ----------

export type BonusType = "circumstance" | "status" | "item" | "untyped";

export interface Mod {
  label: string;
  type: BonusType;
  value: number;
}

export const BONUS_LABEL: Record<BonusType, string> = {
  circumstance: "circunstancial",
  status: "de estado",
  item: "de objeto",
  untyped: "sin tipo",
};

// De cada tipo solo cuenta el mayor bono y el peor penalizador; los sin tipo se suman todos.
export function stackMods(mods: Mod[]): { total: number; applied: Mod[] } {
  const applied: Mod[] = [];
  for (const type of ["circumstance", "status", "item"] as const) {
    const ofType = mods.filter((m) => m.type === type);
    const bonus = ofType.filter((m) => m.value > 0).sort((a, b) => b.value - a.value)[0];
    const penalty = ofType.filter((m) => m.value < 0).sort((a, b) => a.value - b.value)[0];
    if (bonus) applied.push(bonus);
    if (penalty) applied.push(penalty);
  }
  applied.push(...mods.filter((m) => m.type === "untyped" && m.value !== 0));
  return { total: applied.reduce((s, m) => s + m.value, 0), applied };
}

export const modsText = (mods: Mod[]) =>
  mods.map((m) => `${m.label} ${m.value > 0 ? "+" : "−"}${Math.abs(m.value)}`).join(", ");

// ---------- Condiciones ----------

export interface PersistentDamage {
  id: string;
  formula: string;
  type: string;
  // Vino de un golpe crítico: el daño persistente se duplica
  crit?: boolean;
}

// Daño medio de una fórmula ("2d6+1" → 8): sirve para elegir el mayor de un mismo tipo
export function formulaAvg(formula: string, crit = false): number {
  const clean = formula.replace(/\s+/g, "").toLowerCase();
  let total = 0;
  for (const m of clean.matchAll(/([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/g)) {
    if (m[3]) total += (m[1] === "-" ? -1 : 1) * (m[2] ? parseInt(m[2], 10) : 1) * ((parseInt(m[3], 10) + 1) / 2);
    else if (m[5]) total += (m[4] === "-" ? -1 : 1) * parseInt(m[5], 10);
  }
  return crit ? total * 2 : total;
}

export const persistentAvg = (p: PersistentDamage) => formulaAvg(p.formula, p.crit);
export const persistentText = (p: PersistentDamage) => `${p.formula}${p.crit ? " ×2" : ""}`;

// El daño persistente del mismo tipo no se suma: se queda solo el mayor
export function addPersistent(list: PersistentDamage[] | undefined, p: PersistentDamage): PersistentDamage[] {
  const cur = list ?? [];
  const same = cur.find((x) => normType(x.type) === normType(p.type));
  if (!same) return [...cur, p];
  if (persistentAvg(p) <= persistentAvg(same)) return cur;
  return cur.map((x) => (x === same ? { ...p, id: same.id } : x));
}

// Uno por tipo (el mayor): las hojas viejas pueden tener varios del mismo tipo
export function persistentByType(list: PersistentDamage[] | undefined): { top: PersistentDamage; ids: string[] }[] {
  const groups = new Map<string, PersistentDamage[]>();
  for (const p of list ?? []) {
    const k = normType(p.type);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups.values()].map((g) => ({ top: g.reduce((a, b) => (persistentAvg(b) > persistentAvg(a) ? b : a)), ids: g.map((x) => x.id) }));
}

// Bono o penalizador temporal que otro aplica (Himno valeroso, Provocar…). Se apaga solo
// al empezar o terminar el turno de quien lo dio ("pc:<id>" o "npc:<id>").
export interface Buff {
  id: string;
  n: string;
  ty: BonusType;
  icon?: string;
  atk?: number;
  dmg?: number;
  ac?: number;
  // Salvaciones contra efectos de miedo
  fear?: number;
  // Tiradas de ataque y CD contra quien no sea "except" (Provocar del guardián)
  vsOthers?: { v: number; except: string };
  until?: { key: string; at: "start" | "end" };
}

export interface Conditions {
  offGuard?: boolean;
  fatigued?: boolean;
  frightened?: number;
  sickened?: number;
  enfeebled?: number;
  clumsy?: number;
  stupefied?: number;
  drained?: number;
  // Bono de cobertura a la CA: 1 menor, 2 media, 4 mayor
  cover?: 1 | 2 | 4;
  fastHealing?: number;
  persistent?: PersistentDamage[];
  buffs?: Buff[];
}

export type ValuedCondition = "frightened" | "sickened" | "enfeebled" | "clumsy" | "stupefied" | "drained" | "fastHealing";

export interface ConditionDef {
  id: "offGuard" | "fatigued" | ValuedCondition;
  label: string;
  icon: string;
  valued: boolean;
  desc: string;
}

export const CONDITIONS: ConditionDef[] = [
  { id: "offGuard", label: "Desprevenido", icon: "off-guard", valued: false, desc: "−2 circunstancial a la CA." },
  { id: "fatigued", label: "Fatigado", icon: "fatigued", valued: false, desc: "−1 de estado a la CA y a las salvaciones. No puede entrar en Furia." },
  {
    id: "frightened",
    label: "Asustado",
    icon: "frightened",
    valued: true,
    desc: "−X de estado a todas las pruebas y CD, incluida la CA. Baja 1 al final de su turno.",
  },
  { id: "sickened", label: "Enfermo", icon: "sickened", valued: true, desc: "−X de estado a todas las pruebas y CD, incluida la CA." },
  {
    id: "enfeebled",
    label: "Débil",
    icon: "enfeebled",
    valued: true,
    desc: "−X de estado a Atletismo, ataques cuerpo a cuerpo y su daño.",
  },
  {
    id: "clumsy",
    label: "Torpe",
    icon: "clumsy",
    valued: true,
    desc: "−X de estado a CA, Reflejos, Acrobacias, Sigilo, Latrocinio, ataques a distancia y con armas sutiles.",
  },
  {
    id: "stupefied",
    label: "Estupefacto",
    icon: "stupefied",
    valued: true,
    desc: "−X de estado a Percepción, Voluntad, habilidades mentales y Saberes, ataques y CD de conjuros.",
  },
  {
    id: "drained",
    label: "Drenado",
    icon: "drained",
    valued: true,
    desc: "−X de estado a Fortaleza (y a los impulsos del kineticista). PG máximos −nivel×X.",
  },
  { id: "fastHealing", label: "Sanación rápida", icon: "fast-healing", valued: true, desc: "Recupera X PG al inicio de su turno." },
];

export const COVERS: { value: 1 | 2 | 4; label: string; icon: string; desc: string }[] = [
  { value: 1, label: "Cobertura menor", icon: "cover-lesser", desc: "+1 circunstancial a la CA." },
  { value: 2, label: "Cobertura media", icon: "cover-standard", desc: "+2 circunstancial a CA, Reflejos y Sigilo." },
  { value: 4, label: "Cobertura mayor", icon: "cover-greater", desc: "+4 circunstancial a CA, Reflejos y Sigilo." },
];

// Íconos activos (para la hoja, el panel del GM y los tokens)
export function activeConditionIcons(c: Conditions | undefined): { icon: string; label: string; value?: number }[] {
  if (!c) return [];
  const out: { icon: string; label: string; value?: number }[] = [];
  for (const def of CONDITIONS) {
    const v = c[def.id];
    if (def.valued ? typeof v === "number" && v > 0 : v) out.push({ icon: def.icon, label: def.label, value: def.valued ? (v as number) : undefined });
  }
  const cover = COVERS.find((x) => x.value === c.cover);
  if (cover) out.push({ icon: cover.icon, label: cover.label });
  for (const { top: p } of persistentByType(c.persistent)) out.push({ icon: "persistent", label: `Persistente ${persistentText(p)} ${p.type}`.trim() });
  for (const b of c.buffs ?? []) if (b.icon) out.push({ icon: b.icon, label: b.n });
  return out;
}

// ---------- Qué condiciones afectan a cada tirada ----------

export type RollCtx =
  | { kind: "skill"; key: string; ability: Ability }
  | { kind: "perception" }
  | { kind: "save"; key: "fortitude" | "reflex" | "will"; fear?: boolean }
  // target: clave de quien recibe el ataque ("pc:<id>" o "npc:<tokenId>"), para Provocar
  | { kind: "attack"; melee: boolean; finesse: boolean; target?: string }
  // str: el daño suma Fuerza aunque sea a distancia (armas arrojadizas): lo penaliza Débil
  | { kind: "damage"; melee: boolean; str?: boolean; spell?: boolean }
  | { kind: "spell-attack"; target?: string }
  | { kind: "spell-dc"; target?: string }
  | { kind: "impulse-attack" }
  | { kind: "impulse-dc" }
  | { kind: "class-dc" }
  | { kind: "ac" };

export interface ShieldState {
  name: string;
  bonus: number;
  hp: number;
  maxHp: number;
  hardness: number;
  raised: boolean;
}

export const shieldBroken = (s: ShieldState) => s.maxHp > 0 && s.hp <= Math.floor(s.maxHp / 2);
export const shieldDestroyed = (s: ShieldState) => s.maxHp > 0 && s.hp <= 0;

const MENTAL: Ability[] = ["int", "wis", "cha"];

export function conditionMods(c: Conditions | undefined, ctx: RollCtx, shield?: ShieldState): Mod[] {
  const mods: Mod[] = [];
  if (!c && !shield) return mods;
  const cond = c ?? {};
  const status = (label: string, v?: number) => {
    if (v && v > 0) mods.push({ label, type: "status", value: -v });
  };
  const isDamage = ctx.kind === "damage";

  // Asustado y enfermo: todas las pruebas y CD
  if (!isDamage) {
    status("Asustado", cond.frightened);
    status("Enfermo", cond.sickened);
  }
  // Bonos temporales de otros (Himno valeroso, Provocar…)
  for (const b of cond.buffs ?? []) {
    const isAttack = ctx.kind === "attack" || ctx.kind === "spell-attack" || ctx.kind === "impulse-attack";
    if (isAttack && b.atk) mods.push({ label: b.n, type: b.ty, value: b.atk });
    if (isDamage && b.dmg) mods.push({ label: b.n, type: b.ty, value: b.dmg });
    if (ctx.kind === "ac" && b.ac) mods.push({ label: b.n, type: b.ty, value: b.ac });
    if (ctx.kind === "save" && ctx.fear && b.fear) mods.push({ label: `${b.n} (miedo)`, type: b.ty, value: b.fear });
    if (b.vsOthers && (ctx.kind === "attack" || ctx.kind === "spell-attack" || ctx.kind === "spell-dc") && "target" in ctx && ctx.target && ctx.target !== b.vsOthers.except) {
      mods.push({ label: b.n, type: b.ty, value: b.vsOthers.v });
    }
  }
  switch (ctx.kind) {
    case "ac":
      if (cond.offGuard) mods.push({ label: "Desprevenido", type: "circumstance", value: -2 });
      if (cond.fatigued) mods.push({ label: "Fatigado", type: "status", value: -1 });
      status("Torpe", cond.clumsy);
      if (cond.cover) mods.push({ label: COVERS.find((x) => x.value === cond.cover)!.label, type: "circumstance", value: cond.cover });
      if (shield?.raised && !shieldBroken(shield) && shield.bonus > 0) {
        mods.push({ label: "Escudo alzado", type: "circumstance", value: shield.bonus });
      }
      break;
    case "save":
      if (cond.fatigued) mods.push({ label: "Fatigado", type: "status", value: -1 });
      if (ctx.key === "reflex") {
        status("Torpe", cond.clumsy);
        if (cond.cover && cond.cover >= 2) mods.push({ label: "Cobertura", type: "circumstance", value: cond.cover });
      }
      if (ctx.key === "will") status("Estupefacto", cond.stupefied);
      if (ctx.key === "fortitude") status("Drenado", cond.drained);
      break;
    case "perception":
      status("Estupefacto", cond.stupefied);
      break;
    case "skill":
      if (ctx.key === "athletics") status("Débil", cond.enfeebled);
      if (["acrobatics", "stealth", "thievery"].includes(ctx.key)) status("Torpe", cond.clumsy);
      if (ctx.key === "stealth" && cond.cover && cond.cover >= 2) {
        mods.push({ label: "Cobertura", type: "circumstance", value: cond.cover });
      }
      if (MENTAL.includes(ctx.ability)) status("Estupefacto", cond.stupefied);
      break;
    case "attack":
      // Armas de Fuerza (cuerpo a cuerpo) → Débil; de Destreza (sutiles o a distancia) → Torpe
      if (ctx.melee && !ctx.finesse) status("Débil", cond.enfeebled);
      if (!ctx.melee || ctx.finesse) status("Torpe", cond.clumsy);
      break;
    case "damage":
      if (ctx.melee || ctx.str) status("Débil", cond.enfeebled);
      break;
    case "spell-attack":
    case "spell-dc":
      status("Estupefacto", cond.stupefied);
      break;
    case "impulse-attack":
    case "impulse-dc":
      status("Drenado", cond.drained);
      break;
    case "class-dc":
      break;
  }
  return mods;
}

export function checkAdjust(c: Conditions | undefined, ctx: RollCtx, shield?: ShieldState) {
  return stackMods(conditionMods(c, ctx, shield));
}

// CA efectiva = CA de la hoja + condiciones/cobertura/escudo + ajuste manual del GM o jugador
export function effectiveAc(baseAc: number, acAdj: number, cond?: Conditions, shield?: ShieldState) {
  const mods = conditionMods(cond, { kind: "ac" }, shield);
  if (acAdj) mods.push({ label: "Ajuste manual", type: "untyped", value: acAdj });
  const { total, applied } = stackMods(mods);
  return { ac: baseAc + total, applied };
}

// ---------- Vida, moribundo y herido ----------

export interface Vitals {
  hp: number;
  temp: number;
  dying: number;
  wounded: number;
}

export const DEATH_DYING = 4;

// Drenado: −(nivel, mínimo 1) × valor a los PG máximos
export function effectiveMaxHp(maxHp: number, level: number, cond?: Conditions) {
  return Math.max(1, maxHp - Math.max(1, level) * (cond?.drained ?? 0));
}

// Daño: primero los PG temporales. Al caer a 0 se gana moribundo 1 + herido;
// si ya estaba a 0 PG, cada golpe sube moribundo en 1.
export function applyDamage<T extends Vitals>(s: T, amount: number): T {
  if (amount <= 0) return s;
  const fromTemp = Math.min(s.temp, amount);
  const rest = amount - fromTemp;
  const hp = Math.max(0, s.hp - rest);
  let dying = s.dying;
  if (rest > 0 && hp === 0) {
    if (s.hp > 0) dying = Math.max(dying, 1 + s.wounded);
    else dying = dying > 0 ? dying + 1 : 1 + s.wounded;
  }
  return { ...s, hp, temp: s.temp - fromTemp, dying: Math.min(DEATH_DYING, dying) };
}

// Curar a alguien moribundo le quita el moribundo y sube herido en 1
export function applyHealing<T extends Vitals>(s: T, amount: number, maxHp: number): T {
  if (amount <= 0) return s;
  const hp = Math.min(maxHp, s.hp + amount);
  if (s.dying > 0 && hp > 0) return { ...s, hp, dying: 0, wounded: s.wounded + 1 };
  return { ...s, hp };
}

// Fijar los PG a mano: si bajan cuenta como daño (sin tocar los temporales), si suben como curación
export function setHp<T extends Vitals>(s: T, value: number, maxHp: number): T {
  const target = Math.max(0, Math.min(maxHp, Math.round(value)));
  if (target < s.hp) return { ...applyDamage({ ...s, temp: 0 }, s.hp - target), temp: s.temp };
  if (target > s.hp) return applyHealing(s, target - s.hp, maxHp);
  return s;
}

// ---------- Tiradas planas ----------

export type Degree = "crit-success" | "success" | "failure" | "crit-failure";

export const DEGREE_LABEL: Record<Degree, string> = {
  "crit-success": "Éxito crítico",
  success: "Éxito",
  failure: "Fallo",
  "crit-failure": "Fallo crítico",
};

// Grado de éxito con la regla del 20 y el 1 natural
export function degreeOf(total: number, dc: number, natural?: number): Degree {
  let d = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (natural === 20) d = Math.min(3, d + 1);
  if (natural === 1) d = Math.max(0, d - 1);
  return (["crit-failure", "failure", "success", "crit-success"] as const)[d];
}

// Tirada de recuperación (CD 10 + moribundo)
export function applyRecovery<T extends Vitals>(s: T, degree: Degree): T {
  const delta = { "crit-success": -2, success: -1, failure: 1, "crit-failure": 2 }[degree];
  const dying = Math.max(0, Math.min(DEATH_DYING, s.dying + delta));
  // Salir de moribundo deja una marca de herido
  const wounded = s.dying > 0 && dying === 0 ? s.wounded + 1 : s.wounded;
  return { ...s, dying, wounded };
}

// ---------- Escudo ----------

// Bloqueo con escudo: la dureza reduce el daño y el resto lo reciben el escudo y el PJ
export function shieldBlock(shield: ShieldState, damage: number) {
  const through = Math.max(0, damage - shield.hardness);
  const hp = Math.max(0, shield.hp - through);
  const next: ShieldState = { ...shield, hp };
  if (shieldBroken(next)) next.raised = false;
  return { shield: next, through };
}

export function shieldRepair(shield: ShieldState, amount: number): ShieldState {
  return { ...shield, hp: Math.min(shield.maxHp, shield.hp + Math.max(0, amount)) };
}

// ---------- CD por nivel ----------

// CD estándar según el nivel de la criatura o del PJ (nivel 0 a 25)
export const LEVEL_DC = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];

export const levelDc = (level: number) => LEVEL_DC[Math.max(0, Math.min(LEVEL_DC.length - 1, Math.round(level)))];

// ---------- Inmunidades, resistencias y debilidades ----------

export interface IwrEntry {
  t: string;
  v: number;
  // De dónde sale (Anillo, Furia…): permite tener varias del mismo tipo
  n?: string;
  // Situacional: no se aplica sola, se activa a mano en cada daño
  off?: boolean;
}

export interface Iwr {
  imm?: string[];
  res?: IwrEntry[];
  weak?: IwrEntry[];
}

export const DAMAGE_TYPES = [
  "cortante", "perforante", "contundente", "fuego", "frío", "ácido", "electricidad", "sonido",
  "veneno", "mental", "espíritu", "vitalidad", "vacío", "fuerza", "sangrado", "precisión",
];

// Grupos que se pueden escribir como tipo de una resistencia o inmunidad
export const IWR_GROUPS: Record<string, string[]> = {
  fisico: ["cortante", "perforante", "contundente"],
  energia: ["fuego", "frio", "acido", "electricidad", "sonido", "vitalidad", "vacio", "fuerza"],
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// Nombres en inglés de Pathbuilder y abreviaturas de armas
const ALIAS: Record<string, string> = {
  s: "cortante", p: "perforante", b: "contundente", slashing: "cortante", piercing: "perforante", bludgeoning: "contundente",
  fire: "fuego", cold: "frio", acid: "acido", electricity: "electricidad", sonic: "sonido", poison: "veneno",
  spirit: "espiritu", vitality: "vitalidad", void: "vacio", force: "fuerza", bleed: "sangrado", precision: "precision",
  physical: "fisico", all: "todo",
};

export const normType = (t: string) => {
  const n = norm(t);
  return ALIAS[n] ?? n;
};

// ¿La entrada de resistencia/inmunidad/debilidad cubre este tipo de daño?
export function iwrMatches(entryType: string, damageType: string): boolean {
  const e = normType(entryType);
  const d = normType(damageType);
  if (!e) return false;
  if (e === "todo" || e === "todos") return true;
  if (!d) return false;
  if (e === d) return true;
  return (IWR_GROUPS[e] ?? []).includes(d);
}

export interface IwrPick {
  imm: boolean;
  res: number[];
  weak: number[];
}

// Lo que se aplica por defecto según el tipo de daño (el GM o el jugador puede cambiarlo)
export function autoIwr(iwr: Iwr | undefined, type: string): IwrPick {
  return {
    imm: (iwr?.imm ?? []).some((t) => iwrMatches(t, type)),
    res: (iwr?.res ?? []).flatMap((r, i) => (!r.off && iwrMatches(r.t, type) ? [i] : [])),
    weak: (iwr?.weak ?? []).flatMap((w, i) => (!w.off && iwrMatches(w.t, type) ? [i] : [])),
  };
}

export const hasIwr = (iwr?: Iwr) => !!(iwr?.imm?.length || iwr?.res?.length || iwr?.weak?.length);

// Inmunidad → 0. Si no, se suma la debilidad (sobre el total, ya duplicado si fue crítico)
// y se resta la resistencia. De varias aplicables solo cuenta la mayor.
export function resolveIwr(amount: number, iwr: Iwr | undefined, pick: IwrPick): { total: number; notes: string } {
  if (amount <= 0) return { total: 0, notes: "" };
  if (pick.imm) return { total: 0, notes: "Inmune" };
  const weak = Math.max(0, ...pick.weak.map((i) => iwr?.weak?.[i]?.v ?? 0));
  const res = Math.max(0, ...pick.res.map((i) => iwr?.res?.[i]?.v ?? 0));
  const notes = [weak ? `Debilidad +${weak}` : "", res ? `Resistencia −${res}` : ""].filter(Boolean).join(", ");
  return { total: Math.max(0, amount + weak - res), notes };
}

export const iwrEntryText = (e: IwrEntry) => `${e.t} ${e.v}${e.n ? ` (${e.n})` : ""}`;

export function iwrText(iwr?: Iwr): string {
  if (!iwr) return "";
  return [
    ...(iwr.imm ?? []).map((t) => `Inmune ${t}`),
    ...(iwr.res ?? []).map((r) => `Resist. ${iwrEntryText(r)}`),
    ...(iwr.weak ?? []).map((w) => `Debil. ${iwrEntryText(w)}`),
  ].join(" · ");
}

// Grado de un ataque contra una CA (con 20/1 natural)
export const attackDegree = (total: number, ac: number, natural?: number) => degreeOf(total, ac, natural);

// Quita los bonos temporales que vencen al empezar o terminar el turno de alguien
export function expireBuffs(c: Conditions, keys: string[], at: "start" | "end"): Conditions | null {
  const list = c.buffs ?? [];
  const keep = list.filter((b) => !(b.until && b.until.at === at && keys.includes(b.until.key)));
  if (keep.length === list.length) return null;
  return { ...c, buffs: keep.length ? keep : undefined };
}

// Agrega (o reemplaza por id) un bono temporal
export const withBuff = (c: Conditions, b: Buff): Conditions => ({ ...c, buffs: [...(c.buffs ?? []).filter((x) => x.id !== b.id), b] });
export const withoutBuff = (c: Conditions, id: string): Conditions => {
  const keep = (c.buffs ?? []).filter((x) => x.id !== id);
  return { ...c, buffs: keep.length ? keep : undefined };
};
