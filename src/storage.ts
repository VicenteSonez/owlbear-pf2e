import type { Character } from "./pathbuilder";
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

export const store = {
  characters: () => read<Character[]>("pf2.characters", []),
  saveCharacter(c: Character) {
    const list = store.characters().filter((x) => x.id !== c.id);
    write("pf2.characters", [c, ...list]);
  },
  removeCharacter(id: string) {
    write("pf2.characters", store.characters().filter((x) => x.id !== id));
  },
  activeId: (roomId: string) => read<string | null>(`pf2.active.${roomId}`, null),
  setActiveId: (roomId: string, id: string | null) => write(`pf2.active.${roomId}`, id),
  activeCharacter(roomId: string): Character | undefined {
    const id = store.activeId(roomId);
    return store.characters().find((c) => c.id === id);
  },
  vitals: (c: Character): VitalState =>
    read<VitalState>(`pf2.vitals.${c.id}`, { hp: c.maxHp, temp: 0, ac: c.ac, updatedAt: 0 }),
  setVitals: (id: string, v: VitalState) => write(`pf2.vitals.${id}`, v),
  log: (roomId: string) => read<RollEntry[]>(`pf2.log.${roomId}`, []),
  pushLog(roomId: string, e: RollEntry) {
    const list = store.log(roomId).filter((x) => x.id !== e.id);
    write(`pf2.log.${roomId}`, [e, ...list].slice(0, LOG_LIMIT));
  },
  clearLog: (roomId: string) => write(`pf2.log.${roomId}`, []),
  diceStyle: () => ({ ...DEFAULT_DICE_STYLE, ...read<Partial<DiceStyle>>("pf2.dice", {}) }),
  setDiceStyle: (s: DiceStyle) => write("pf2.dice", s),
  toasts: () => read<ToastItem[]>(TOAST_KEY, []),
  setToasts: (list: ToastItem[]) => write(TOAST_KEY, list),
};
