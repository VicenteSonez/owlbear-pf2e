// Consumibles comunes de curación (Elixir de vida, Poción de sanación, Tónico calmante): se
// reconocen por nombre (en inglés como los exporta Pathbuilder o traducidos) y su grado.
// Puro: sin OBR ni React.

export type HealFamily = "elixir" | "potion" | "tonic";

export interface HealItemDef {
  // "<familia>:<grado>", con el grado desde 1
  id: string;
  fam: HealFamily;
  grade: number;
  name: string;
  // Curación al usarlo (elixir y poción) o Sanación rápida durante 1 minuto (tónico)
  f?: string;
  fh?: number;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

const FAMILIES: { fam: HealFamily; label: string; re: RegExp; grades: string[]; heal: (string | number)[] }[] = [
  {
    fam: "elixir",
    label: "Elixir de vida",
    re: /elixir\s+(of\s+life|de\s+(la\s+)?vida)/i,
    grades: ["minor", "lesser", "moderate", "greater", "major", "true"],
    heal: ["1d6", "3d6+6", "5d6+12", "7d6+18", "8d6+21", "10d6+27"],
  },
  {
    fam: "potion",
    label: "Poción de sanación",
    re: /healing\s+potion|potion\s+of\s+healing|poci[oó]n\s+de\s+(sanaci[oó]n|curaci[oó]n)/i,
    grades: ["minor", "lesser", "moderate", "greater", "major"],
    heal: ["1d8", "2d8+5", "3d8+10", "6d8+20", "8d8+30"],
  },
  {
    fam: "tonic",
    label: "Tónico calmante",
    re: /soothing\s+tonic|t[oó]nico\s+calmante/i,
    grades: ["lesser", "moderate", "greater", "major"],
    heal: [1, 3, 5, 10],
  },
];

// Grados en español por si el objeto se renombró ("Poción de sanación menor")
const GRADE_ES: Record<string, string> = { menor: "minor", inferior: "lesser", moderada: "moderate", moderado: "moderate", mayor: "greater", superior: "major", verdadera: "true", verdadero: "true" };

export const HEAL_ITEMS: HealItemDef[] = FAMILIES.flatMap((F) =>
  F.heal.map((h, i) => ({
    id: `${F.fam}:${i + 1}`,
    fam: F.fam,
    grade: i + 1,
    name: `${F.label} ${ROMAN[i]}`,
    ...(typeof h === "number" ? { fh: h } : { f: h }),
  })),
);

export const healItem = (id: string) => HEAL_ITEMS.find((d) => d.id === id);

// Qué consumible de curación es un objeto, por su nombre (sin grado reconocible: el menor)
export function matchHealItem(name: string): HealItemDef | undefined {
  const F = FAMILIES.find((x) => x.re.test(name));
  if (!F) return undefined;
  const words = name.toLowerCase().match(/[a-záéíóúñ]+/g) ?? [];
  let grade = 0;
  for (const w of words) {
    const g = F.grades.indexOf(GRADE_ES[w] ?? w);
    if (g >= 0) grade = g + 1;
  }
  if (!grade) {
    const roman = name.match(/\b(VI|IV|V|III|II|I)\b\s*\)?\s*$/);
    const g = roman ? ROMAN.indexOf(roman[1]) : -1;
    if (g >= 0 && g < F.grades.length) grade = g + 1;
  }
  return healItem(`${F.fam}:${grade || 1}`);
}

// De dónde se gasta: Alquimia rápida (lo hecho con ella o un vial versátil), Alquimia
// avanzada (el resto del recetario) o el inventario
export type HealSource = "ar" | "aa" | "inv";

export const SOURCE_LABEL: Record<HealSource, string> = { ar: "Alquimia rápida", aa: "Alquimia avanzada", inv: "Inventario" };

// Orden predeterminado al gastar
export const SOURCE_ORDER: HealSource[] = ["ar", "aa", "inv"];

// Sanación rápida de un tónico: la mayor gana (no se acumulan) y dura 10 rondas
export function withFastHealing<C extends { fastHealing?: number; fhR?: number }>(c: C, fh: number): C {
  if ((c.fastHealing ?? 0) > fh) return c;
  return { ...c, fastHealing: fh, fhR: 10 };
}
