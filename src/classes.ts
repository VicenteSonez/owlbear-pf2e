// Rasgos de clase automatizados. Se detectan por el nombre de las dotes y rasgos especiales
// de Pathbuilder (no por la clase), así también funcionan con dotes de arquetipo.
// Puro: sin Owlbear ni React.
import type { Character, Weapon } from "./pathbuilder";
import type { IwrEntry, Mod, RollCtx } from "./rules";

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
  // Chispa divina inmanente en un ícono, opción elegida para su inmanencia (tipo de
  // resistencia, habilidades del cinturón…), aliados que comparten su efecto y usos del Cuerno
  spark?: string;
  sparkOpt?: string;
  share?: string[];
  horn?: number;
  curse?: number;
  // Golpe de conjuro
  ss?: { used?: boolean; armed?: boolean; spell?: string; attack?: string };
  // Runas: grabadas (cuenta por índice) y trazadas (una entrada por copia, con su ronda)
  etched?: Record<string, number>;
  traced?: { k: string; r: number }[];
  aura?: boolean;
  thralls?: { tok: string; ch?: boolean }[];
  // Implementos del taumaturgo que tiene activos (en la mano)
  impl?: string[];
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
  thaumaturge: boolean;
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
    thaumaturge: /thaumaturge/.test(cls) || has("First Implement and Esoterica", "Implement's Empowerment", "Thaumaturge Dedication"),
  };
}

// Dotes que cambian el moribundo: Duro de matar (Diehard) y Dureza (Toughness)
export function sheetPerks(c: Character): string[] {
  const names = nameSet(c);
  return [names.includes("diehard") ? "diehard" : "", names.includes("toughness") ? "toughness" : ""].filter(Boolean);
}

// Límite técnico de siervos activos del nigromante (las reglas no ponen máximo)
export const THRALL_LIMIT = 20;

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

// Implementos del taumaturgo y cómo se usa su efecto principal (el jugador lo puede cambiar)
export type ImplementKind = "a1" | "a2" | "a3" | "reaction" | "free" | "passive";
export const IMPLEMENT_KIND_LABEL: Record<ImplementKind, string> = {
  a1: "Acción (1)",
  a2: "Actividad (2)",
  a3: "Actividad (3)",
  reaction: "Reacción",
  free: "Acción gratuita",
  passive: "Pasiva",
};
export const IMPLEMENTS: { n: string; es: string; kind: ImplementKind; desc: string }[] = [
  { n: "Amulet", es: "Amuleto", kind: "reaction", desc: "Amulet's Abeyance: resistencia contra el daño de un enemigo a un aliado." },
  { n: "Bell", es: "Campana", kind: "reaction", desc: "Ring Bell: el enemigo hace una salvación o sufre un efecto." },
  { n: "Censer", es: "Incensario", kind: "a1", desc: "Activa el incensario: su humo afecta a quienes lo rodean." },
  { n: "Chalice", es: "Cáliz", kind: "a1", desc: "Drink from the Chalice: PG temporales o curación." },
  { n: "Lantern", es: "Linterna", kind: "passive", desc: "Revela lo oculto y da bonos a Buscar." },
  { n: "Mirror", es: "Espejo", kind: "a1", desc: "Mirror's Reflection: crea un reflejo en otra casilla." },
  { n: "Regalia", es: "Regalia", kind: "passive", desc: "Aura: bono a Diplomacia, Intimidación y contra el miedo de los aliados." },
  { n: "Shield", es: "Escudo", kind: "passive", desc: "Escudo implemento: efecto pasivo mientras lo empuñas." },
  { n: "Tome", es: "Tomo", kind: "passive", desc: "Recordar conocimiento mejorado y entrenamiento en habilidades." },
  { n: "Wand", es: "Varita", kind: "a2", desc: "Fling Magic: daño a distancia con salvación." },
  { n: "Weapon", es: "Arma", kind: "reaction", desc: "Implement's Interruption: Golpe de reacción." },
];

export const findImplement = (name: string) => {
  const n = norm(name);
  return IMPLEMENTS.find((x) => norm(x.n) === n || norm(x.es) === n);
};

// ---------- Íconos del ejemplar ----------

// Dónde va el ícono: objeto que se lleva, arma (cuerpo a cuerpo, a distancia o ambas) o escudo
export type IkonSlot = "worn" | "melee" | "ranged" | "melee-thrown" | "shield";

// Daño extra por dado de daño del arma mientras la chispa está inmanente en un ícono de arma
export interface IkonDamage {
  per: number;
  splash?: boolean;
  pers?: boolean;
  // Por dado contra un objetivo bajo la mitad de sus PG o desprevenido
  vsHalf?: number;
  vsOffGuard?: number;
  // Con crítico se cambia por este dado por dado de daño (no se multiplica)
  critDie?: number;
}

export interface IkonDef {
  id: string;
  n: string;
  slot: IkonSlot;
  desc: string;
  dmg?: IkonDamage;
  // Opciones a elegir (tipo de resistencia, habilidades)
  opts?: { id: string; label: string }[];
  multi?: boolean;
  // Se activa con un botón (no es pasivo)
  active?: boolean;
  // Se comparte con aliados elegidos
  share?: boolean;
}

export const IKON_SLOT_LABEL: Record<IkonSlot, string> = {
  worn: "Objeto",
  melee: "Arma cuerpo a cuerpo",
  ranged: "Arma a distancia",
  "melee-thrown": "Arma cuerpo a cuerpo o arrojadiza",
  shield: "Escudo",
};

export const IKONS: IkonDef[] = [
  { id: "bands", n: "Bands of Imprisonment", slot: "worn", desc: "+1 de estado a Voluntad y resistencia mental igual a la mitad de tu nivel." },
  { id: "barrow", n: "Barrow's Edge", slot: "melee", desc: "+1 de espíritu por dado del arma; +3 por dado si el objetivo está bajo la mitad de sus PG.", dmg: { per: 1, vsHalf: 3 } },
  { id: "bangles", n: "Fetching Bangles", slot: "worn", desc: "Elige un enemigo: salvación de Voluntad contra tu CD de clase.", active: true },
  { id: "eyecatch", n: "Eye-Catching Spot", slot: "worn", desc: "Los enemigos tienen −1 circunstancial a sus ataques cuerpo a cuerpo contra ti." },
  { id: "gaze", n: "Gaze Sharp as Steel", slot: "worn", desc: "+1 de estado a Percepción y +2 de estado a la CA contra ataques a distancia." },
  { id: "gleaming", n: "Gleaming Blade", slot: "melee", desc: "+2 de espíritu por dado del arma.", dmg: { per: 2 } },
  { id: "wildling", n: "Hands of the Wildling", slot: "melee", desc: "+1 de salpicadura de espíritu por dado del arma.", dmg: { per: 1, splash: true } },
  { id: "horn", n: "Horn of Plenty", slot: "worn", desc: "Crea un consumible al día (2 a nivel 8, 3 a nivel 16): un elixir de vida o uno a elección.", active: true },
  { id: "aegis", n: "Mirrored Aegis", slot: "shield", desc: "+1 de estado a la CA, para ti y los aliados que elijas.", share: true },
  { id: "harvest", n: "Mortal Harvest", slot: "melee", desc: "+1 de espíritu persistente por dado del arma.", dmg: { per: 1, pers: true } },
  { id: "branch", n: "Noble Branch", slot: "melee", desc: "+2 de espíritu por dado del arma.", dmg: { per: 2 } },
  {
    id: "pelt",
    n: "Pelt of the Beast",
    slot: "worn",
    desc: "Resistencia igual a la mitad de tu nivel a un tipo: frío, electricidad, fuego, veneno o sonido.",
    opts: [
      { id: "frío", label: "Frío" },
      { id: "electricidad", label: "Electricidad" },
      { id: "fuego", label: "Fuego" },
      { id: "veneno", label: "Veneno" },
      { id: "sonido", label: "Sonido" },
    ],
  },
  { id: "scar", n: "Scar of the Survivor", slot: "worn", desc: "+1 de estado a Fortaleza y el efecto de Duro de matar (mueres con moribundo 5)." },
  { id: "sheath", n: "Shadow Sheath", slot: "melee-thrown", desc: "+2 de espíritu por dado del arma (+3 contra desprevenidos). El arma arrojadiza no se gasta.", dmg: { per: 2, vsOffGuard: 3 } },
  {
    id: "skin",
    n: "Skin Hard as Horn",
    slot: "worn",
    desc: "Resistencia igual a la mitad de tu nivel a cortante, contundente o perforante (no contra críticos).",
    opts: [
      { id: "cortante", label: "Cortante" },
      { id: "contundente", label: "Contundente" },
      { id: "perforante", label: "Perforante" },
    ],
  },
  {
    id: "belt",
    n: "Skybearer's Belt",
    slot: "worn",
    desc: "+1 circunstancial (al activarlo) a Atletismo, Reflejos o Fortaleza.",
    multi: true,
    opts: [
      { id: "athletics", label: "Atletismo" },
      { id: "reflex", label: "Reflejos" },
      { id: "fortitude", label: "Fortaleza" },
    ],
  },
  { id: "starshot", n: "Starshot", slot: "ranged", desc: "+1 de salpicadura de espíritu por dado del arma.", dmg: { per: 1, splash: true } },
  { id: "sandals", n: "Thousand-League Sandals", slot: "worn", desc: "+10 ft de estado a la Velocidad." },
  { id: "titan", n: "Titan's Breaker", slot: "melee", desc: "+2 de espíritu por dado del arma.", dmg: { per: 2 } },
  { id: "bow", n: "Unfailing Bow", slot: "ranged", desc: "+1 de espíritu por dado del arma; con crítico, 1d4 por dado (no se multiplica).", dmg: { per: 1, critDie: 4 } },
  { id: "wreath", n: "Victor's Wreath", slot: "worn", desc: "+1 de estado a los ataques, para ti y los aliados que elijas.", share: true },
];

export const findIkon = (name: string | undefined) => {
  if (!name) return undefined;
  const n = norm(name).replace(/[^a-z0-9]/g, "");
  return IKONS.find((k) => norm(k.n).replace(/[^a-z0-9]/g, "") === n);
};

// Ícono con la chispa inmanente (si está en el catálogo)
export const immanentIkon = (s: { cls?: ClassState } | undefined) => findIkon(s?.cls?.spark);

const halfLevel = (level: number) => Math.floor(level / 2);

// Bonos de la inmanencia a pruebas y salvaciones (los que se comparten van como bonos temporales)
export function ikonCheckMods(s: { cls?: ClassState } | undefined, ctx: RollCtx): Mod[] {
  const ik = immanentIkon(s);
  if (!ik) return [];
  const opt = (s?.cls?.sparkOpt ?? "").split(",");
  const out: Mod[] = [];
  if (ik.id === "bands" && ctx.kind === "save" && ctx.key === "will") out.push({ label: ik.n, type: "status", value: 1 });
  if (ik.id === "scar" && ctx.kind === "save" && ctx.key === "fortitude") out.push({ label: ik.n, type: "status", value: 1 });
  if (ik.id === "gaze" && ctx.kind === "perception") out.push({ label: ik.n, type: "status", value: 1 });
  if (ik.id === "belt") {
    const key = ctx.kind === "save" ? ctx.key : ctx.kind === "skill" ? ctx.key : "";
    if (key && opt.includes(key)) out.push({ label: ik.n, type: "circumstance", value: 1 });
  }
  return out;
}

// Resistencias de la inmanencia
export function ikonIwr(s: { cls?: ClassState; level: number } | undefined): IwrEntry[] {
  const ik = immanentIkon(s);
  if (!ik || !s) return [];
  const v = halfLevel(s.level);
  if (v <= 0) return [];
  if (ik.id === "bands") return [{ t: "mental", v, n: ik.n }];
  const t = s.cls?.sparkOpt;
  if (ik.id === "pelt" && t) return [{ t, v, n: ik.n }];
  if (ik.id === "skin" && t) return [{ t, v, n: ik.n, nc: true }];
  return [];
}

// Ajustes de un ataque de PNJ contra un PJ con su chispa inmanente
export function ikonVsAttack(s: { cls?: ClassState } | undefined, melee: boolean): { atk: Mod[]; ac: number; notes: string } {
  const ik = immanentIkon(s);
  if (ik?.id === "eyecatch" && melee) return { atk: [{ label: ik.n, type: "circumstance", value: -1 }], ac: 0, notes: "" };
  if (ik?.id === "gaze" && !melee) return { atk: [], ac: 2, notes: `${ik.n}: +2 CA contra ataques a distancia` };
  return { atk: [], ac: 0, notes: "" };
}

export const ikonSpeed = (s: { cls?: ClassState } | undefined) => (immanentIkon(s)?.id === "sandals" ? 10 : 0);

// Cuerno de la abundancia: consumibles por día y el elixir de vida según el nivel
export const hornMax = (level: number) => 1 + steps(level, [8, 16]);
export function elixirOfLife(level: number): { n: string; f: string } {
  const table: [number, string, string][] = [
    [19, "Elixir de vida verdadero", "10d6+27"],
    [15, "Elixir de vida superior", "8d6+21"],
    [13, "Elixir de vida mayor", "7d6+18"],
    [9, "Elixir de vida moderado", "5d6+12"],
    [5, "Elixir de vida menor", "3d6+6"],
    [1, "Elixir de vida mínimo", "1d6"],
  ];
  const row = table.find(([l]) => level >= l) ?? table[table.length - 1];
  return { n: row[1], f: row[2] };
}

export const HUNTER_EDGE_LABEL: Record<HunterEdge, string> = {
  flurry: "Ráfaga",
  precision: "Precisión",
  outwit: "Burlar",
  vindication: "Vindicación",
};

// Habilidades de Recordar conocimiento (Burlar da +2 circunstancial contra la presa)
export const OUTWIT_SKILLS = ["stealth", "deception", "religion", "occultism", "crafting", "arcana", "nature", "society", "medicine", "lore"];
