// Lo que el jugador anota en las pestañas laterales: cantidades, investidos, dinero, recetas,
// nombres editados, notas de dotes y modificadores de la mascota. Vive en el navegador del
// dueño de la hoja y se publica junto a la hoja (metadata del jugador) para que el GM lo vea.
// Los recursos que el GM también edita (foco, espacios, alquimia) van en el estado de la sala.
import { useEffect, useState } from "react";

export interface PetAttack {
  name: string;
  attack: number;
  damage: string;
  agile?: boolean;
}

export interface PetStats {
  // Modificadores por clave: perception, fortitude, reflex, will, acrobatics, athletics, stealth…
  mods?: Record<string, number>;
  attacks?: PetAttack[];
}

export interface AddedEntry {
  key: string;
  list: "inv" | "recipe";
  name: string;
  container?: string;
}

export interface Extras {
  // Nombres editados por clave de la lista
  names?: Record<string, string>;
  // Cantidades del inventario y de las recetas
  qty?: Record<string, number>;
  invested?: Record<string, boolean>;
  added?: AddedEntry[];
  money?: { cp: number; sp: number; gp: number; pp: number };
  notes?: Record<string, string>;
  pets?: Record<number, PetStats>;
}

type Listener = () => void;
const listeners = new Set<Listener>();
const keyOf = (charId: string) => `pf2.extras.${charId}`;

export const extrasStore = {
  get(charId: string): Extras {
    try {
      return JSON.parse(localStorage.getItem(keyOf(charId)) ?? "{}") as Extras;
    } catch {
      return {};
    }
  },
  update(charId: string, fn: (e: Extras) => Extras) {
    try {
      localStorage.setItem(keyOf(charId), JSON.stringify(fn(extrasStore.get(charId))));
    } catch {
      // almacenamiento lleno o bloqueado
    }
    for (const l of listeners) l();
  },
  subscribe(l: Listener) {
    listeners.add(l);
    const onStorage = (e: StorageEvent) => e.key?.startsWith("pf2.extras.") && l();
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(l);
      window.removeEventListener("storage", onStorage);
    };
  },
};

// Contador que cambia cada vez que se guarda algo: sirve para volver a leer y republicar
export function useExtrasVersion() {
  const [v, setV] = useState(0);
  useEffect(() => extrasStore.subscribe(() => setV((n) => n + 1)), []);
  return v;
}

// Claves estables para cada fila de las listas (sobreviven a reimportar la hoja)
export function itemKeys(items: { name: string; container?: string }[]): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const base = `inv:${it.container ?? ""}:${it.name}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  });
}
