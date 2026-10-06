// Lo que el jugador anota en las pestañas laterales: cantidades, investidos, dinero, recetas,
// nombres editados, notas de dotes y modificadores de la mascota. Vive en el navegador del
// dueño de la hoja y se publica junto a la hoja (metadata del jugador) para que el GM lo vea.
// Los recursos que el GM también edita (foco, espacios, alquimia) van en el estado de la sala.
import { useEffect, useState } from "react";
import type { BonusType } from "./rules";
import type { SaveKey, SpellKind } from "./shared";
import type { MagicDesign } from "./fx";
import type { HunterEdge, ImplementKind } from "./classes";

// Implemento del taumaturgo: nombre, cómo se usa y notas de su efecto
export interface Implement {
  n: string;
  kind: ImplementKind;
  note?: string;
}

export interface PetAttack {
  name: string;
  attack: number;
  damage: string;
  agile?: boolean;
}

export interface FamiliarAbility {
  n: string;
  note?: string;
}

export interface PetStats {
  // Modificadores por clave: perception, fortitude, reflex, will, acrobatics, athletics, stealth…
  mods?: Record<string, number>;
  attacks?: PetAttack[];
  notes?: string;
  // Beneficio de apoyo (compañero animal) o habilidad especial (eidolón, constructo)
  support?: string;
  special?: string;
  // Familiar: habilidades del día (ranuras editables) y Resistente (+2 PG por nivel)
  abilities?: FamiliarAbility[];
  tough?: boolean;
}

// Bono o penalizador del jugador a sus ataques o daño (varios, cada uno con su tipo).
// Al daño también puede ser de dados ("1d4") con su tipo de daño, o daño persistente.
export interface CustomMod {
  id: string;
  label: string;
  value: number;
  type: BonusType;
  to: "atk" | "dmg";
  on: boolean;
  dice?: string;
  // Tipo de daño (fuego, sangrado…)
  dt?: string;
  // Es daño persistente: se agrega al objetivo en vez de sumarse a la tirada
  pers?: boolean;
  // Solo con crítico (p. ej. runa flamígera)
  critOnly?: boolean;
}

// Ataque que el jugador agrega a mano (un arma encontrada en la partida)
export interface CustomWeapon {
  id: string;
  name: string;
  attack: number;
  dmg: string;
  ty: string;
  ranged?: boolean;
  agile?: boolean;
  finesse?: boolean;
}

// Configuración de un conjuro (por nombre): sirve en todos los espacios donde aparezca
export interface SpellMeta {
  desc?: string;
  kind?: SpellKind;
  save?: SaveKey;
  basic?: boolean;
  dmg?: string;
  ty?: string;
  heal?: boolean;
  // Activa la Magia de sangre del hechicero
  blood?: boolean;
  fx?: MagicDesign;
  // Impulsos del kineticista
  el?: string;
  overflow?: boolean;
  junction?: boolean;
}

export interface Rune {
  n: string;
  note?: string;
}

// Preferencias de los rasgos de clase que solo anota el dueño
export interface ClassPrefs {
  edge?: HunterEdge;
  rageDmg?: string;
  rageType?: string;
  autoRage?: boolean;
  // Golpe de conjuro: una sola tirada con el ataque del arma
  ssSingle?: boolean;
  runes?: Rune[];
  tactics?: string[];
  ikons?: string[];
  impulses?: string[];
  empower?: boolean;
  sneakManual?: boolean;
  fontChoice?: ("heal" | "harm")[];
  // Color de cada efecto de clase
  colors?: Record<string, string>;
  // Efecto al crear siervos (nigromante)
  thrallFx?: "void" | "spirit";
  // Elemento del aura cinética (si no se detecta de las dotes)
  element?: string;
  implements?: Implement[];
}

// Conjuro agregado a mano (innato de un objeto, de una dote…): rango, usos por día y de qué
// lanzador toma el ataque y la CD ("" = el principal; sin lanzadores, la CD de clase)
export interface ExtraSpell {
  id: string;
  n: string;
  rank: number;
  // 0 = a voluntad
  uses: number;
  caster?: string;
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
  // Objetos de la hoja que ya no están (pergaminos usados): no se muestran
  gone?: Record<string, boolean>;
  // Rango de cada pergamino, por clave del inventario
  srank?: Record<string, number>;
  xspells?: ExtraSpell[];
  money?: { cp: number; sp: number; gp: number; pp: number };
  notes?: Record<string, string>;
  pets?: Record<number, PetStats>;
  mods?: CustomMod[];
  weapons?: CustomWeapon[];
  spells?: Record<string, SpellMeta>;
  // Filas de conjuro agregadas a mano, por grupo ("rep:<lanzador>:<rango>", "impulse"…)
  addedSpells?: Record<string, string[]>;
  // Conjuros distintivos, por lanzador
  signature?: Record<string, string[]>;
  cls?: ClassPrefs;
  // Diseño y color de los efectos de magia
  magicFx?: { design?: MagicDesign; color?: string };
}

export const spellKey = (name: string) => name.trim().toLowerCase();

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
