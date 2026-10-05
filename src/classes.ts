// Rasgos de clase automatizados. Se detectan por el nombre de las dotes y rasgos especiales
// de Pathbuilder (no por la clase), así también funcionan con dotes de arquetipo.
// Puro: sin Owlbear ni React.
import type { Character, Weapon } from "./pathbuilder";

// Estado de los rasgos de clase en la sala (dentro del PcState): lo ven el GM y el mapa
export interface ClassState {
  rage?: boolean;
  // Furia al empezar el combate: PG temporales que daría (el GM la activa sin la hoja)
  autoRage?: number;
  panache?: boolean;
  // Presa del explorador, enemigo provocado (guardián): id del token
  prey?: string;
  // Ventaja del cazador (el GM la necesita para Burlar: +1 CA contra la presa)
  edge?: HunterEdge;
  taunt?: string;
  // Divisar estratagema: d20 guardado y su objetivo
  strat?: { v: number; tok?: string };
  // Explotar vulnerabilidad
  exploit?: { tok: string; mode: "anti" | "mortal" | "other"; note?: string };
  // Sobrecarga: bono al daño, si es de fuego, y rondas sin poder repetirla
  od?: { b: number; fire?: boolean };
  odCd?: number;
  // Desatar psique: rondas que le quedan; ronda en que lanzó su último conjuro
  psyche?: number;
  castR?: number;
  stupR?: number;
  // Chispa divina inmanente en un ícono
  spark?: string;
  curse?: number;
  // Golpe de conjuro
  ss?: { used?: boolean; armed?: boolean; spell?: string; attack?: string };
  // Runas: grabadas (cuenta por índice) y trazadas (una entrada por copia, con su ronda)
  etched?: Record<string, number>;
  traced?: { k: string; r: number }[];
  aura?: boolean;
  thralls?: { tok: string; ch?: boolean }[];
  boost?: boolean;
  // Desprevenido por su propio fallo crítico (Explotar vulnerabilidad)
  ogSelf?: boolean;
}

export type HunterEdge = "flurry" | "precision" | "outwit" | "vindication";

export interface Features {
  rage: boolean;
  rageSpeed: boolean;
  esotericLore: boolean;
  empower: boolean;
  exploit: boolean;
  huntPrey: boolean;
  edge?: HunterEdge;
  slinger: boolean;
  slingerLegend: boolean;
  sneak: number;
  ruffian: boolean;
  precise: boolean;
  panache: boolean;
  vivacious: boolean;
  stratagem: boolean;
  taunt: boolean;
  overdrive: number;
  construct: boolean;
  eidolon?: string;
  anthem: boolean;
  thrall: boolean;
  puppeteer: boolean;
  psychic: boolean;
  unleash: boolean;
  font?: "heal" | "harm";
  versatileFont: boolean;
  potency: boolean;
  bloodMagic: boolean;
  spark: boolean;
  curse: boolean;
  spellstrike: boolean;
  tactics: number;
  runes: boolean;
  kinetic: boolean;
  gate?: "single" | "dual";
  elements: string[];
  kineticAura: boolean;
  alchemist: boolean;
  monk: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").trim();

function nameSet(c: Character): string[] {
  return [
    ...(c.feats ?? []).map((f) => f.name),
    ...(c.specials ?? []),
    ...c.casters.flatMap((k) => k.spells.flatMap((s) => s.names)),
  ].map(norm);
}

// Pasos de nivel: cuántos de estos niveles ya alcanzó
export const steps = (level: number, at: number[]) => at.filter((l) => level >= l).length;

export const ELEMENTS: { id: string; label: string; en: string }[] = [
  { id: "fire", label: "Fuego", en: "fire" },
  { id: "water", label: "Agua", en: "water" },
  { id: "earth", label: "Tierra", en: "earth" },
  { id: "air", label: "Aire", en: "air" },
  { id: "metal", label: "Metal", en: "metal" },
  { id: "wood", label: "Madera", en: "wood" },
];

export function featuresOf(c: Character): Features {
  const names = nameSet(c);
  const has = (...list: string[]) => list.some((n) => names.includes(norm(n)));
  const some = (re: RegExp) => names.some((n) => re.test(n));
  const cls = c.className.toLowerCase();
  const edge: HunterEdge | undefined = has("Flurry", "Hunter's Edge: Flurry")
    ? "flurry"
    : has("Precision", "Hunter's Edge: Precision")
      ? "precision"
      : has("Outwit", "Hunter's Edge: Outwit")
        ? "outwit"
        : has("Vindication", "Hunter's Edge: Vindication")
          ? "vindication"
          : undefined;
  const eidolonName = names.find((n) => /eidolon/.test(n) && !/boost|dedication|reinforce|share/.test(n));
  const elements = ELEMENTS.filter((e) => some(new RegExp(`\\b${e.en} gate|\\b${e.en} element|^${e.en}$`))).map((e) => e.id);
  return {
    rage: has("Rage"),
    rageSpeed: /barbarian/.test(cls) && c.level >= 3,
    esotericLore: has("Esoteric Lore"),
    empower: has("Implement's Empowerment"),
    exploit: has("Exploit Vulnerability"),
    huntPrey: has("Hunt Prey"),
    edge,
    slinger: has("Slinger's Precision") || /gunslinger/.test(cls),
    slingerLegend: has("Gunslinging Legend"),
    sneak: has("Sneak Attack") ? 1 + steps(c.level, [5, 11, 17]) : 0,
    ruffian: has("Ruffian", "Ruffian Racket"),
    precise: has("Precise Strike"),
    panache: has("Panache"),
    vivacious: has("Vivacious Speed") || (/swashbuckler/.test(cls) && c.level >= 3),
    stratagem: has("Devise a Stratagem", "Strategic Strike"),
    taunt: has("Taunt"),
    overdrive: has("Overdrive") ? 1 + (has("Expert Overdrive") ? 1 : 0) + (has("Master Overdrive") ? 1 : 0) + (has("Legendary Overdrive") ? 1 : 0) : 0,
    construct: has("Construct Innovation", "Construct"),
    eidolon: /summoner/.test(cls) || eidolonName ? (eidolonName ?? "eidolon") : undefined,
    anthem: has("Courageous Anthem"),
    thrall: has("Create Thrall"),
    puppeteer: has("Puppeteer"),
    psychic: /psychic/.test(cls),
    unleash: has("Unleash Psyche"),
    font: has("Harmful Font", "Harming Font", "Divine Font (Harm)") ? "harm" : has("Healing Font", "Divine Font (Heal)", "Divine Font") ? "heal" : undefined,
    versatileFont: has("Versatile Font"),
    potency: has("Sorcerous Potency") || /sorcerer/.test(cls),
    bloodMagic: has("Blood Magic") || /sorcerer/.test(cls),
    spark: has("Shift Immanence", "Spark of Transcendence", "Divine Spark and Ikons"),
    curse: has("Oracular Curse", "Cursebound"),
    spellstrike: has("Spellstrike"),
    tactics: has("Tactics", "Commander's Banner") || /commander/.test(cls)
      ? 3 + (has("Expert Tactician") ? 1 : 0) + (has("Master Tactician") ? 1 : 0) + (has("Legendary Tactician") ? 1 : 0)
      : 0,
    runes: has("Runic Repertoire", "Trace Rune", "Invoke Rune", "Rune Magic", "Etch Rune") || /runesmith/.test(cls),
    kinetic: has("Kinetic Gate", "Kineticist Dedication") || /kineticist/.test(cls),
    gate: has("Dual Gate", "Dual Kinetic Gate") || elements.length > 1 ? "dual" : has("Single Gate", "Single Kinetic Gate") || elements.length === 1 ? "single" : undefined,
    elements,
    kineticAura: has("Kinetic Aura") || /kineticist/.test(cls),
    alchemist: /alchemist/.test(cls),
    monk: /monk/.test(cls),
  };
}

// ---------- Números por nivel ----------

export const preciseStrike = (level: number) => {
  const k = steps(level, [5, 9, 13, 17]);
  return { flat: 2 + k, dice: 2 + k };
};
export const strategicStrikeDice = (level: number) => 1 + steps(level, [5, 9, 13, 17]);
export const rangerPrecisionDice = (level: number) => 1 + steps(level, [11, 19]);
export const antithesisBonus = (level: number) => 2 + Math.floor(level / 2);
export const fontSlots = (level: number) => (level >= 15 ? 6 : level >= 5 ? 5 : 4);
export const highestRank = (level: number) => Math.min(10, Math.max(1, Math.ceil(level / 2)));
export const runeSlots = (level: number) => 4 + 2 * steps(level, [5, 9, 13, 17]);
export const etchMax = (level: number) => 2 + steps(level, [5, 9, 13, 17]);

// Velocidad de Panache: +5 que sube 5 en 3, 7, 11, 15 y 19
export const panacheSpeed = (level: number) => 5 * (1 + steps(level, [3, 7, 11, 15, 19]));
// Sin Panache (desde nivel 3): la mitad, redondeada hacia abajo al múltiplo de 5
export const panacheSpeedIdle = (level: number) => (level >= 3 ? Math.floor(panacheSpeed(level) / 2 / 5) * 5 : 0);

// Sobrecarga: bono según grado e Inteligencia
export function overdriveBonus(degree: "crit-success" | "success" | "failure" | "crit-failure", int: number, tier: number) {
  const extra = tier >= 4 ? 3 : tier >= 3 ? 2 : tier >= 2 ? 1 : 0;
  if (degree === "crit-success") return { b: Math.max(0, int) + extra };
  if (degree === "success") return { b: Math.floor(Math.max(0, int) / 2) + extra };
  if (degree === "failure") return { b: 1, fire: true };
  return null;
}

// Pistola o ballesta del pistolero (se adivina por el nombre; el jugador lo puede cambiar)
export type SlingerKind = "crossbow" | "pistol" | "none";
export function guessSlinger(w: Weapon): SlingerKind {
  const n = (w.key || w.name).toLowerCase();
  if (!w.ranged) return "none";
  if (/crossbow/.test(n)) return "crossbow";
  if (/pistol|pepperbox|hand cannon/.test(n) && !/repeating|double/.test(n)) return "pistol";
  return "none";
}
export const slingerDamage = (kind: SlingerKind, legend: boolean): string | null =>
  kind === "crossbow" ? `${legend ? 3 : 2}` : kind === "pistol" ? `1d${legend ? 6 : 4}` : null;

// Daño extra de Furia: 2 (1 con armas ágiles) salvo que el jugador lo cambie según su instinto
export const rageDamage = (agile: boolean) => (agile ? 1 : 2);

export const HUNTER_EDGE_LABEL: Record<HunterEdge, string> = {
  flurry: "Ráfaga",
  precision: "Precisión",
  outwit: "Burlar",
  vindication: "Vindicación",
};

// Habilidades de Recordar conocimiento (Burlar da +2 circunstancial contra la presa)
export const OUTWIT_SKILLS = ["stealth", "deception", "religion", "occultism", "crafting", "arcana", "nature", "society", "medicine", "lore"];
