// Pedidos compartidos en la metadata de la sala, una clave por pedido (así dos jugadores
// pueden escribir a la vez sin pisarse):
// - Daño pendiente: un PJ golpea a un PNJ y el GM autoriza el daño (y sus resistencias).
// - Efectos de salvación: el GM (o un conjuro) pide una salvación a varios PJ y PNJ; cada
//   resultado va en su propia clave y el efecto queda en el historial hasta que todos tiren.
import { useEffect, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { ID, type SaveKey } from "./shared";
import { inOwlbear, whenReady } from "./obr";
import type { Degree } from "./rules";

export interface DamageReq {
  id: string;
  // PJ que atacó y su dueño
  from: string;
  fromName: string;
  // Token del PNJ que recibe
  tok: string;
  n: string;
  amt: number;
  ty: string;
  crit?: boolean;
  label: string;
  // Debilidad mortal (taumaturgo): activa la mayor debilidad del objetivo
  mortal?: boolean;
  heal?: boolean;
  t: number;
}

export interface SaveTarget {
  // "pc:<id>" o "npc:<tokenId>"
  k: string;
  n: string;
}

export interface SaveEffect {
  id: string;
  name: string;
  save: SaveKey;
  dc: number;
  basic?: boolean;
  fear?: boolean;
  // Daño de la salvación básica (se tira una vez y se ajusta por grado)
  dmg?: string;
  ty?: string;
  from: string;
  fromName: string;
  targets: SaveTarget[];
  t: number;
}

export interface SaveResult {
  total: number;
  degree: Degree;
  nat?: 1 | 20;
  // Daño ya aplicado por la salvación básica
  applied?: number;
  t: number;
}

type Listener<T> = (all: Record<string, T>) => void;

class PrefixStore<T> {
  private data: Record<string, T> = {};
  private listeners = new Set<Listener<T>>();
  private startPromise: Promise<void> | null = null;
  private readonly prefix: string;
  private readonly localKey: string;

  constructor(prefix: string, localKey: string) {
    this.prefix = prefix;
    this.localKey = localKey;
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      if (await whenReady()) {
        this.ingest(await OBR.room.getMetadata());
        OBR.room.onMetadataChange((md) => this.ingest(md));
      } else {
        this.ingestLocal();
        window.addEventListener("storage", (e) => {
          if (e.key === this.localKey) this.ingestLocal();
        });
      }
    })();
    return this.startPromise;
  }

  private ingest(md: Record<string, unknown>) {
    const next: Record<string, T> = {};
    for (const [k, v] of Object.entries(md)) {
      if (k.startsWith(this.prefix) && v && typeof v === "object") next[k.slice(this.prefix.length)] = v as T;
    }
    if (JSON.stringify(next) === JSON.stringify(this.data)) return;
    this.data = next;
    this.emit();
  }

  private ingestLocal() {
    try {
      this.data = JSON.parse(localStorage.getItem(this.localKey) ?? "{}");
    } catch {
      this.data = {};
    }
    this.emit();
  }

  private persistLocal() {
    try {
      localStorage.setItem(this.localKey, JSON.stringify(this.data));
    } catch {
      // queda en memoria
    }
  }

  private emit() {
    for (const l of this.listeners) l({ ...this.data });
  }

  subscribe(l: Listener<T>) {
    this.listeners.add(l);
    l({ ...this.data });
    return () => {
      this.listeners.delete(l);
    };
  }

  all() {
    return { ...this.data };
  }

  async set(key: string, value: T) {
    this.data = { ...this.data, [key]: value };
    this.emit();
    if (inOwlbear) await OBR.room.setMetadata({ [this.prefix + key]: value });
    else this.persistLocal();
  }

  async remove(keys: string[]) {
    if (!keys.length) return;
    const next = { ...this.data };
    for (const k of keys) delete next[k];
    this.data = next;
    this.emit();
    if (inOwlbear) await OBR.room.setMetadata(Object.fromEntries(keys.map((k) => [this.prefix + k, undefined])));
    else this.persistLocal();
  }
}

export const damageReqs = new PrefixStore<DamageReq>(`${ID}/dmg/`, "pf2.dmg.local");
export const saveEffects = new PrefixStore<SaveEffect>(`${ID}/sv/`, "pf2.sv.local");
// Clave del resultado: "<idEfecto>|<claveObjetivo>"
export const saveResults = new PrefixStore<SaveResult>(`${ID}/svr/`, "pf2.svr.local");
export const resultKey = (effectId: string, targetKey: string) => `${effectId}|${targetKey}`;

function useStore<T>(s: PrefixStore<T>): Record<string, T> {
  const [v, setV] = useState<Record<string, T>>(() => s.all());
  useEffect(() => {
    s.start();
    return s.subscribe(setV);
  }, [s]);
  return v;
}

export const useDamageReqs = () => useStore(damageReqs);
export const useSaveEffects = () => useStore(saveEffects);
export const useSaveResults = () => useStore(saveResults);

// Quita un efecto de salvación con todos sus resultados
export async function removeSaveEffect(id: string) {
  const res = Object.keys(saveResults.all()).filter((k) => k.startsWith(`${id}|`));
  await saveResults.remove(res);
  await saveEffects.remove([id]);
}
