// Actividades de exploración de cada PJ. Se guardan en su estado de la sala (PcState.explore)
// para que el GM y la mesa las vean; sus efectos se aplican al tirar iniciativa y al empezar
// el combate. Puro: sin OBR.
import type { PcState } from "./live";

export type ExploreAct = "scout" | "defend" | "investigate" | "search" | "avoid";

export interface ExploreState {
  acts: ExploreAct[];
  // Bono de Atento cuando es mayor que +1 (dotes)
  scout?: number;
}

export interface ExploreDef {
  id: ExploreAct;
  label: string;
  // Nombre en inglés, para reconocerla en el libro
  en: string;
  icon: string;
  desc: string;
  // Fracción de la Velocidad de viaje
  speed: "half" | "half-less";
}

export const EXPLORE_ACTS: ExploreDef[] = [
  {
    id: "scout",
    label: "Atento",
    en: "Scout",
    icon: "👁",
    desc: "Vigilas por delante y por detrás del grupo: todos los PJ ganan +1 circunstancial a la iniciativa.",
    speed: "half",
  },
  {
    id: "defend",
    label: "Alzar escudo",
    en: "Defend",
    icon: "🛡",
    desc: "Empiezas el combate con el escudo alzado; baja solo al empezar tu turno.",
    speed: "half",
  },
  {
    id: "investigate",
    label: "Investigar",
    en: "Investigate",
    icon: "🔎",
    desc: "Buscas pistas y detalles: el GM puede tirar Recordar conocimiento secreto por ti.",
    speed: "half",
  },
  {
    id: "search",
    label: "Buscar",
    en: "Search",
    icon: "🧭",
    desc: "Buscas trampas, puertas secretas y peligros: tirada secreta de Percepción al elegirla y el GM puede pedir más.",
    speed: "half-less",
  },
  {
    id: "avoid",
    label: "Pasar desapercibido",
    en: "Avoid Notice",
    icon: "👣",
    desc: "Avanzas con sigilo: tirada secreta de Sigilo al elegirla y tiras Sigilo como iniciativa. Al empezar el combate quedas Escondido de los PNJ cuya CD de Percepción iguales o superes.",
    speed: "half",
  },
];

export const hasAct = (s: Pick<PcState, "explore"> | undefined, a: ExploreAct) => !!s?.explore?.acts.includes(a);

export function toggleAct(s: PcState, a: ExploreAct): PcState {
  const acts = s.explore?.acts ?? [];
  const next = acts.includes(a) ? acts.filter((x) => x !== a) : [...acts, a];
  const explore = next.length || s.explore?.scout ? { ...s.explore, acts: next } : undefined;
  return { ...s, explore };
}

export const scoutValue = (s: Pick<PcState, "explore">) => Math.max(1, s.explore?.scout ?? 1);

// Bono de Atento a la iniciativa de todos los PJ: el mayor de quienes vigilan (circunstancial, no se suma)
export function scoutBonus(states: Record<string, PcState> | PcState[]): number {
  let best = 0;
  for (const s of Object.values(states)) if (!s.pet && hasAct(s, "scout")) best = Math.max(best, scoutValue(s));
  return best;
}

export function speedText(def: ExploreDef, speed?: number) {
  const half = speed ? ` (${Math.floor(speed / 2)} pies)` : "";
  return def.speed === "half-less" ? `Mitad de movimiento o menos${half}` : `Mitad de movimiento${half}`;
}

// Habilidades para Recordar conocimiento (más los Saberes)
export const RECALL_SKILLS = ["arcana", "crafting", "medicine", "nature", "occultism", "religion", "society"];
export const isRecallSkill = (key: string) => RECALL_SKILLS.includes(key) || key.startsWith("lore:");

// Pasar desapercibido al empezar el combate: el Sigilo de la iniciativa contra la CD de
// Percepción (10 + Percepción) de cada PNJ. Supera o iguala la CD = escondido de ese PNJ.
export interface Observer {
  key: string;
  name: string;
  dc: number;
}

export function avoidNotice(total: number, observers: Observer[]) {
  const from = observers.filter((o) => total >= o.dc);
  const seen = observers.filter((o) => total < o.dc);
  return { from, seen };
}
