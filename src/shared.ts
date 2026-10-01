import type { Character } from "./pathbuilder";

export const ID = "cl.nacho.pf2e-sheets";
export const META_TOKEN = `${ID}/token`;
export const META_PLAYER = `${ID}/player`;
export const CHANNEL_ROLL = `${ID}/roll`;
export const OVERLAY_PREFIX = `${ID}-overlay`;
export const TOAST_POPOVER = `${ID}/toasts`;
export const TOAST_KEY = "pf2.toasts";

// Vive en la metadata del token: es la fuente de verdad de HP/CA cuando hay token vinculado.
export interface TokenData {
  kind: "pc" | "npc";
  characterId?: string;
  ownerId?: string;
  name: string;
  hp: number;
  maxHp: number;
  temp: number;
  ac: number;
  baseAc: number;
  // Solo NPC: oculta las estadísticas a los jugadores
  hidden?: boolean;
  updatedAt: number;
}

export interface VitalState {
  hp: number;
  temp: number;
  ac: number;
  updatedAt: number;
}

// Lo que cada jugador publica en su metadata para que el GM vea al grupo.
export interface PlayerMeta {
  character: Character;
  vitals: VitalState;
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
  kind: "check" | "damage" | "free";
  nat?: 1 | 20;
  crit?: boolean;
  secret?: boolean;
  // Color de los dados de quien tiró (se ve en la tarjeta)
  diceColor?: string;
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
