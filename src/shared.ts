import type { Character } from "./pathbuilder";
import type { Conditions, Degree, Iwr, ShieldState } from "./rules";
import type { Extras } from "./extras";
import type { AttackFx, MagicDesign, RollFx } from "./fx";

export const ID = "cl.nacho.pf2e-sheets";
export const META_TOKEN = `${ID}/token`;
export const META_PLAYER = `${ID}/player`;
export const CHANNEL_ROLL = `${ID}/roll`;
export const OVERLAY_PREFIX = `${ID}-overlay`;
export const TOAST_POPOVER = `${ID}/toasts`;
export const TOAST_KEY = "pf2.toasts";
// Efectos visuales sueltos (p. ej. ataques de PNJ con tirada secreta): todos los ven
export const CHANNEL_FX = `${ID}/fx`;

export type SaveKey = "fortitude" | "reflex" | "will";
export const SAVE_LABEL: Record<SaveKey, string> = { fortitude: "Fortaleza", reflex: "Reflejos", will: "Voluntad" };

export interface NpcAttack {
  id: string;
  n: string;
  atk: number;
  dmg: string;
  ty: string;
  melee: boolean;
  // Arma de Destreza (sutil o a distancia): la penaliza Torpe; las de Fuerza, Débil
  dex?: boolean;
  agile?: boolean;
  fx?: AttackFx | "none";
}

export type SpellKind = "atk" | "save" | "fx";

export interface NpcSpell {
  id: string;
  n: string;
  kind: SpellKind;
  save?: SaveKey;
  basic?: boolean;
  dmg?: string;
  ty?: string;
  heal?: boolean;
  rank?: number;
  desc?: string;
  fx?: MagicDesign;
}

export interface NpcSaves {
  fortitude: number;
  reflex: number;
  will: number;
}

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
  level?: number;
  // Número para distinguir criaturas iguales ("Goblin 2")
  num?: number;
  per?: number;
  saves?: NpcSaves;
  attacks?: NpcAttack[];
  spells?: NpcSpell[];
  spellAtk?: number;
  spellDc?: number;
  shield?: ShieldState;
  iwr?: Iwr;
  // Objetivo elegido (clave "pc:<id>" o "npc:<tokenId>") y color de su diana
  target?: string;
  color?: string;
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
  level: number;
  num?: number;
  per?: number;
  saves?: NpcSaves;
  attacks: NpcAttack[];
  spells: NpcSpell[];
  spellAtk?: number;
  spellDc?: number;
  shield?: ShieldState;
  iwr?: Iwr;
  target?: string;
  color?: string;
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
    level: d.level ?? 0,
    num: d.num,
    per: d.per,
    saves: d.saves,
    attacks: d.attacks ?? [],
    spells: d.spells ?? [],
    spellAtk: d.spellAtk,
    spellDc: d.spellDc,
    shield: d.shield,
    iwr: d.iwr,
    target: d.target,
    color: d.color,
  };
}

// Nombre con su número: "Goblin 2"
export const npcLabel = (n: { name: string; num?: number }) => (n.num ? `${n.name} ${n.num}` : n.name);

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
  // "note": aviso sin dado (conjuro lanzado, táctica, runa…)
  kind: "check" | "damage" | "free" | "flat" | "note";
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
  // Objetivo del ataque o del efecto
  targetName?: string;
  // Etiqueta corta en la tarjeta ("Conjuro", "Salvación"…)
  tag?: string;
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
