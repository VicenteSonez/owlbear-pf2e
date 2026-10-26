// Aplica daño y curación a cualquier objetivo (PJ, mascota o PNJ) con sus inmunidades,
// resistencias, debilidades y el bloqueo con escudo. Lo usan la pestaña GM, los ataques de
// PNJ, los pedidos de daño de los jugadores y las salvaciones básicas.
import OBR from "@owlbear-rodeo/sdk";
import { live, type PcState } from "./live";
import { inOwlbear, patchNpc, tokenData } from "./obr";
import {
  applyDamage,
  applyHealing,
  autoIwr,
  effectiveAc,
  effectiveMaxHp,
  lifeIwr,
  normType,
  resolveIwr,
  shieldBlock,
  withExtraIwr,
  type Conditions,
  type DamageTags,
  type Iwr,
  type IwrPick,
  type ShieldState,
} from "./rules";
import { npcLabel, npcState } from "./shared";
import { ikonIwr } from "./classes";

export type TargetRef = { kind: "pc"; id: string } | { kind: "npc"; tokenId: string };

export const targetKey = (t: TargetRef) => (t.kind === "pc" ? `pc:${t.id}` : `npc:${t.tokenId}`);

export function parseTargetKey(k: string): TargetRef | null {
  if (k.startsWith("pc:")) return { kind: "pc", id: k.slice(3) };
  if (k.startsWith("npc:")) return { kind: "npc", tokenId: k.slice(4) };
  return null;
}

export interface TargetInfo {
  ref: TargetRef;
  name: string;
  ac: number;
  iwr?: Iwr;
  shield?: ShieldState;
  cond: Conditions;
  level: number;
  hidden: boolean;
  tokenId?: string;
}

export const npcMaxHp = (n: { maxHp: number; level: number; cond: Conditions }) => effectiveMaxHp(n.maxHp, n.level, n.cond);

// Lee el estado actual del objetivo (PJ desde la sala, PNJ desde su token)
// Resistencias de un PJ con las de sus rasgos de clase y la inmunidad de vivo o muerto viviente
export const pcIwr = (s: PcState) => lifeIwr(withExtraIwr(s.iwr, ikonIwr(s)), s.undead);

export async function readTarget(t: TargetRef): Promise<TargetInfo | null> {
  if (t.kind === "pc") {
    const s = live.get(t.id);
    if (!s) return null;
    return {
      ref: t,
      name: s.name,
      ac: effectiveAc(s.baseAc, s.acAdj, s.cond, s.shield).ac,
      iwr: pcIwr(s),
      shield: s.shield,
      cond: s.cond,
      level: s.level,
      hidden: false,
    };
  }
  if (!inOwlbear) return null;
  const [item] = await OBR.scene.items.getItems([t.tokenId]);
  const d = item ? tokenData(item) : undefined;
  if (d?.kind !== "npc") return null;
  const n = npcState(d);
  return {
    ref: t,
    name: npcLabel({ name: item.name || n.name, num: n.num, nick: n.nick }),
    ac: effectiveAc(n.baseAc, n.acAdj, n.cond, n.shield).ac,
    iwr: lifeIwr(n.iwr, n.undead),
    shield: n.shield,
    cond: n.cond,
    level: n.level,
    hidden: n.hidden || !item.visible,
    tokenId: item.id,
  };
}

export interface DamageOpts extends DamageTags {
  type?: string;
  // Qué inmunidad/resistencia/debilidad aplicar (si no, las que coinciden con el tipo)
  pick?: IwrPick;
  // Bloquear con el escudo alzado
  block?: boolean;
}

export interface DamageResult {
  total: number;
  notes: string;
}

// Calcula el daño final (sin escribir nada)
export function finalDamage(amount: number, iwr: Iwr | undefined, o: DamageOpts): DamageResult {
  const pick = o.pick ?? autoIwr(iwr, o.type ?? "", o);
  return resolveIwr(amount, iwr, pick);
}

export async function dealDamage(t: TargetRef, amount: number, o: DamageOpts = {}): Promise<DamageResult> {
  const info = await readTarget(t);
  const res = finalDamage(amount, info?.iwr, o);
  let notes = res.notes;
  if (res.total <= 0) return res;
  if (t.kind === "pc") {
    const s = live.get(t.id);
    if (!s) return res;
    let through = res.total;
    if (o.block && s.shield) {
      const b = shieldBlock(s.shield, res.total);
      through = b.through;
      notes = [notes, `Escudo bloquea ${res.total - b.through}`].filter(Boolean).join(", ");
      await live.patch(t.id, (x) => ({ ...x, shield: b.shield }));
    }
    // El eidolón recibe el daño en los PG de su invocador
    if (through > 0) await live.patch(live.hpHolder(t.id), (x) => applyDamage(x, through));
    return { total: through, notes };
  }
  let through = res.total;
  await patchNpc(t.tokenId, (n) => {
    let shield = n.shield;
    if (o.block && shield) {
      const b = shieldBlock(shield, res.total);
      shield = b.shield;
      through = b.through;
    }
    const hit = applyDamage({ hp: n.hp, temp: n.temp, dying: 0, wounded: 0 }, through);
    return { ...n, shield, hp: hit.hp, temp: hit.temp };
  });
  if (o.block && through !== res.total) notes = [notes, `Escudo bloquea ${res.total - through}`].filter(Boolean).join(", ");
  return { total: through, notes };
}

// Parte de un daño de varios tipos (arma + espíritu + fuego de una runa…)
export interface DamagePart {
  amt: number;
  ty: string;
}

export const NO_IWR: IwrPick = { imm: false, res: [], weak: [] };

// Junta las partes del mismo tipo: la salpicadura se suma al daño base antes de las resistencias
export function mergeParts(parts: DamagePart[]): DamagePart[] {
  const out: DamagePart[] = [];
  for (const p of parts) {
    const same = out.find((x) => normType(x.ty) === normType(p.ty));
    if (same) same.amt += p.amt;
    else out.push({ ...p });
  }
  return out;
}

// Daño final de varias partes, cada una con sus resistencias (contra "todo" se aplica a cada tipo)
export function finalParts(parts: DamagePart[], iwr: Iwr | undefined, picks: IwrPick[]): DamageResult {
  let total = 0;
  const notes: string[] = [];
  parts.forEach((p, i) => {
    const r = resolveIwr(p.amt, iwr, picks[i] ?? NO_IWR);
    total += r.total;
    if (r.notes) notes.push(parts.length > 1 ? `${p.ty || "sin tipo"}: ${r.notes}` : r.notes);
  });
  return { total, notes: notes.join(" · ") };
}

export async function healTarget(t: TargetRef, amount: number) {
  if (amount <= 0) return;
  if (t.kind === "pc") {
    await live.patch(live.hpHolder(t.id), (x) => applyHealing(x, amount, effectiveMaxHp(x.maxHp, x.level, x.cond)));
    return;
  }
  await patchNpc(t.tokenId, (n) => ({ ...n, hp: Math.min(npcMaxHp(n), n.hp + amount) }));
}

// Daño de una salvación básica según el grado
export function basicSaveDamage(amount: number, degree: string) {
  if (degree === "crit-success") return 0;
  if (degree === "success") return Math.floor(amount / 2);
  if (degree === "crit-failure") return amount * 2;
  return amount;
}
