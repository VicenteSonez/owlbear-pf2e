// Efectos automáticos al empezar y terminar un turno. Los ejecuta solo el cliente del GM
// al pulsar "Siguiente turno", así no se aplican dos veces.
import OBR from "@owlbear-rodeo/sdk";
import { live, type PcState } from "./live";
import { inOwlbear, patchNpc, tokenData } from "./obr";
import { applyDamage, applyHealing, applyRecovery, effectiveMaxHp, DEATH_DYING, type Conditions } from "./rules";
import { newId, npcState, type NpcState, type RollEntry } from "./shared";
import { autoRecovery, resolvePersistent, type Roller } from "./autoRoll";
import type { Entry } from "./combat";

export type Publish = (e: RollEntry) => Promise<void>;

export type TurnTarget = { kind: "pc"; state: PcState } | { kind: "npc"; tokenId: string; state: NpcState; secret: boolean };

// Estado actual de un combatiente (los PNJ sin token no tienen PG ni condiciones)
export async function turnTarget(e: Entry): Promise<TurnTarget | null> {
  if (e.kind === "pc") {
    const s = e.pc ? live.get(e.pc.id) : undefined;
    return s ? { kind: "pc", state: s } : null;
  }
  if (!e.tokenId || !inOwlbear) return null;
  const [item] = await OBR.scene.items.getItems([e.tokenId]);
  const d = item ? tokenData(item) : undefined;
  if (d?.kind !== "npc") return null;
  const state = npcState(d);
  return { kind: "npc", tokenId: e.tokenId, state, secret: state.hidden || e.hidden };
}

const publishAs = (t: TurnTarget, publish: Publish) => (e: RollEntry) =>
  publish(t.kind === "npc" && t.secret ? { ...e, secret: true } : e);

function patchTarget(t: TurnTarget, fn: (v: { hp: number; temp: number; dying: number; wounded: number; cond: Conditions }) => {
  hp: number;
  temp: number;
  dying: number;
  wounded: number;
  cond: Conditions;
}) {
  if (t.kind === "pc") return live.patch(t.state.id, (s) => ({ ...s, ...fn(s) }));
  return patchNpc(t.tokenId, (n) => {
    const out = fn({ hp: n.hp, temp: n.temp, dying: 0, wounded: 0, cond: n.cond });
    return { ...n, hp: Math.min(n.maxHp, out.hp), temp: out.temp, cond: out.cond };
  });
}

// Daño persistente: tira cada daño y luego la prueba plana CD 15 para terminarlo
export async function applyPersistent(t: TurnTarget, who: Roller, publish: Publish) {
  const list = t.state.cond?.persistent ?? [];
  if (!list.length) return;
  const { damage, ended, entries } = resolvePersistent(who, t.state.name, list);
  const send = publishAs(t, publish);
  for (const e of entries) await send(e);
  await patchTarget(t, (v) => ({
    ...applyDamage(v, damage),
    cond: { ...v.cond, persistent: (v.cond.persistent ?? []).filter((p) => !ended.includes(p.id)) },
  }));
}

// Fin de turno: daño persistente y luego Asustado baja en 1
export async function endOfTurn(e: Entry, who: Roller, publish: Publish) {
  let t = await turnTarget(e);
  if (!t) return;
  await applyPersistent(t, who, publish);
  t = await turnTarget(e);
  if (!t?.state.cond.frightened) return;
  await patchTarget(t, (v) => ({ ...v, cond: { ...v.cond, frightened: Math.max(0, (v.cond.frightened ?? 0) - 1) } }));
}

// Inicio de turno: sanación rápida, baja el escudo y, si sigue moribundo, tirada de recuperación
export async function startOfTurn(e: Entry, who: Roller, publish: Publish) {
  const t = await turnTarget(e);
  if (!t) return;
  const send = publishAs(t, publish);
  const fh = t.state.cond.fastHealing ?? 0;
  const dead = t.kind === "pc" && t.state.dying >= DEATH_DYING;
  if (fh > 0 && !dead) {
    await send({
      id: newId(),
      time: Date.now(),
      ...who,
      charName: t.state.name,
      label: "Sanación rápida",
      formula: String(fh),
      detail: `${fh} PG`,
      total: fh,
      kind: "free",
    });
    if (t.kind === "pc") {
      await live.patch(t.state.id, (s) => applyHealing(s, fh, effectiveMaxHp(s.maxHp, s.level, s.cond)));
    } else {
      await patchNpc(t.tokenId, (n) => ({ ...n, hp: Math.min(n.maxHp, n.hp + fh) }));
    }
  }
  if (t.kind !== "pc") return;
  const s = live.get(t.state.id);
  if (!s) return;
  if (s.shield?.raised) await live.patch(s.id, (x) => (x.shield ? { ...x, shield: { ...x.shield, raised: false } } : x));
  if (s.dying > 0 && s.dying < DEATH_DYING) {
    const r = autoRecovery(who, s.name, s.dying);
    await send(r);
    await live.patch(s.id, (x) => applyRecovery(x, r.degree));
  }
}
