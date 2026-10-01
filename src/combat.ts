// Combate e iniciativa. El estado del combate (ronda, turno actual y PNJ) vive en una sola
// clave de la sala que solo escribe el GM. La iniciativa de cada PJ vive en su propio estado
// (live.ts), así varios jugadores pueden tirar a la vez sin pisarse.
import { useEffect, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { ID } from "./shared";
import { inOwlbear, whenReady } from "./obr";
import type { PcState } from "./live";

export const META_COMBAT = `${ID}/combat`;
const LOCAL_KEY = "pf2.combat.local";

// Tirada de iniciativa de un PJ, guardada en su estado de la sala
export interface InitRoll {
  value: number;
  // Habilidad usada (clave de Pathbuilder o "perception") y su nombre para mostrar
  skill: string;
  label: string;
  winsTies: boolean;
  // Desempate fijado a mano por el GM al reordenar
  tb?: number;
  t: number;
}

export interface NpcCombatant {
  id: string;
  name: string;
  tokenId?: string;
  mod: number;
  init: number | null;
  tb?: number;
  // Oculto a los jugadores en la lista de iniciativa
  hidden?: boolean;
}

export interface Combat {
  v: 1;
  active: boolean;
  round: number;
  // Clave del combatiente en turno ("pc:<id>" o "npc:<id>")
  current: string | null;
  npcs: NpcCombatant[];
  // PJ de la sala que el GM sacó de la iniciativa
  excluded: string[];
  t: number;
}

export const EMPTY_COMBAT: Combat = { v: 1, active: false, round: 0, current: null, npcs: [], excluded: [], t: 0 };

export const pcKey = (id: string) => `pc:${id}`;
export const npcKey = (id: string) => `npc:${id}`;

// ---------- Orden ----------

export interface Entry {
  key: string;
  kind: "pc" | "npc";
  name: string;
  init: number | null;
  // Desempate: mayor va antes. Por defecto los PNJ ganan a los PJ salvo que el PJ
  // marque que gana los empates.
  tb: number;
  hidden: boolean;
  pc?: PcState;
  npc?: NpcCombatant;
  tokenId?: string;
}

const TB_PC = 0;
const TB_NPC = 1;
const TB_PC_WINS = 2;

export function combatEntries(c: Combat, states: Record<string, PcState>): Entry[] {
  const list: Entry[] = [];
  for (const s of Object.values(states)) {
    // Las mascotas actúan en el turno de su PJ
    if (c.excluded.includes(s.id) || s.pet) continue;
    const init = s.init ?? null;
    list.push({
      key: pcKey(s.id),
      kind: "pc",
      name: s.name,
      init: init ? init.value : null,
      tb: init?.tb ?? (init?.winsTies ? TB_PC_WINS : TB_PC),
      hidden: false,
      pc: s,
    });
  }
  for (const n of c.npcs) {
    list.push({
      key: npcKey(n.id),
      kind: "npc",
      name: n.name,
      init: n.init,
      tb: n.tb ?? TB_NPC,
      hidden: !!n.hidden,
      npc: n,
      tokenId: n.tokenId,
    });
  }
  return list.sort((a, b) => {
    if (a.init === null || b.init === null) return a.init === b.init ? a.name.localeCompare(b.name) : a.init === null ? 1 : -1;
    return b.init - a.init || b.tb - a.tb || a.name.localeCompare(b.name);
  });
}

// Nuevos (iniciativa, desempate) para que una entrada pase a la vecina de arriba (-1) o de abajo (+1)
export function moveTarget(list: Entry[], key: string, dir: -1 | 1): { init: number; tb: number } | null {
  const i = list.findIndex((e) => e.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return null;
  const nb = list[j];
  if (nb.init === null) return null;
  const beyond = list[j + dir];
  const init = nb.init;
  // Queda justo al otro lado de la vecina, sin saltarse a la siguiente si empatan
  const tb = beyond && beyond.init === init ? (nb.tb + beyond.tb) / 2 : nb.tb - dir;
  return { init, tb };
}

// Siguiente (o anterior) en el orden; da la vuelta cambiando de ronda
export function stepTurn(list: Entry[], c: Combat, dir: 1 | -1): { current: string | null; round: number; from?: Entry; to?: Entry } {
  const ready = list.filter((e) => e.init !== null);
  const order = ready.length ? ready : list;
  if (!order.length) return { current: null, round: c.round };
  const i = order.findIndex((e) => e.key === c.current);
  if (i < 0) return { current: order[0].key, round: Math.max(1, c.round), to: order[0] };
  let j = i + dir;
  let round = c.round;
  if (j >= order.length) {
    j = 0;
    round += 1;
  } else if (j < 0) {
    if (round <= 1) return { current: c.current, round };
    j = order.length - 1;
    round -= 1;
  }
  return { current: order[j].key, round, from: order[i], to: order[j] };
}

// ---------- Estado compartido ----------

type Listener = (c: Combat) => void;

class CombatStore {
  private combat: Combat = EMPTY_COMBAT;
  private listeners = new Set<Listener>();
  private startPromise: Promise<void> | null = null;

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      if (await whenReady()) {
        this.ingest((await OBR.room.getMetadata())[META_COMBAT]);
        OBR.room.onMetadataChange((md) => this.ingest(md[META_COMBAT]));
      } else {
        this.ingestLocal();
        window.addEventListener("storage", (e) => {
          if (e.key === LOCAL_KEY) this.ingestLocal();
        });
      }
    })();
    return this.startPromise;
  }

  private ingest(v: unknown) {
    const next = v && typeof v === "object" ? { ...EMPTY_COMBAT, ...(v as Combat) } : EMPTY_COMBAT;
    if (next.t === this.combat.t && next.current === this.combat.current) return;
    this.combat = next;
    this.emit();
  }

  private ingestLocal() {
    try {
      this.ingest(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "null"));
    } catch {
      this.ingest(null);
    }
  }

  private emit() {
    for (const l of this.listeners) l(this.combat);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.combat);
    return () => this.listeners.delete(l);
  }

  get() {
    return this.combat;
  }

  async write(c: Combat) {
    this.combat = { ...c, t: Date.now() };
    this.emit();
    if (inOwlbear) await OBR.room.setMetadata({ [META_COMBAT]: this.combat });
    else {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(this.combat));
      } catch {
        // sin almacenamiento: queda en memoria
      }
    }
  }

  patch(fn: (c: Combat) => Combat) {
    return this.write(fn(this.combat));
  }
}

export const combatStore = new CombatStore();

export function useCombat(): Combat {
  const [c, setC] = useState<Combat>(() => combatStore.get());
  useEffect(() => {
    combatStore.start();
    return combatStore.subscribe(setC);
  }, []);
  return c;
}
