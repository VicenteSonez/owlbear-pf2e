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
  attack: number;
  diceCount: number;
  dieSides: number;
  damageBonus: number;
  damageType: string;
  extra: DamageExtra[];
  agile: boolean;
}

export interface SpellCaster {
  name: string;
  tradition: string;
  type: string;
  attack: number;
  dc: number;
  spells: { rank: number; names: string[] }[];
}

export interface Character {
  id: string;
  name: string;
  className: string;
  ancestry: string;
  heritage: string;
  background: string;
  level: number;
  size: string;
  speed: number;
  abilities: Record<Ability, number>;
  maxHp: number;
  ac: number;
  classDc: number;
  perception: Stat;
  saves: Stat[];
  skills: Stat[];
  weapons: Weapon[];
  casters: SpellCaster[];
  importedAt: number;
}

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

const SKILLS: [string, string, Ability][] = [
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
    return { key, label, prof: rank, mod: abilities[ab] + profBonus(rank) + modBonus(mods, modName) };
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
    return {
      name: display,
      attack: num(w.attack),
      diceCount: strikingDice(w.str),
      dieSides: num(String(w.die ?? "d4").replace(/\D/g, ""), 4),
      damageBonus: num(w.damageBonus),
      damageType: DAMAGE_TYPES[String(w.damageType)] ?? String(w.damageType ?? ""),
      extra: parseExtra(w.extraDamage),
      agile: AGILE_WEAPONS.some((a) => baseName.includes(a)),
    };
  });

  const casters: SpellCaster[] = (Array.isArray(b.spellCasters) ? b.spellCasters : []).map(
    (c: Json) => {
      const ab = (String(c.ability ?? "cha").toLowerCase().slice(0, 3) as Ability) || "cha";
      const base = (abilities[ab] ?? 0) + profBonus(toRank(c.proficiency));
      const spells = (Array.isArray(c.spells) ? c.spells : [])
        .map((s: Json) => ({ rank: num(s.spellLevel), names: (s.list ?? []).map(String) }))
        .filter((s: { names: string[] }) => s.names.length);
      return {
        name: String(c.name ?? "Lanzador"),
        tradition: String(c.magicTradition ?? ""),
        type: String(c.spellcastingType ?? ""),
        attack: base + modBonus(mods, "Spell Attack"),
        dc: 10 + base + modBonus(mods, "Spell DC"),
        spells,
      };
    },
  );

  // Conjuros de foco: { divine: { wis: { proficiency, focusCantrips, focusSpells } } }
  const focus: Json = b.focus ?? {};
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

  const keyAb = (String(b.keyability ?? "str").slice(0, 3) as Ability) || "str";
  const name = String(b.name ?? "Personaje");

  return {
    id: hashId(`${name}|${b.class}|${b.ancestry}`),
    name,
    className: [b.class, b.dualClass].filter(Boolean).join(" / "),
    ancestry: String(b.ancestry ?? ""),
    heritage: String(b.heritage ?? ""),
    background: String(b.background ?? ""),
    level,
    size: String(b.sizeName ?? ""),
    speed: num(attrs.speed) + num(attrs.speedBonus),
    abilities,
    maxHp: Math.max(1, maxHp),
    ac: num(b.acTotal?.acTotal, 10),
    classDc: 10 + (abilities[keyAb] ?? 0) + profBonus(toRank(prof.classDC)),
    perception: stat("perception", "Percepción", "wis", prof.perception),
    saves: SAVES.map(([k, label, ab]) => stat(k, label, ab, prof[k])),
    skills: [...skills, ...lores],
    weapons,
    casters,
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
