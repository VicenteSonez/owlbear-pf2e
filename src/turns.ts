// Efectos automáticos al empezar y terminar un turno. Los ejecuta solo el cliente del GM
// al pulsar "Siguiente turno", así no se aplican dos veces.
import OBR from "@owlbear-rodeo/sdk";
import { live, type PcState } from "./live";
import { inOwlbear, patchNpc, tokenData } from "./obr";
import { applyDamage, applyHealing, applyRecovery, effectiveMaxHp, expireBuffs, DEATH_DYING, type Conditions } from "./rules";
import { META_TOKEN, newId, npcState, type NpcState, type RollEntry, type TokenData } from "./shared";
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

// Claves con las que se marca el vencimiento de un bono: la del combate y la del token o PJ
const turnKeys = (e: Entry) => [e.key, ...(e.tokenId ? [`npc:${e.tokenId}`] : [])];

// Quita de todos (PJ y PNJ de la escena) los bonos que vencen en este momento del turno
export async function expireAll(keys: string[], at: "start" | "end") {
  for (const s of Object.values(live.all())) {
    const next = expireBuffs(s.cond ?? {}, keys, at);
    if (next) await live.patch(s.id, (x) => ({ ...x, cond: expireBuffs(x.cond ?? {}, keys, at) ?? x.cond }));
  }
  if (!inOwlbear || !(await OBR.scene.isReady())) return;
  const items = await OBR.scene.items.getItems((i) => {
    const d = i.metadata[META_TOKEN] as TokenData | undefined;
    return d?.kind === "npc" && !!d.cond && !!expireBuffs(d.cond, keys, at);
  });
  for (const i of items) await patchNpc(i.id, (n) => ({ ...n, cond: expireBuffs(n.cond, keys, at) ?? n.cond }));
}

// Rasgos de clase al empezar el turno del PJ: Provocar y Potenciar eidolón terminan; la
// espera de la Sobrecarga baja una ronda
async function classStart(id: string) {
  const s = live.get(id);
  if (!s?.cls) return;
  const k = s.cls;
  if (!k.taunt && !k.boost && !k.odCd) return;
  await live.patch(id, (x) => ({ ...x, cls: { ...x.cls, taunt: undefined, boost: undefined, odCd: x.cls?.odCd && x.cls.odCd > 1 ? x.cls.odCd - 1 : undefined } }));
}

// Al terminar su turno: se gasta la estratagema, vencen las runas trazadas del turno anterior
// y avanza Desatar psique (al terminar deja Estupefacto 1 por 2 rondas)
async function classEnd(id: string, round: number) {
  const s = live.get(id);
  if (!s?.cls) return;
  await live.patch(id, (x) => {
    const k = { ...x.cls };
    let cond = x.cond;
    k.strat = undefined;
    if (k.traced) {
      const keep = k.traced.filter((t) => t.r >= round);
      k.traced = keep.length ? keep : undefined;
    }
    if (k.stupR) {
      k.stupR -= 1;
      if (!k.stupR) {
        k.stupR = undefined;
        cond = { ...cond, stupefied: Math.max(0, (cond.stupefied ?? 0) - 1) || undefined };
      }
    }
    if (k.psyche) {
      k.psyche -= 1;
      if (!k.psyche) {
        k.psyche = undefined;
        k.stupR = 2;
        cond = { ...cond, stupefied: Math.max(1, cond.stupefied ?? 0) };
      }
    }
    return { ...x, cls: k, cond };
  });
}

// Fin de turno: daño persistente y luego Asustado baja en 1
export async function endOfTurn(e: Entry, who: Roller, publish: Publish, round = 0) {
  await expireAll(turnKeys(e), "end");
  if (e.kind === "pc" && e.pc) await classEnd(e.pc.id, round);
  let t = await turnTarget(e);
  if (!t) return;
  await applyPersistent(t, who, publish);
  t = await turnTarget(e);
  if (!t?.state.cond.frightened) return;
  await patchTarget(t, (v) => ({ ...v, cond: { ...v.cond, frightened: Math.max(0, (v.cond.frightened ?? 0) - 1) } }));
}

// Inicio de turno: sanación rápida, baja el escudo y, si sigue moribundo, tirada de recuperación
export async function startOfTurn(e: Entry, who: Roller, publish: Publish) {
  await expireAll(turnKeys(e), "start");
  if (e.kind === "pc" && e.pc) await classStart(e.pc.id);
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
