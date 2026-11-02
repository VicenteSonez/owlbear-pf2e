// Reglas puras de las fichas de PNJ: daño de varios tipos con los bonos a mano, usos de
// conjuros y poderes (espacios, usos por día, recursos y enfriamientos), habilidades e
// iniciativa. Sin OBR ni React.
import { SKILLS, fmtMod, type Ability } from "./pathbuilder";
import { checkAdjust, modsText, normType, stackMods, type Mod } from "./rules";
import { parseFormula } from "./dice";
import type { CustomMod } from "./extras";
import type { DamageSpec, NpcSpell, NpcState, PersistentSpec } from "./shared";

// Cantidad de dados de la fórmula (el primer dado): para los bonos "por dado"
export function formulaDice(f: string): number {
  try {
    return Math.max(1, parseFormula(f).dice[0]?.count ?? 1);
  } catch {
    return 1;
  }
}

const perDieDice = (m: CustomMod, n: number) =>
  !m.perDie || !m.dice ? (m.dice ?? "") : m.dice.replace(/^(\d*)d/i, (_, c: string) => `${(parseInt(c || "1", 10) || 1) * n}d`);
const amount = (m: CustomMod, n: number) => (m.dice ? perDieDice(m, n) : m.value ? String(m.perDie ? m.value * n : m.value) : "");

// Bonos a mano del PNJ a la tirada de ataque (og: el objetivo está desprevenido)
export const npcAtkMods = (mods: CustomMod[] | undefined, og = false): Mod[] =>
  (mods ?? []).filter((m) => m.on && m.to === "atk" && m.value && (!m.og || og)).map((m) => ({ label: m.label || "Ajuste", type: m.type, value: m.value }));

export interface NpcDamageGroup {
  f: string;
  ty: string;
  mult: boolean;
  splash?: boolean;
}

export interface NpcDamage {
  // Fórmula principal (se duplica con crítico) con el tipo del ataque
  formula: string;
  ty: string;
  // Otros tipos (se duplican), lo de solo crítico (no se duplica) y la salpicadura
  groups: NpcDamageGroup[];
  pers: PersistentSpec[];
  notes: string;
  shown: string;
}

// Daño de un ataque de PNJ: la fórmula del ataque, sus daños de otros tipos y los bonos a mano.
// pen: penalizadores de las condiciones (Débil…), se apilan con los bonos planos.
export function npcDamage(o: { dmg: string; ty: string; dmg2?: DamageSpec[]; pers?: PersistentSpec; mods?: CustomMod[]; pen?: Mod[]; crit: boolean; og?: boolean }): NpcDamage {
  const { crit } = o;
  const n = formulaDice(o.dmg);
  const flat: Mod[] = [...(o.pen ?? [])];
  const dice: { f: string; ty?: string; mult: boolean; label: string }[] = [];
  const splash: { f: string; ty: string }[] = [];
  const pers: PersistentSpec[] = [];
  if (o.pers?.f && (!o.pers.crit || crit)) pers.push(o.pers);
  for (const d of o.dmg2 ?? []) if (d.f.trim()) dice.push({ f: d.f.trim(), ty: d.ty, mult: true, label: d.ty || "extra" });
  for (const m of o.mods ?? []) {
    if (!m.on || m.to !== "dmg" || (m.critOnly && !crit) || (m.og && !o.og)) continue;
    const f = amount(m, n);
    if (!f) continue;
    const label = `${m.label || "Extra"}${m.dt ? ` (${m.dt})` : ""}`;
    if (m.pers) pers.push({ f, ty: m.dt ?? "", crit: m.critOnly || undefined });
    else if (m.splash) splash.push({ f, ty: m.dt ?? "" });
    else if (m.dice || m.critOnly) dice.push({ f, ty: m.dt, mult: !m.critOnly, label });
    else flat.push({ label: m.label || "Ajuste", type: m.type, value: m.perDie ? m.value * n : m.value });
  }
  const { total, applied } = stackMods(flat);
  const same = (ty?: string) => !ty?.trim() || normType(ty) === normType(o.ty);
  const join = (list: string[]) => list.map((d) => (d.startsWith("-") ? d : `+${d}`)).join("").replace(/^\+/, "");
  const main = dice.filter((d) => d.mult && same(d.ty)).map((d) => d.f);
  const formula = `${o.dmg}${total ? fmtMod(total) : ""}${main.length ? `+${join(main)}` : ""}`;
  const groups: NpcDamageGroup[] = [];
  const byType = (list: typeof dice, mult: boolean) => {
    const m = new Map<string, { ty: string; fs: string[] }>();
    for (const d of list) {
      const ty = d.ty?.trim() || o.ty;
      const g = m.get(normType(ty)) ?? { ty, fs: [] };
      g.fs.push(d.f);
      m.set(normType(ty), g);
    }
    for (const g of m.values()) groups.push({ f: join(g.fs), ty: g.ty, mult });
  };
  byType(dice.filter((d) => d.mult && !same(d.ty)), true);
  byType(dice.filter((d) => !d.mult), false);
  if (splash.length) groups.push({ f: join(splash.map((x) => x.f)), ty: splash[0].ty || o.ty, mult: false, splash: true });
  const shown = [crit ? `2×(${formula})` : formula, ...groups.map((g) => `${crit && g.mult ? `2×(${g.f})` : g.f}${g.ty ? ` ${g.ty}` : ""}${g.splash ? " salpicadura" : ""}`)].join(" + ");
  const notes = [
    modsText(applied),
    ...dice.filter((d) => d.label !== (d.ty || "extra")).map((d) => `${d.label} ${d.f}${crit && !d.mult ? " (sin ×2)" : ""}`),
    ...pers.map((p) => `${p.f}${crit && !p.crit ? " ×2" : ""} persistente ${p.ty}`.trim()),
  ]
    .filter(Boolean)
    .join(" · ");
  return { formula, ty: o.ty, groups, pers, notes, shown };
}

// Daño de varios tipos en una línea: "2d6 frío + 2d8 espiritual"
export const damageText = (dmg: string | undefined, ty: string | undefined, dmg2?: DamageSpec[]) =>
  [dmg ? `${dmg}${ty ? ` ${ty}` : ""}` : "", ...(dmg2 ?? []).filter((d) => d.f).map((d) => `${d.f}${d.ty ? ` ${d.ty}` : ""}`)].filter(Boolean).join(" + ");

// ---------- Conjuros y poderes ----------

export const CAST_LABEL = { prep: "Preparado", spont: "Espontáneo", will: "A voluntad" } as const;

// Conjuro espontáneo de rango 1+ (los trucos y los de rango 0 son a voluntad)
const usesSlot = (sp: NpcSpell) => !sp.pow && sp.cast === "spont" && (sp.rank ?? 0) > 0;
// Tiene usos contados (preparado o poder con usos)
export const countsUses = (sp: NpcSpell) => (!sp.pow && sp.cast === "prep") || (!!sp.pow && (sp.uses ?? 0) > 0);
export const usesMax = (sp: NpcSpell) => (countsUses(sp) ? Math.max(1, sp.uses ?? 1) : 0);

// ¿Se puede usar ahora? Si no, por qué
export function spellReady(n: NpcState, sp: NpcSpell): string | null {
  if ((sp.cdLeft ?? 0) > 0) return `En enfriamiento: ${sp.cdLeft} ronda${sp.cdLeft === 1 ? "" : "s"}`;
  if (countsUses(sp) && (sp.used ?? 0) >= usesMax(sp)) return "Sin usos";
  if (usesSlot(sp)) {
    const sl = n.slots?.[String(sp.rank)];
    if (!sl || sl.used >= sl.max) return `Sin espacios de rango ${sp.rank}`;
  }
  if (sp.cost) {
    const r = n.res?.find((x) => x.id === sp.cost!.r);
    if (r && r.cur < sp.cost.n) return `Sin ${r.n || "recurso"}`;
  }
  return null;
}

// Gasta lo que cuesta usarlo (uso, espacio, recurso) y pone el enfriamiento
export function spendSpell(n: NpcState, id: string, cdRounds: number): NpcState {
  const sp = n.spells.find((s) => s.id === id);
  if (!sp) return n;
  let slots = n.slots;
  if (usesSlot(sp)) {
    const k = String(sp.rank);
    const sl = slots?.[k];
    if (sl) slots = { ...slots, [k]: { ...sl, used: Math.min(sl.max, sl.used + 1) } };
  }
  const res = sp.cost ? n.res?.map((r) => (r.id === sp.cost!.r ? { ...r, cur: Math.max(0, r.cur - sp.cost!.n) } : r)) : n.res;
  const spells = n.spells.map((s) =>
    s.id === id ? { ...s, used: countsUses(s) ? (s.used ?? 0) + 1 : s.used, cdLeft: cdRounds > 0 ? cdRounds : s.cdLeft } : s,
  );
  return { ...n, slots, res, spells };
}

// Rondas de enfriamiento fijas, o null si es un dado (hay que tirarlo)
export function fixedCooldown(cd: string | undefined): number | null {
  const t = cd?.trim();
  if (!t) return 0;
  return /^\d+$/.test(t) ? parseInt(t, 10) : null;
}

// Al empezar el turno del PNJ: baja una ronda cada enfriamiento
export function tickCooldowns(n: NpcState): NpcState | null {
  if (!n.spells.some((s) => (s.cdLeft ?? 0) > 0)) return null;
  return { ...n, spells: n.spells.map((s) => ((s.cdLeft ?? 0) > 0 ? { ...s, cdLeft: s.cdLeft! - 1 || undefined } : s)) };
}

export const clearCooldowns = (n: NpcState): NpcState => ({ ...n, spells: n.spells.map((s) => ({ ...s, cdLeft: undefined })) });

// Descanso: recupera usos, espacios y recursos, y quita los enfriamientos
export function restNpc(n: NpcState): NpcState {
  const slots = n.slots ? Object.fromEntries(Object.entries(n.slots).map(([k, v]) => [k, { ...v, used: 0 }])) : undefined;
  return {
    ...n,
    slots,
    res: n.res?.map((r) => ({ ...r, cur: r.max })),
    spells: n.spells.map((s) => ({ ...s, used: undefined, cdLeft: undefined })),
  };
}

// Ataque y CD con los que se usa: los de magia del PNJ o los propios del poder
export const spellAtkOf = (n: NpcState, sp: NpcSpell) => (sp.pow && sp.own ? (sp.atk ?? 0) : (n.spellAtk ?? 0));
export const spellDcOf = (n: NpcState, sp: NpcSpell, fallback: number) => (sp.pow && sp.own ? sp.dc || fallback : n.spellDc || fallback);

// ---------- Habilidades e iniciativa ----------

export const SKILL_LABEL: Record<string, string> = Object.fromEntries(SKILLS.map(([k, l]) => [k, l]));
const SKILL_ABILITY: Record<string, Ability> = Object.fromEntries(SKILLS.map(([k, , a]) => [k, a]));

// Nombre de una habilidad del PNJ (los Saberes van escritos a mano)
export const npcSkillName = (s: { k: string; n?: string }) => (s.k === "lore" ? `Saber${s.n ? ` (${s.n})` : ""}` : (SKILL_LABEL[s.k] ?? s.n ?? s.k));
// Clave de una habilidad en la lista (para elegirla en la iniciativa)
export const npcSkillKey = (s: { k: string; n?: string }) => (s.k === "lore" ? `lore:${s.n ?? ""}` : s.k);

// Ajustes de las condiciones a una habilidad o a la Percepción
export function npcCheckAdjust(n: NpcState, key: string) {
  if (key === "perception") return checkAdjust(n.cond, { kind: "perception" });
  const k = key.startsWith("lore:") ? "lore" : key;
  return checkAdjust(n.cond, { kind: "skill", key: k, ability: SKILL_ABILITY[k] ?? "int" });
}

// Modificador de iniciativa: Percepción o la habilidad elegida, el bono extra y las condiciones
export function npcInitiative(n: NpcState) {
  const sk = n.init?.sk ?? "perception";
  const skill = sk === "perception" ? undefined : n.skills?.find((s) => npcSkillKey(s) === sk);
  const key = skill ? sk : "perception";
  const base = skill ? skill.v : (n.per ?? 0);
  const extra = n.init?.b ?? 0;
  const adj = npcCheckAdjust(n, key);
  const label = skill ? npcSkillName(skill) : "Percepción";
  return {
    mod: base + extra + adj.total,
    label,
    notes: [extra ? `Bono ${fmtMod(extra)}` : "", modsText(adj.applied)].filter(Boolean).join(" · "),
  };
}
