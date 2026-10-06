import { PARSER_VERSION, parsePathbuilder, type Character, type Weapon } from "./pathbuilder";
import { DEFAULT_DICE_STYLE, type DiceStyle } from "./dice";
import type { AttackFx } from "./fx";
import type { SlingerKind } from "./classes";
import type { PersistentSpec } from "./shared";
import { TOAST_KEY, type RollEntry, type ToastItem, type VitalState } from "./shared";

// Todas las páginas de la extensión comparten origen, así que comparten localStorage.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // almacenamiento bloqueado o lleno: la extensión sigue funcionando en memoria
  }
}

export const LOG_LIMIT = 60;

// Ajustes manuales de un arma (sobreviven a reimportar la hoja)
export interface WeaponFlags {
  // Nombre elegido por el jugador
  name?: string;
  agile?: boolean;
  finesse?: boolean;
  ranged?: boolean;
  thrown?: boolean;
  pers?: PersistentSpec;
  range?: number;
  extras?: Record<string, boolean>;
  // Efecto visual del ataque ("none" = sin efecto)
  fx?: AttackFx | "none";
  // Pistolero: ballesta o pistola de un tiro
  sling?: SlingerKind;
  // Daño y tipo escritos a mano (bomba del alquimista)
  dmg?: string;
  dmgType?: string;
}

export const extraKey = (e: { dice: number; sides: number; type: string }) => `${e.dice}d${e.sides} ${e.type}`;

export function applyWeaponFlags(w: Weapon, f: WeaponFlags | undefined): Weapon {
  const base = { ...w, finesse: !!w.finesse, ranged: !!w.ranged };
  if (!f) return base;
  return {
    ...base,
    name: f.name || base.name,
    thrown: f.thrown ?? base.thrown,
    pers: f.pers ?? base.pers,
    agile: f.agile ?? base.agile,
    finesse: f.finesse ?? base.finesse,
    ranged: f.ranged ?? base.ranged,
    range: f.range ?? base.range,
    dmgFormula: f.dmg ?? base.dmgFormula,
    damageType: f.dmgType ?? base.damageType,
    extra: base.extra.map((e) => ({ ...e, active: f.extras?.[extraKey(e)] ?? e.active })),
  };
}

// Relee con el lector actual las hojas guardadas con una versión anterior
function upgrade(c: Character): Character {
  if ((c.parserVersion ?? 1) >= PARSER_VERSION) return c;
  const raw = read<unknown>(`pf2.raw.${c.id}`, null);
  if (!raw) return c;
  try {
    return parsePathbuilder(raw);
  } catch {
    return c;
  }
}

// Nombre elegido por el jugador para su personaje (sobrevive a reimportar la hoja)
const nicks = () => read<Record<string, string>>("pf2.nicks", {});
const withNick = (c: Character, all: Record<string, string>): Character => (all[c.id] ? { ...c, name: all[c.id] } : c);

export const store = {
  characters(): Character[] {
    const list = read<Character[]>("pf2.characters", []);
    const upgraded = list.map(upgrade);
    if (upgraded.some((c, i) => c !== list[i])) write("pf2.characters", upgraded);
    const all = nicks();
    return upgraded.map((c) => withNick(c, all));
  },
  setNick(id: string, name: string | undefined) {
    const all = nicks();
    if (name) all[id] = name;
    else delete all[id];
    write("pf2.nicks", all);
  },
  saveCharacter(c: Character, raw?: unknown) {
    const list = read<Character[]>("pf2.characters", []).filter((x) => x.id !== c.id);
    write("pf2.characters", [c, ...list]);
    if (raw) write(`pf2.raw.${c.id}`, raw);
  },
  removeCharacter(id: string) {
    write("pf2.characters", read<Character[]>("pf2.characters", []).filter((x) => x.id !== id));
    try {
      localStorage.removeItem(`pf2.raw.${id}`);
    } catch {
      // nada que limpiar
    }
  },
  activeId: (roomId: string) => read<string | null>(`pf2.active.${roomId}`, null),
  setActiveId: (roomId: string, id: string | null) => write(`pf2.active.${roomId}`, id),
  activeCharacter(roomId: string): Character | undefined {
    const id = store.activeId(roomId);
    return store.characters().find((c) => c.id === id);
  },
  // PG guardados por versiones anteriores: se usan una vez para sembrar el estado de la sala
  legacyVitals: (id: string) => read<VitalState | null>(`pf2.vitals.${id}`, null),
  weaponFlags: (charId: string) => read<Record<string, WeaponFlags>>(`pf2.wflags.${charId}`, {}),
  setWeaponFlags: (charId: string, flags: Record<string, WeaponFlags>) => write(`pf2.wflags.${charId}`, flags),
  // Hojas de otros jugadores que el GM ya vio: siguen disponibles aunque se desconecten
  gmSheets: () => read<Record<string, Character>>("pf2.gmSheets", {}),
  cacheGmSheet(c: Character) {
    const all = store.gmSheets();
    const prev = all[c.id];
    if (prev && prev.importedAt === c.importedAt && prev.parserVersion === c.parserVersion) return;
    write("pf2.gmSheets", { ...all, [c.id]: c });
  },
  log: (roomId: string) => read<RollEntry[]>(`pf2.log.${roomId}`, []),
  pushLog(roomId: string, e: RollEntry) {
    const list = store.log(roomId).filter((x) => x.id !== e.id);
    write(`pf2.log.${roomId}`, [e, ...list].slice(0, LOG_LIMIT));
  },
  clearLog: (roomId: string) => write(`pf2.log.${roomId}`, []),
  diceStyle: () => ({ ...DEFAULT_DICE_STYLE, ...read<Partial<DiceStyle>>("pf2.dice", {}) }),
  setDiceStyle: (s: DiceStyle) => write("pf2.dice", s),
  // Habilidad elegida para la iniciativa y si gana los empates
  initPref: (charId: string) => read<{ skill: string; winsTies: boolean }>(`pf2.init.${charId}`, { skill: "perception", winsTies: false }),
  setInitPref: (charId: string, p: { skill: string; winsTies: boolean }) => write(`pf2.init.${charId}`, p),
  // Última selección del mapa: abrir la extensión la borra, así el GM puede agregar
  // a la iniciativa los tokens que acababa de seleccionar
  lastSelection: () => read<{ ids: string[]; t: number } | null>("pf2.lastSel", null),
  setLastSelection: (ids: string[]) => write("pf2.lastSel", { ids, t: Date.now() }),
  // Dirección de los efectos de ataque y si están activos, por personaje
  fxPref: (charId: string) => read<{ dir: number; on: boolean }>(`pf2.fx.${charId}`, { dir: 2, on: true }),
  setFxPref: (charId: string, p: { dir: number; on: boolean }) => write(`pf2.fx.${charId}`, p),
  toasts: () => read<ToastItem[]>(TOAST_KEY, []),
  setToasts: (list: ToastItem[]) => write(TOAST_KEY, list),
};
