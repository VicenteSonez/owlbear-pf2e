// Acciones de la ventana principal que usan muchos paneles: tirar dados, publicar avisos y
// efectos. Se reparten con un contexto para no pasarlas de componente en componente.
import { createContext, useContext } from "react";
import type { Degree } from "../rules";
import type { RollEntry } from "../shared";
import type { RollFx } from "../fx";
import type { RollRequest } from "./App";

export interface RollResult {
  total: number;
  degree?: Degree;
  nat?: 1 | 20;
}

export interface NoteRequest {
  label: string;
  detail?: string;
  tag?: string;
  secret?: boolean;
  charName?: string;
  charId?: string;
  targetName?: string;
  fx?: RollFx;
}

export interface Actions {
  roll: (req: RollRequest, opts?: { preview?: boolean; quick?: boolean }) => Promise<RollResult | undefined>;
  notify: (n: NoteRequest) => Promise<void>;
  publish: (e: RollEntry) => Promise<void>;
  // Efecto visual suelto (todos lo ven aunque la tirada sea secreta)
  playFx: (fx: RollFx) => void;
  isGm: boolean;
  meId: string;
}

export const ActionsContext = createContext<Actions | null>(null);

export function useActions(): Actions {
  const a = useContext(ActionsContext);
  if (!a) throw new Error("Falta ActionsContext");
  return a;
}
