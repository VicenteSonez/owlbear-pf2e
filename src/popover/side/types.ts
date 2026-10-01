import type { Character } from "../../pathbuilder";
import type { PcState } from "../../live";
import type { Extras } from "../../extras";

export interface SideProps {
  character: Character;
  state?: PcState;
  extras: Extras;
  // Las anotaciones solo las edita el dueño de la hoja (viven en su navegador)
  canEditExtras: boolean;
  // Los recursos de la sala los editan el dueño y el GM
  canEdit: boolean;
  updateExtras: (fn: (e: Extras) => Extras) => void;
  patch: (fn: (s: PcState) => PcState) => void;
}

export const setIn = <T,>(map: Record<string, T> | undefined, key: string, value: T | undefined): Record<string, T> => {
  const next = { ...(map ?? {}) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
};
