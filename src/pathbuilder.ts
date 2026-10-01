// Convierte el JSON exportado por Pathbuilder 2e en una hoja compacta.
// La hoja compacta es la que se guarda y se comparte con el resto de la sala
// (metadata de jugador en Owlbear tiene un límite de 16 kB).

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type ProfRank = 0 | 2 | 4 | 6 | 8;

export interface Stat {
  key: string;
  label: string;
  mod: number;
  prof: ProfRank;
  ability: Ability;
}

export interface DamageExtra {
  dice: number;
  sides: number;
  type: string;
  // El daño de precisión (Precise Strike, Sneak Attack) es condicional: empieza apagado
  active: boolean;
}

export interface Weapon {
  name: string;
  // Nombre base en minúsculas: sirve de clave para los ajustes manuales del jugador
  key: string;
  attack: number;
  diceCount: number;
  dieSides: number;
  damageBonus: number;
  damageType: string;
  extra: DamageExtra[];
  agile: boolean;
  finesse: boolean;
  ranged: boolean;
  // Incremento de alcance en pies (solo armas a distancia)
  range?: number;
}

export interface ShieldInfo {
  name: string;
  bonus: number;
  hardness: number;
  hp: number;
}

export interface SpellCaster {
  name: string;
  tradition: string;
  type: string;
  attack: number;
  dc: number;
  // Repertorio (espontáneos) o lista de conjuros conocidos/libro (preparados)
  spells: { rank: number; names: string[] }[];
  innate?: boolean;
  // Espacios por día: el índice 0 son los trucos
  perDay?: number[];
  // Preparados: qué conjuro ocupa cada espacio (un nombre repetido = varios espacios)
  prepared?: { rank: number; names: string[] }[];
}

export interface Feat {
  name: string;
  // Tipo tal como lo da Pathbuilder: "Class Feat", "Skill Feat", "Heritage"…
  type: string;
  level: number | null;
  // Dote del arquetipo libre (Free Archetype)
  free?: boolean;
}

export interface Item {
  name: string;
  qty: number;
  // Nombre del contenedor (mochila, bolsa…) o "Equipado" para armas y armadura
  container?: string;
}

export interface Pet {
  name: string;
  // "Animal Companion", "Familiar", "Eidolon"…
  type: string;
  animal?: string;
}

// Sube este número cuando el lector cambie: las hojas guardadas se vuelven a leer solas
export const PARSER_VERSION = 3;

export interface Character {
  parserVersion?: number;
  id: string;
  name: string;
  className: string;
  ancestry: string;
  heritage: string;
  background: string;
  level: number;
  size: string;
  speed: number;
  speedBase?: number;
  speedBonus?: number;
  senses?: string[];
  shield?: ShieldInfo;
  // Kineticista: ataque y CD de impulsos (usan Constitución)
  impulse?: { attack: number; dc: number };
  abilities: Record<Ability, number>;
  maxHp: number;
  ac: number;
  classDc: number;
  perception: Stat;
  saves: Stat[];
  skills: Stat[];
  weapons: Weapon[];
  casters: SpellCaster[];
  // Puntos de foco máximos (uno por conjuro de foco, hasta 3)
  focusMax?: number;
  feats?: Feat[];
  // Rasgos de clase y especiales sin nivel
  specials?: string[];
  items?: Item[];
  money?: { cp: number; sp: number; gp: number; pp: number };
  formulas?: string[];
  alchemy?: { alchemist: boolean; advanced: boolean; quick: boolean };
  pets?: Pet[];
  importedAt: number;
}

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

export const SKILLS: [string, string, Ability][] = [
  ["acrobatics", "Acrobacias", "dex"],
  ["arcana", "Arcanos", "int"],
  ["athletics", "Atletismo", "str"],
  ["crafting", "Artesanía", "int"],
  ["deception", "Engaño", "cha"],
  ["diplomacy", "Diplomacia", "cha"],
  ["intimidation", "Intimidación", "cha"],
  ["medicine", "Medicina", "wis"],
  ["nature", "Naturaleza", "wis"],
  ["occultism", "Ocultismo", "int"],
  ["performance", "Interpretación", "cha"],
  ["religion", "Religión", "wis"],
  ["society", "Sociedad", "int"],
  ["stealth", "Sigilo", "dex"],
  ["survival", "Supervivencia", "wis"],
  ["thievery", "Latrocinio", "dex"],
];

const SAVES: [string, string, Ability][] = [
  ["fortitude", "Fortaleza", "con"],
  ["reflex", "Reflejos", "dex"],
  ["will", "Voluntad", "wis"],
];

// Armas base con el rasgo Ágil (Pathbuilder no exporta rasgos).
const AGILE_WEAPONS = [
  "dagger", "fist", "shortsword", "main-gauche", "sickle", "kukri", "light hammer",
  "light mace", "hatchet", "katar", "sai", "gauntlet", "spiked gauntlet", "claw",
  "starknife", "clan dagger", "light pick", "war razor", "sap", "handwraps",
  "unarmed", "tekko-kagi", "wakizashi", "kama", "jaws of", "fighting fan",
  "butterfly sword", "sword cane", "tamchal chakram", "throwing knife",
];

// Armas sutiles (Torpe las penaliza)
const FINESSE_WEAPONS = [
  "dagger", "rapier", "shortsword", "whip", "main-gauche", "sickle", "kukri", "starknife", "sai",
  "fist", "handwraps", "claw", "elven curve blade", "sword cane", "spiked chain", "butterfly sword",
  "tekko-kagi", "wakizashi", "fighting fan", "war razor", "dueling sword", "bladed scarf", "unarmed",
];

// Armas a distancia y su incremento de alcance en pies (se puede editar a mano).
// Ordenadas de más específica a más general porque se buscan por coincidencia parcial.
const RANGED_WEAPONS: [string, number][] = [
  ["repeating heavy crossbow", 120], ["repeating hand crossbow", 60], ["repeating crossbow", 120],
  ["heavy crossbow", 120], ["hand crossbow", 60], ["gauntlet bow", 60], ["crossbow", 120],
  ["composite longbow", 100], ["composite shortbow", 60], ["longbow", 100], ["shortbow", 60], ["daikyu", 80],
  ["halfling sling staff", 80], ["sling", 50], ["blowgun", 20], ["dart", 20], ["javelin", 30],
  ["shuriken", 20], ["bola", 20], ["throwing knife", 20], ["chakri", 20], ["boomerang", 60],
  ["dueling pistol", 60], ["flintlock pistol", 40], ["flintlock musket", 70], ["arquebus", 150],
  ["blunderbuss", 40], ["pepperbox", 30], ["hand cannon", 30], ["dragon mouth pistol", 20], ["jezail", 90],
  ["slide pistol", 30], ["harmona gun", 150], ["double-barreled pistol", 30], ["double-barreled musket", 60],
  ["dwarven scattergun", 30], ["pistol", 40], ["musket", 70],
];

// Sentidos especiales: se buscan en los rasgos especiales y en los nombres de dotes
const SENSES: [string, string][] = [
  ["Greater Darkvision", "Visión en la oscuridad mayor"],
  ["Darkvision", "Visión en la oscuridad"],
  ["Low-Light Vision", "Visión en penumbra"],
  ["Scent", "Olfato"],
  ["Tremorsense", "Sentido de la vibración"],
  ["Echolocation", "Ecolocalización"],
  ["Wavesense", "Sentido de las ondas"],
  ["Lifesense", "Sentido de la vida"],
  ["Thoughtsense", "Sentido del pensamiento"],
  ["Motion Sense", "Sentido del movimiento"],
  ["Spiritsense", "Sentido espiritual"],
];

// Escudos comunes: bono a la CA, dureza y PG
export const SHIELDS: Record<string, { bonus: number; hardness: number; hp: number }> = {
  buckler: { bonus: 1, hardness: 3, hp: 6 },
  "gauntlet buckler": { bonus: 1, hardness: 3, hp: 6 },
  "wooden shield": { bonus: 2, hardness: 3, hp: 12 },
  "steel shield": { bonus: 2, hardness: 5, hp: 20 },
  "tower shield": { bonus: 2, hardness: 5, hp: 20 },
  "fortress shield": { bonus: 3, hardness: 6, hp: 24 },
  "meteor shield": { bonus: 2, hardness: 4, hp: 16 },
  "heavy rondache": { bonus: 1, hardness: 5, hp: 24 },
};

export const PROF_LABEL: Record<number, string> = { 0: "U", 2: "T", 4: "E", 6: "M", 8: "L" };

type Json = Record<string, any>;

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
};

const toRank = (v: unknown): ProfRank => {
  const n = num(v);
  return (n >= 8 ? 8 : n >= 6 ? 6 : n >= 4 ? 4 : n >= 2 ? 2 : 0) as ProfRank;
};

// Suma los bonos de "mods" de Pathbuilder: { "Athletics": { "Item Bonus": 1 } }
function modBonus(mods: Json | undefined, name: string): number {
  if (!mods) return 0;
  const key = Object.keys(mods).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return 0;
  const entry = mods[key];
  if (typeof entry === "number") return entry;
  if (entry && typeof entry === "object") {
    return Object.values(entry).reduce<number>((acc, v) => acc + num(v), 0);
  }
  return 0;
}

function strikingDice(str: unknown): number {
  const s = String(str ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (s.includes("major")) return 4;
  if (s.includes("greater")) return 3;
  if (s.includes("striking")) return 2;
  return 1;
}

const DAMAGE_TYPES: Record<string, string> = {
  S: "Cortante", P: "Perforante", B: "Contundente",
};

function parseExtra(extra: unknown): DamageExtra[] {
  if (!Array.isArray(extra)) return [];
  const out: DamageExtra[] = [];
  for (const e of extra) {
    const m = String(e).match(/(\d+)\s*d\s*(\d+)\s*(.*)/i);
    if (m) out.push({ dice: +m[1], sides: +m[2], type: m[3].trim(), active: !/precision/i.test(m[3]) });
  }
  return out;
}

function hashId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function parsePathbuilder(raw: unknown): Character {
  const root = raw as Json;
  const b: Json | undefined = root?.build ?? (root?.name && root?.abilities ? root : undefined);
  if (!b) throw new Error("El archivo no parece un JSON exportado de Pathbuilder 2e.");
  if (root?.success === false) throw new Error("Pathbuilder respondió sin éxito (success: false).");

  const level = Math.max(1, num(b.level, 1));
  const prof: Json = b.proficiencies ?? {};
  const mods: Json | undefined = b.mods;

  // Pathbuilder exporta puntuaciones (18 = +4). Si todo es <= 7 asumimos modificadores.
  const rawAb: Json = b.abilities ?? {};
  const values = ABILITIES.map((a) => num(rawAb[a], 10));
  const areMods = values.every((v) => v <= 7);
  const abilities = Object.fromEntries(
    ABILITIES.map((a, i) => [a, areMods ? values[i] : Math.floor((values[i] - 10) / 2)]),
  ) as Record<Ability, number>;

  const profBonus = (rank: ProfRank) => (rank > 0 ? rank + level : 0);
  const stat = (key: string, label: string, ab: Ability, rankRaw: unknown, modName = key): Stat => {
    const rank = toRank(rankRaw);
    return { key, label, prof: rank, ability: ab, mod: abilities[ab] + profBonus(rank) + modBonus(mods, modName) };
  };

  const skills = SKILLS.map(([k, label, ab]) => stat(k, label, ab, prof[k]));
  const lores: Stat[] = (Array.isArray(b.lores) ? b.lores : []).map((l: unknown[]) => {
    const name = String(l[0]);
    return stat(`lore:${name}`, `Saber: ${name}`, "int", l[1], `${name} Lore`);
  });

  const attrs: Json = b.attributes ?? {};
  const maxHp =
    num(attrs.ancestryhp) +
    num(attrs.bonushp) +
    (num(attrs.classhp) + num(attrs.bonushpPerLevel) + abilities.con) * level;

  const weapons: Weapon[] = (Array.isArray(b.weapons) ? b.weapons : []).map((w: Json) => {
    const baseName = String(w.name ?? "").toLowerCase();
    const display = String(w.display || w.name || "Arma");
    const ranged = RANGED_WEAPONS.find(([n]) => baseName.includes(n));
    return {
      name: display,
      key: baseName || display.toLowerCase(),
      attack: num(w.attack),
      diceCount: strikingDice(w.str),
      dieSides: num(String(w.die ?? "d4").replace(/\D/g, ""), 4),
      damageBonus: num(w.damageBonus),
      damageType: DAMAGE_TYPES[String(w.damageType)] ?? String(w.damageType ?? ""),
      extra: parseExtra(w.extraDamage),
      // "Gauntlet Bow" contiene "gauntlet" pero es un arco, no un arma ágil
      agile: !/bow\b/.test(baseName) && AGILE_WEAPONS.some((a) => baseName.includes(a)),
      finesse: FINESSE_WEAPONS.some((a) => baseName.includes(a)),
      ranged: !!ranged,
      range: ranged?.[1],
    };
  });

  // Sentidos: en "specials" o en el nombre de alguna dote
  const traitNames: string[] = [
    ...(Array.isArray(b.specials) ? b.specials.map(String) : []),
    ...(Array.isArray(b.feats) ? b.feats.map((f: unknown[]) => String(f?.[0] ?? "")) : []),
  ].map((t) => t.toLowerCase());
  const senses: string[] = [];
  for (const [en, es] of SENSES) {
    if (!traitNames.some((t) => t.includes(en.toLowerCase()))) continue;
    // "Darkvision" ya va incluido en "Greater Darkvision"
    if (en === "Darkvision" && senses.includes("Visión en la oscuridad mayor")) continue;
    senses.push(es);
  }

  // Escudo equipado: Pathbuilder lo lista en "armor" con prof "shield"
  const shieldEntry = (Array.isArray(b.armor) ? b.armor : []).find(
    (a: Json) => String(a.prof).toLowerCase() === "shield" && a.worn !== false,
  );
  let shield: ShieldInfo | undefined;
  if (shieldEntry) {
    const shieldName = String(shieldEntry.name ?? "Escudo");
    const known = SHIELDS[shieldName.toLowerCase()];
    shield = {
      name: String(shieldEntry.display || shieldName),
      bonus: num(b.acTotal?.shieldBonus, known?.bonus ?? 2),
      hardness: known?.hardness ?? 0,
      hp: known?.hp ?? 0,
    };
  }

  const casters: SpellCaster[] = (Array.isArray(b.spellCasters) ? b.spellCasters : []).map(
    (c: Json) => {
      const ab = (String(c.ability ?? "cha").toLowerCase().slice(0, 3) as Ability) || "cha";
      const base = (abilities[ab] ?? 0) + profBonus(toRank(c.proficiency));
      const spells = (Array.isArray(c.spells) ? c.spells : [])
        .map((s: Json) => ({ rank: num(s.spellLevel), names: (s.list ?? []).map(String) }))
        .filter((s: { names: string[] }) => s.names.length);
      const prepared = (Array.isArray(c.prepared) ? c.prepared : [])
        .map((s: Json) => ({ rank: num(s.spellLevel), names: (s.list ?? []).map(String) }))
        .filter((s: { names: string[] }) => s.names.length);
      return {
        name: String(c.name ?? "Lanzador"),
        tradition: String(c.magicTradition ?? ""),
        type: String(c.spellcastingType ?? ""),
        attack: base + modBonus(mods, "Spell Attack"),
        dc: 10 + base + modBonus(mods, "Spell DC"),
        spells,
        innate: !!c.innate,
        perDay: Array.isArray(c.perDay) ? c.perDay.map((n: unknown) => num(n)) : undefined,
        prepared,
      };
    },
  );

  // Conjuros de foco: { divine: { wis: { proficiency, focusCantrips, focusSpells } } }
  const focus: Json = b.focus ?? {};
  let focusSpellCount = 0;
  for (const [tradition, byAb] of Object.entries(focus)) {
    if (!byAb || typeof byAb !== "object") continue;
    for (const [abKey, f] of Object.entries(byAb as Json)) {
      const ab = abKey.slice(0, 3) as Ability;
      if (!(ab in abilities) || !f || typeof f !== "object") continue;
      const fj = f as Json;
      const base = abilities[ab] + profBonus(toRank(fj.proficiency)) + num(fj.itemBonus);
      const cantrips: string[] = (fj.focusCantrips ?? []).map(String);
      const focusSpells: string[] = (fj.focusSpells ?? []).map(String);
      if (!cantrips.length && !focusSpells.length) continue;
      focusSpellCount += focusSpells.length;
      casters.push({
        name: `Foco (${tradition})`,
        tradition,
        type: "focus",
        attack: base,
        dc: 10 + base,
        spells: [
          ...(cantrips.length ? [{ rank: 0, names: cantrips }] : []),
          ...(focusSpells.length ? [{ rank: -1, names: focusSpells }] : []),
        ],
      });
    }
  }

  // Dotes: [nombre, ?, tipo, nivel, "Free Archetype 2", …]. Pathbuilder a veces las repite.
  const feats: Feat[] = [];
  for (const f of Array.isArray(b.feats) ? b.feats : []) {
    if (!Array.isArray(f) || !f[0]) continue;
    const feat: Feat = {
      name: String(f[0]),
      type: String(f[2] ?? "Feat"),
      level: f[3] === null || f[3] === undefined ? null : num(f[3]),
      free: /free archetype/i.test(String(f[4] ?? "")) || undefined,
    };
    if (!feats.some((x) => x.name === feat.name && x.type === feat.type && x.level === feat.level)) feats.push(feat);
  }
  // Los especiales que ya son dotes (o sentidos) no se repiten
  const featNames = new Set(feats.map((f) => f.name.toLowerCase()));
  const specials = (Array.isArray(b.specials) ? b.specials.map(String) : []).filter(
    (s: string) => !featNames.has(s.toLowerCase()) && !SENSES.some(([en]) => en.toLowerCase() === s.toLowerCase()),
  );

  // Inventario: [nombre, cantidad, idContenedor?, "Invested"]. "Invested" viene en todo, así que se ignora.
  const containers: Json = b.equipmentContainers ?? {};
  const items: Item[] = [
    ...(Array.isArray(b.weapons) ? b.weapons : []).map((w: Json) => ({
      name: String(w.display || w.name || "Arma"),
      qty: Math.max(1, num(w.qty, 1)),
      container: "Equipado",
    })),
    ...(Array.isArray(b.armor) ? b.armor : []).map((a: Json) => ({
      name: String(a.display || a.name || "Armadura"),
      qty: Math.max(1, num(a.qty, 1)),
      container: "Equipado",
    })),
  ];
  for (const e of Array.isArray(b.equipment) ? b.equipment : []) {
    if (!Array.isArray(e) || !e[0]) continue;
    const cid = typeof e[2] === "string" && containers[e[2]] ? e[2] : undefined;
    items.push({ name: String(e[0]), qty: num(e[1], 1), container: cid ? String(containers[cid].containerName ?? "Contenedor") : undefined });
  }

  const money: Json = b.money ?? {};
  const formulas = [
    ...new Set<string>((Array.isArray(b.formula) ? b.formula : []).flatMap((f: Json) => (Array.isArray(f?.known) ? f.known.map(String) : []))),
  ];
  const specialsLower = (Array.isArray(b.specials) ? b.specials : []).map((x: unknown) => String(x).toLowerCase());
  const pets: Pet[] = [
    ...(Array.isArray(b.pets) ? b.pets : []).map((p: Json) => ({
      name: String(p.name || p.animal || "Mascota"),
      type: String(p.type || "Mascota"),
      animal: p.animal ? String(p.animal) : undefined,
    })),
    ...(Array.isArray(b.familiars) ? b.familiars : []).map((p: Json) => ({
      name: String(p.name || "Familiar"),
      type: String(p.type || "Familiar"),
    })),
  ];

  const keyAb = (String(b.keyability ?? "str").slice(0, 3) as Ability) || "str";
  const name = String(b.name ?? "Personaje");
  const classDc = 10 + (abilities[keyAb] ?? 0) + profBonus(toRank(prof.classDC));
  const className = [b.class, b.dualClass].filter(Boolean).join(" / ");

  return {
    parserVersion: PARSER_VERSION,
    id: hashId(`${name}|${b.class}|${b.ancestry}`),
    name,
    className,
    ancestry: String(b.ancestry ?? ""),
    heritage: String(b.heritage ?? ""),
    background: String(b.background ?? ""),
    level,
    size: String(b.sizeName ?? ""),
    speed: num(attrs.speed) + num(attrs.speedBonus),
    speedBase: num(attrs.speed),
    speedBonus: num(attrs.speedBonus),
    senses,
    shield,
    impulse: /kineticist/i.test(className) ? { attack: classDc - 10, dc: classDc } : undefined,
    abilities,
    maxHp: Math.max(1, maxHp),
    ac: num(b.acTotal?.acTotal, 10),
    classDc,
    perception: stat("perception", "Percepción", "wis", prof.perception),
    saves: SAVES.map(([k, label, ab]) => stat(k, label, ab, prof[k])),
    skills: [...skills, ...lores],
    weapons,
    casters,
    focusMax: focusSpellCount ? Math.min(3, focusSpellCount) : undefined,
    feats,
    specials,
    items,
    money: { cp: num(money.cp), sp: num(money.sp), gp: num(money.gp), pp: num(money.pp) },
    formulas,
    alchemy: {
      alchemist: /alchemist/i.test(className),
      advanced: specialsLower.includes("advanced alchemy"),
      quick: specialsLower.includes("quick alchemy") || specialsLower.includes("versatile vials"),
    },
    pets,
    importedAt: Date.now(),
  };
}

export const fmtMod = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

// Penalizador por ataque múltiple
export function mapSteps(w: Weapon): number[] {
  const step = w.agile ? 4 : 5;
  return [w.attack, w.attack - step, w.attack - step * 2];
}

export function damageFormula(w: Weapon): string {
  const extra = w.extra.filter((e) => e.active).map((e) => `+${e.dice}d${e.sides}`).join("");
  const bonus = w.damageBonus ? fmtMod(w.damageBonus) : "";
  return `${w.diceCount}d${w.dieSides}${bonus}${extra}`;
}
