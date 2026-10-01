import { PARSER_VERSION, parsePathbuilder, type Character, type Weapon } from "./pathbuilder";
import { DEFAULT_DICE_STYLE, type DiceStyle } from "./dice";
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
  agile?: boolean;
  finesse?: boolean;
  ranged?: boolean;
  range?: number;
  extras?: Record<string, boolean>;
}

export const extraKey = (e: { dice: number; sides: number; type: string }) => `${e.dice}d${e.sides} ${e.type}`;

export function applyWeaponFlags(w: Weapon, f: WeaponFlags | undefined): Weapon {
  const base = { ...w, finesse: !!w.finesse, ranged: !!w.ranged };
  if (!f) return base;
  return {
    ...base,
    agile: f.agile ?? base.agile,
    finesse: f.finesse ?? base.finesse,
    ranged: f.ranged ?? base.ranged,
    range: f.range ?? base.range,
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

export const store = {
  characters(): Character[] {
    const list = read<Character[]>("pf2.characters", []);
    const upgraded = list.map(upgrade);
    if (upgraded.some((c, i) => c !== list[i])) write("pf2.characters", upgraded);
    return upgraded;
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
  toasts: () => read<ToastItem[]>(TOAST_KEY, []),
  setToasts: (list: ToastItem[]) => write(TOAST_KEY, list),
};
