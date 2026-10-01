import type { Character } from "./pathbuilder";
import type { Conditions, Degree } from "./rules";
import type { Extras } from "./extras";
import type { RollFx } from "./fx";

export const ID = "cl.nacho.pf2e-sheets";
export const META_TOKEN = `${ID}/token`;
export const META_PLAYER = `${ID}/player`;
export const CHANNEL_ROLL = `${ID}/roll`;
export const OVERLAY_PREFIX = `${ID}-overlay`;
export const TOAST_POPOVER = `${ID}/toasts`;
export const TOAST_KEY = "pf2.toasts";

// Metadata del token. Para un PJ es solo el vínculo con su hoja (el estado vive en la sala);
// para un PNJ guarda su estado completo, porque los PNJ son de cada escena.
export interface TokenData {
  kind: "pc" | "npc";
  name: string;
  // PJ
  characterId?: string;
  ownerId?: string;
  // PNJ
  hp?: number;
  maxHp?: number;
  temp?: number;
  baseAc?: number;
  acAdj?: number;
  cond?: Conditions;
  // Oculta las estadísticas del PNJ a los jugadores
  hidden?: boolean;
  // Versiones anteriores guardaban la CA final aquí
  ac?: number;
  updatedAt?: number;
}

export interface NpcState {
  name: string;
  hp: number;
  maxHp: number;
  temp: number;
  baseAc: number;
  acAdj: number;
  cond: Conditions;
  hidden: boolean;
}

export function npcState(d: TokenData): NpcState {
  const baseAc = d.baseAc ?? d.ac ?? 10;
  return {
    name: d.name,
    hp: d.hp ?? 0,
    maxHp: d.maxHp ?? 1,
    temp: d.temp ?? 0,
    baseAc,
    acAdj: d.acAdj ?? (d.ac !== undefined && d.baseAc !== undefined ? d.ac - d.baseAc : 0),
    cond: d.cond ?? {},
    hidden: !!d.hidden,
  };
}

export interface VitalState {
  hp: number;
  temp: number;
  ac: number;
  updatedAt: number;
}

// Lo que cada jugador publica en su metadata para que el GM pueda abrir su hoja.
export interface PlayerMeta {
  character: Character;
  // Anotaciones de las pestañas laterales (inventario, recetas, notas…)
  extras?: Extras;
}

export interface RollEntry {
  id: string;
  time: number;
  playerId: string;
  playerName: string;
  playerColor: string;
  charName?: string;
  label: string;
  formula: string;
  detail: string;
  total: number;
  kind: "check" | "damage" | "free" | "flat";
  nat?: 1 | 20;
  crit?: boolean;
  secret?: boolean;
  // Condiciones que modificaron la tirada, p. ej. "Asustado −2"
  notes?: string;
  // Tiradas planas: CD y resultado
  dc?: number;
  degree?: Degree;
  // Color de los dados de quien tiró (se ve en la tarjeta)
  diceColor?: string;
  // Personaje (o mascota) que tiró y efecto a mostrar sobre su token
  charId?: string;
  fx?: RollFx;
}

// Tarjeta de tirada en la esquina inferior derecha
export interface ToastItem {
  entry: RollEntry;
  until: number;
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function applyHpDelta(v: { hp: number; temp: number; maxHp: number }, delta: number) {
  // El daño consume primero los PG temporales
  let { hp, temp } = v;
  if (delta < 0) {
    const dmg = -delta;
    const fromTemp = Math.min(temp, dmg);
    temp -= fromTemp;
    hp -= dmg - fromTemp;
  } else {
    hp += delta;
  }
  return { hp: clamp(hp, 0, v.maxHp), temp: Math.max(0, temp) };
}

export function hpColor(hp: number, max: number) {
  const r = max > 0 ? hp / max : 0;
  if (r > 0.5) return "#3fae5a";
  if (r > 0.25) return "#e0a526";
  return "#d6453d";
}

// Decide qué ve cada cliente de una tirada recibida. Las secretas solo las ve el GM;
// quien la lanzó ve que se envió, pero no el resultado.
export function visibleEntry(e: RollEntry, meId: string, role: "GM" | "PLAYER"): RollEntry | null {
  if (!e.secret || role === "GM") return e;
  if (e.playerId === meId) return { ...e, total: NaN, detail: "", nat: undefined };
  return null;
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Los colores de jugador muy oscuros (p. ej. negro) no se leen sobre el fondo de la hoja:
// se aclaran mezclándolos con blanco.
export function readableColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  if (lum >= 0.4) return hex;
  const mix = rgb.map((c) => Math.round(c + (255 - c) * 0.55));
  return `rgb(${mix.join(", ")})`;
}
