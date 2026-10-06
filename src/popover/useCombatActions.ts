import { useMemo, useRef } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { fmtMod } from "../pathbuilder";
import { live } from "../live";
import { inOwlbear, tokenData } from "../obr";
import { CHANNEL_FX, newId } from "../shared";
import { store } from "../storage";
import { autoRoll, type Roller } from "../autoRoll";
import { EMPTY_COMBAT, combatStore, moveTarget, stepTurn, type Combat, type Entry, type NpcCombatant } from "../combat";
import { endOfTurn, startOfTurn, type Publish } from "../turns";
import type { RollFx } from "../fx";

export type CombatActions = ReturnType<typeof useCombatActions>;

// Acciones del GM sobre la iniciativa
export function useCombatActions(combat: Combat, entries: Entry[], who: Roller, publish: Publish) {
  const busy = useRef(false);
  // Las acciones leen siempre lo último aunque se creen una sola vez
  const ref = useRef({ combat, entries, who, publish });
  ref.current = { combat, entries, who, publish };

  return useMemo(() => {
    const patchNpcEntry = (id: string, fn: (n: NpcCombatant) => NpcCombatant) =>
      combatStore.patch((c) => ({ ...c, npcs: c.npcs.map((n) => (n.id === id ? fn(n) : n)) }));

    // La tirada de un PNJ la ve solo el GM
    const rollFor = async (name: string, mod: number) => {
      const { who, publish } = ref.current;
      const e = autoRoll(who, name, "Iniciativa", `1d20${fmtMod(mod)}`, "check");
      await publish({ ...e, secret: true });
      return e.total;
    };

    const addNpcs = async (list: { name: string; mod: number; tokenId?: string; hidden?: boolean }[]) => {
      const added: NpcCombatant[] = [];
      for (const n of list) {
        added.push({ id: newId(), name: n.name || "Criatura", tokenId: n.tokenId, mod: n.mod, hidden: n.hidden, init: await rollFor(n.name, n.mod) });
      }
      if (added.length) await combatStore.patch((c) => ({ ...c, npcs: [...c.npcs, ...added] }));
      return added.length;
    };

    // Agrega tokens del mapa: los PJ vuelven a la lista; el resto entra como PNJ
    const addTokens = async (ids: string[], mod: number) => {
      if (!inOwlbear || !ids.length) return 0;
      const { combat } = ref.current;
      const items = await OBR.scene.items.getItems(ids);
      const npcs: { name: string; mod: number; tokenId: string; hidden?: boolean }[] = [];
      const include: string[] = [];
      for (const item of items) {
        const d = tokenData(item);
        if (d?.kind === "pc" && d.characterId) {
          if (combat.excluded.includes(d.characterId)) include.push(d.characterId);
        }
        else if (!combat.npcs.some((n) => n.tokenId === item.id)) {
          npcs.push({ name: (d?.kind === "npc" && d.nick) || item.name || d?.name || "Criatura", mod, tokenId: item.id, hidden: !item.visible });
        }
      }
      if (include.length) await combatStore.patch((c) => ({ ...c, excluded: c.excluded.filter((x) => !include.includes(x)) }));
      return (await addNpcs(npcs)) + include.length;
    };

    return {
      async start() {
        await combatStore.patch((c) => ({ ...c, active: true, round: 0, current: null }));
        // Furia al iniciar el combate (casilla del bárbaro)
        const { who, publish } = ref.current;
        for (const s of Object.values(live.all())) {
          const temp = s.cls?.autoRage;
          if (!temp || s.cls?.rage || s.cond.fatigued) continue;
          await live.patch(s.id, (x) => ({ ...x, temp: Math.max(x.temp, temp), cls: { ...x.cls, rage: true } }));
          await publish({ id: newId(), time: Date.now(), ...who, charName: s.name, label: "Entra en", title: "Furia", formula: "", detail: `+${temp} PG temporales`, total: NaN, kind: "note", tag: "Furia" });
          const fx: RollFx = { kind: "rage", from: `pc:${s.id}` };
          if (inOwlbear) OBR.broadcast.sendMessage(CHANNEL_FX, fx, { destination: "ALL" }).catch(() => undefined);
        }
      },

      async end() {
        // Lo que dura "hasta el fin del combate" o por rondas se apaga
        for (const s of Object.values(live.all())) {
          const buffs = (s.cond.buffs ?? []).filter((b) => !b.until);
          const k = s.cls ?? {};
          const clsChanged = k.rage || k.psyche || k.boost || k.taunt || k.strat || k.traced || k.odCd || k.castR !== undefined || k.stupR;
          if (!s.init && !clsChanged && buffs.length === (s.cond.buffs ?? []).length) continue;
          await live.patch(s.id, (x) => ({
            ...x,
            init: undefined,
            cond: { ...x.cond, buffs: (x.cond.buffs ?? []).filter((b) => !b.until).length ? (x.cond.buffs ?? []).filter((b) => !b.until) : undefined },
            cls: x.cls
              ? { ...x.cls, rage: undefined, psyche: undefined, boost: undefined, taunt: undefined, strat: undefined, traced: undefined, odCd: undefined, castR: undefined, stupR: undefined }
              : undefined,
          }));
        }
        await combatStore.write({ ...EMPTY_COMBAT, excluded: ref.current.combat.excluded });
      },

      // Fin del turno actual → pasa el turno → inicio del turno siguiente
      async step(dir: 1 | -1) {
        if (busy.current) return;
        busy.current = true;
        try {
          const { combat, entries, who, publish } = ref.current;
          const s = stepTurn(entries, combat, dir);
          if (dir === 1 && s.from) await endOfTurn(s.from, who, publish, combat.round);
          await combatStore.patch((c) => ({ ...c, active: true, current: s.current, round: s.round }));
          if (dir === 1 && s.to) await startOfTurn(s.to, who, publish);
        } finally {
          busy.current = false;
        }
      },

      async setInit(e: Entry, value: number | null) {
        if (e.kind === "pc" && e.pc) {
          await live.patch(e.pc.id, (s) => ({
            ...s,
            init: value === null ? undefined : { skill: "manual", label: "Ajuste del GM", winsTies: false, ...s.init, value, tb: undefined, t: Date.now() },
          }));
        } else if (e.npc) {
          await patchNpcEntry(e.npc.id, (n) => ({ ...n, init: value, tb: undefined }));
        }
      },

      async move(e: Entry, dir: -1 | 1) {
        const target = moveTarget(ref.current.entries, e.key, dir);
        if (!target) return;
        if (e.kind === "pc" && e.pc) {
          await live.patch(e.pc.id, (s) => ({
            ...s,
            init: { skill: "manual", label: "Ajuste del GM", winsTies: false, ...s.init, value: target.init, tb: target.tb, t: Date.now() },
          }));
        } else if (e.npc) {
          await patchNpcEntry(e.npc.id, (n) => ({ ...n, init: target.init, tb: target.tb }));
        }
      },

      async remove(e: Entry) {
        const { combat, entries } = ref.current;
        // Si sale quien tenía el turno, pasa al siguiente sin aplicar efectos
        let current = combat.current;
        if (current === e.key) {
          const rest = entries.filter((x) => x.key !== e.key && x.init !== null);
          const i = entries.findIndex((x) => x.key === e.key);
          current = (entries.slice(i + 1).find((x) => x.init !== null) ?? rest[0])?.key ?? null;
        }
        if (e.kind === "pc" && e.pc) {
          const id = e.pc.id;
          await live.patch(id, (s) => ({ ...s, init: undefined }));
          await combatStore.patch((c) => ({ ...c, current, excluded: [...c.excluded.filter((x) => x !== id), id] }));
        } else if (e.npc) {
          const id = e.npc.id;
          await combatStore.patch((c) => ({ ...c, current, npcs: c.npcs.filter((n) => n.id !== id) }));
        }
      },

      async reroll(e: Entry) {
        if (!e.npc) return;
        const value = await rollFor(e.npc.name, e.npc.mod);
        await patchNpcEntry(e.npc.id, (n) => ({ ...n, init: value, tb: undefined }));
      },

      toggleHidden: (e: Entry) => (e.npc ? patchNpcEntry(e.npc.id, (n) => ({ ...n, hidden: !n.hidden })) : Promise.resolve()),

      include: (pcId: string) => combatStore.patch((c) => ({ ...c, excluded: c.excluded.filter((x) => x !== pcId) })),

      addByName: (name: string, mod: number) => addNpcs([{ name, mod }]),

      async addSelected(mod: number) {
        if (!inOwlbear) return 0;
        let ids = (await OBR.player.getSelection()) ?? [];
        const last = store.lastSelection();
        if (!ids.length && last && Date.now() - last.t < 120_000) ids = last.ids;
        return addTokens(ids, mod);
      },

      // Todos los tokens con estadísticas de PNJ que aún no están en la iniciativa
      async addSceneNpcs(mod: number) {
        if (!inOwlbear || !(await OBR.scene.isReady())) return 0;
        const items = await OBR.scene.items.getItems((i) => tokenData(i)?.kind === "npc");
        return addTokens(items.map((i) => i.id), mod);
      },
    };
  }, []);
}
