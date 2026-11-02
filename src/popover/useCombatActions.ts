import { useMemo, useRef } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { fmtMod } from "../pathbuilder";
import { live } from "../live";
import { inOwlbear, patchNpc, tokenData } from "../obr";
import { FLANK_ID, isFlanked, setFlank, shieldBroken, type Conditions } from "../rules";
import { avoidNotice, hasAct, type Observer } from "../explore";
import { CHANNEL_FX, newId, npcLabel, npcState } from "../shared";
import { store } from "../storage";
import { autoRoll, type Roller } from "../autoRoll";
import { EMPTY_COMBAT, combatStore, moveTarget, stepTurn, type Combat, type Entry, type NpcCombatant } from "../combat";
import { endOfTurn, startOfTurn, type Publish } from "../turns";
import type { RollFx } from "../fx";
import { clearCooldowns, npcInitiative } from "../npc";

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
    const rollFor = async (name: string, mod: number, lbl?: string) => {
      const { who, publish } = ref.current;
      const e = autoRoll(who, name, lbl ? `Iniciativa (${lbl})` : "Iniciativa", `1d20${fmtMod(mod)}`, "check");
      await publish({ ...e, secret: true });
      return e.total;
    };

    const addNpcs = async (list: { name: string; mod: number; lbl?: string; tokenId?: string; hidden?: boolean }[]) => {
      const added: NpcCombatant[] = [];
      for (const n of list) {
        added.push({ id: newId(), name: n.name || "Criatura", tokenId: n.tokenId, mod: n.mod, lbl: n.lbl, hidden: n.hidden, init: await rollFor(n.name, n.mod, n.lbl) });
      }
      if (added.length) await combatStore.patch((c) => ({ ...c, npcs: [...c.npcs, ...added] }));
      return added.length;
    };

    // Agrega tokens del mapa: los PJ vuelven a la lista; el resto entra como PNJ
    const addTokens = async (ids: string[], mod: number) => {
      if (!inOwlbear || !ids.length) return 0;
      const { combat } = ref.current;
      const items = await OBR.scene.items.getItems(ids);
      const npcs: { name: string; mod: number; lbl?: string; tokenId: string; hidden?: boolean }[] = [];
      const include: string[] = [];
      for (const item of items) {
        const d = tokenData(item);
        if (d?.kind === "pc" && d.characterId) {
          if (combat.excluded.includes(d.characterId)) include.push(d.characterId);
        }
        else if (!combat.npcs.some((n) => n.tokenId === item.id)) {
          // Con ficha de PNJ tira con su iniciativa (Percepción o la habilidad elegida); si no, con el Mod escrito
          const ini = d?.kind === "npc" ? npcInitiative(npcState(d)) : undefined;
          npcs.push({ name: (d?.kind === "npc" && d.nick) || item.name || d?.name || "Criatura", mod: ini?.mod ?? mod, lbl: ini?.label, tokenId: item.id, hidden: !item.visible });
        }
      }
      if (include.length) await combatStore.patch((c) => ({ ...c, excluded: c.excluded.filter((x) => !include.includes(x)) }));
      return (await addNpcs(npcs)) + include.length;
    };

    // Pasar desapercibido: quien tiró Sigilo como iniciativa queda Escondido de los PNJ del combate
    // cuya CD de Percepción (10 + Percepción) iguale o supere. Devuelve cuántos PJ revisó.
    const applyAvoidNotice = async () => {
      const { combat, who, publish } = ref.current;
      const sneaks = Object.values(live.all()).filter((s) => !s.pet && s.init?.skill === "stealth" && !combat.excluded.includes(s.id));
      // Escondido se lleva por token: los PNJ sin token no cuentan
      const withToken = combat.npcs.filter((n) => n.tokenId);
      if (!sneaks.length || !withToken.length) return 0;
      const items = inOwlbear ? await OBR.scene.items.getItems(withToken.map((n) => n.tokenId!)) : [];
      const observers: Observer[] = withToken.map((n) => {
        const item = items.find((i) => i.id === n.tokenId);
        const d = item && tokenData(item);
        const npc = d?.kind === "npc" ? npcState(d) : undefined;
        return { key: `npc:${n.tokenId}`, name: npc ? npcLabel(npc) : n.name, dc: 10 + (npc?.per ?? n.mod) };
      });
      const list = (os: Observer[]) => os.map((o) => `${o.name} (CD ${o.dc})`).join(", ");
      for (const s of sneaks) {
        const r = avoidNotice(s.init!.value, observers);
        if (r.from.length) await live.patch(s.id, (x) => ({ ...x, cond: { ...x.cond, hidden: true, hidFrom: r.from.map((o) => o.key) } }));
        await publish({
          id: newId(),
          time: Date.now(),
          ...who,
          charName: s.name,
          label: `Pasar desapercibido · Sigilo ${s.init!.value}`,
          title: r.from.length ? "Escondido" : "Detectado",
          formula: "",
          detail: [r.from.length ? `Escondido de ${list(r.from)}` : "", r.seen.length ? `Lo ven ${list(r.seen)}` : ""].filter(Boolean).join(" · "),
          total: NaN,
          kind: "note",
          secret: true,
          tag: "Exploración",
        });
      }
      return sneaks.length;
    };

    return {
      applyAvoidNotice,

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
        // Alzar escudo (exploración): parte con el escudo alzado; baja al empezar su turno
        for (const s of Object.values(live.all())) {
          if (!hasAct(s, "defend") || !s.shield || s.shield.raised || shieldBroken(s.shield)) continue;
          await live.patch(s.id, (x) => (x.shield ? { ...x, shield: { ...x.shield, raised: true } } : x));
        }
      },

      async end() {
        // Lo que dura "hasta el fin del combate" o por rondas se apaga, y el flanqueo también
        // (depende de la posición en el combate)
        const lasting = (c: Conditions) => (c.buffs ?? []).filter((b) => !b.until && b.id !== FLANK_ID);
        for (const s of Object.values(live.all())) {
          const buffs = lasting(s.cond);
          const k = s.cls ?? {};
          const clsChanged = k.rage || k.psyche || k.boost || k.taunt || k.strat || k.traced || k.odCd || k.castR !== undefined || k.stupR;
          if (!s.init && !clsChanged && buffs.length === (s.cond.buffs ?? []).length) continue;
          await live.patch(s.id, (x) => ({
            ...x,
            init: undefined,
            cond: { ...x.cond, buffs: lasting(x.cond).length ? lasting(x.cond) : undefined },
            cls: x.cls
              ? { ...x.cls, rage: undefined, psyche: undefined, boost: undefined, taunt: undefined, strat: undefined, traced: undefined, odCd: undefined, castR: undefined, stupR: undefined }
              : undefined,
          }));
        }
        if (inOwlbear && (await OBR.scene.isReady())) {
          const flanked = await OBR.scene.items.getItems((i) => isFlanked(tokenData(i)?.cond));
          for (const i of flanked) await patchNpc(i.id, (n) => ({ ...n, cond: setFlank(n.cond, false) }));
          // Los enfriamientos de los poderes de PNJ duran rondas: se acaban con el combate
          const cooling = await OBR.scene.items.getItems((i) => (tokenData(i)?.spells ?? []).some((sp) => (sp.cdLeft ?? 0) > 0));
          for (const i of cooling) await patchNpc(i.id, clearCooldowns);
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
          // Primer turno: ya están todas las iniciativas, se resuelve Pasar desapercibido
          if (dir === 1 && !combat.current) await applyAvoidNotice();
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
        // Con ficha de PNJ vuelve a calcular su iniciativa (condiciones y bonos actuales)
        let ini: { mod: number; label?: string } = { mod: e.npc.mod, label: e.npc.lbl };
        if (e.npc.tokenId && inOwlbear) {
          const [item] = await OBR.scene.items.getItems([e.npc.tokenId]);
          const d = item && tokenData(item);
          if (d?.kind === "npc") ini = npcInitiative(npcState(d));
        }
        const value = await rollFor(e.npc.name, ini.mod, ini.label);
        await patchNpcEntry(e.npc.id, (n) => ({ ...n, init: value, mod: ini.mod, lbl: ini.label, tb: undefined }));
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
