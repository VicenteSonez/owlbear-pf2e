// Aplica daño y curación a cualquier objetivo (PJ, mascota o PNJ) con sus inmunidades,
// resistencias, debilidades y el bloqueo con escudo. Lo usan la pestaña GM, los ataques de
// PNJ, los pedidos de daño de los jugadores y las salvaciones básicas.
import OBR from "@owlbear-rodeo/sdk";
import { live } from "./live";
import { inOwlbear, patchNpc, tokenData } from "./obr";
import {
  applyDamage,
  applyHealing,
  autoIwr,
  effectiveAc,
  effectiveMaxHp,
  resolveIwr,
  shieldBlock,
  type Conditions,
  type Iwr,
  type IwrPick,
  type ShieldState,
} from "./rules";
import { npcLabel, npcState } from "./shared";

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
export async function readTarget(t: TargetRef): Promise<TargetInfo | null> {
  if (t.kind === "pc") {
    const s = live.get(t.id);
    if (!s) return null;
    return {
      ref: t,
      name: s.name,
      ac: effectiveAc(s.baseAc, s.acAdj, s.cond, s.shield).ac,
      iwr: s.iwr,
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
    iwr: n.iwr,
    shield: n.shield,
    cond: n.cond,
    level: n.level,
    hidden: n.hidden || !item.visible,
    tokenId: item.id,
  };
}

export interface DamageOpts {
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
  const pick = o.pick ?? autoIwr(iwr, o.type ?? "");
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
