// Estado "vivo" de cada PJ (PG, condiciones, moribundo, escudo…), compartido por toda la sala.
// En Owlbear vive en la metadata de la sala (una clave por personaje), así el GM puede
// modificarlo aunque el PJ no tenga token y se conserva entre escenas.
// Fuera de Owlbear (modo de prueba) se guarda en localStorage.
import { useEffect, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import type { Character } from "./pathbuilder";
import { ID } from "./shared";
import { inOwlbear, whenReady } from "./obr";
import { effectiveMaxHp, type Conditions, type Iwr, type ShieldState, type Vitals } from "./rules";
import type { InitRoll } from "./combat";
import type { ClassState } from "./classes";

export const META_PC_PREFIX = `${ID}/pc/`;
const LOCAL_KEY = "pf2.live.local";

export interface PcState extends Vitals {
  v: 1;
  id: string;
  name: string;
  // Jugador dueño de la hoja (id de Owlbear). Las hojas que sube el GM tienen al GM como dueño.
  owner?: string;
  ownerName?: string;
  level: number;
  maxHp: number;
  baseAc: number;
  acAdj: number;
  cond: Conditions;
  hero: number;
  shield?: ShieldState;
  // Iniciativa del combate en curso (se borra al terminar el combate)
  init?: InitRoll;
  // Recursos que el GM también puede tocar: foco, espacios de conjuro, alquimia
  res?: Resources;
  // Mascota o compañero de otro PJ: no tira iniciativa propia.
  // shared: comparte los PG con su PJ (eidolón)
  pet?: { parent: string; index: number; type: string; shared?: boolean };
  // Color de su diana sobre el objetivo, y token del PNJ elegido como objetivo
  color?: string;
  target?: string;
  iwr?: Iwr;
  // Rasgos de clase activos (Furia, Panache, presa…)
  cls?: ClassState;
  t: number;
}

export interface Resources {
  // Sin valor = al máximo
  focus?: number;
  // "<lanzador>:<rango>" → espontáneo: espacios gastados; preparado: máscara de bits de espacios usados
  used?: Record<string, number>;
  // Alquimia avanzada y viales versátiles (máximo sin valor = el predeterminado de la clase)
  aa?: number;
  aaMax?: number | null;
  vv?: number;
  vvMax?: number | null;
}

export const petStateId = (charId: string, index: number) => `${charId}~p${index}`;

// Colores de las dianas de objetivo: uno al azar por PJ
export const TARGET_COLORS = ["#e8622c", "#4aa3ff", "#3fae5a", "#d4a72c", "#c74ddb", "#2ec4b6", "#ff5d8f", "#a3d13a", "#f2f2f2", "#8f7cff"];
export const randomColor = () => TARGET_COLORS[Math.floor(Math.random() * TARGET_COLORS.length)];

export function pcColor(s: { id: string; color?: string }) {
  if (s.color) return s.color;
  let h = 0;
  for (let i = 0; i < s.id.length; i++) h = (Math.imul(31, h) + s.id.charCodeAt(i)) | 0;
  return TARGET_COLORS[Math.abs(h) % TARGET_COLORS.length];
}

// Ajustes automáticos al guardar: el Aura cinética se apaga al caer a 0 PG
function normalize(s: PcState): PcState {
  if (s.hp <= 0 && s.cls?.aura) return { ...s, cls: { ...s.cls, aura: undefined } };
  return s;
}

export function seedState(c: Character, owner?: { id: string; name: string }, prev?: { hp: number; temp: number }): PcState {
  return {
    v: 1,
    id: c.id,
    name: c.name,
    owner: owner?.id,
    ownerName: owner?.name,
    level: c.level,
    maxHp: c.maxHp,
    baseAc: c.ac,
    acAdj: 0,
    cond: {},
    hp: Math.min(prev?.hp ?? c.maxHp, c.maxHp),
    temp: prev?.temp ?? 0,
    dying: 0,
    wounded: 0,
    hero: 3,
    color: randomColor(),
    shield: c.shield && c.shield.hp > 0
      ? { name: c.shield.name, bonus: c.shield.bonus, hardness: c.shield.hardness, hp: c.shield.hp, maxHp: c.shield.hp, raised: false }
      : undefined,
    t: Date.now(),
  };
}

// La hoja se reimportó (p. ej. subió de nivel): actualiza lo que viene de Pathbuilder
export function needsSheetSync(s: PcState, c: Character) {
  return s.name !== c.name || s.level !== c.level || s.maxHp !== c.maxHp || s.baseAc !== c.ac;
}

export function syncSheet(s: PcState, c: Character): PcState {
  const next = { ...s, name: c.name, level: c.level, maxHp: c.maxHp, baseAc: c.ac };
  next.hp = Math.min(next.hp, effectiveMaxHp(next.maxHp, next.level, next.cond));
  return next;
}

type Listener = (states: Record<string, PcState>) => void;

class LiveStore {
  private states: Record<string, PcState> = {};
  private listeners = new Set<Listener>();
  private startPromise: Promise<void> | null = null;
  ready = false;

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      const inRoom = await whenReady();
      if (inRoom) {
        this.ingest(await OBR.room.getMetadata());
        OBR.room.onMetadataChange((md) => this.ingest(md));
      } else {
        this.ingestLocal();
        window.addEventListener("storage", (e) => {
          if (e.key === LOCAL_KEY) this.ingestLocal();
        });
      }
      this.ready = true;
      this.emit();
    })();
    return this.startPromise;
  }

  private ingest(md: Record<string, unknown>) {
    const next: Record<string, PcState> = {};
    for (const [k, v] of Object.entries(md)) {
      if (k.startsWith(META_PC_PREFIX) && v && typeof v === "object") next[k.slice(META_PC_PREFIX.length)] = v as PcState;
    }
    this.states = next;
    this.emit();
  }

  private ingestLocal() {
    try {
      this.states = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}");
    } catch {
      this.states = {};
    }
    this.emit();
  }

  private persistLocal() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.states));
    } catch {
      // sin almacenamiento: queda en memoria
    }
  }

  private emit() {
    const snapshot = { ...this.states };
    for (const l of this.listeners) l(snapshot);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l({ ...this.states });
    return () => this.listeners.delete(l);
  }

  all() {
    return { ...this.states };
  }

  get(id: string): PcState | undefined {
    return this.states[id];
  }

  // Quien guarda los PG de este estado: el eidolón usa los de su invocador
  hpHolder(id: string): string {
    const s = this.states[id];
    return s?.pet?.shared && this.states[s.pet.parent] ? s.pet.parent : id;
  }

  async write(state: PcState) {
    const next = normalize({ ...state, t: Date.now() });
    this.states = { ...this.states, [next.id]: next };
    this.emit();
    if (inOwlbear) await OBR.room.setMetadata({ [META_PC_PREFIX + next.id]: next });
    else this.persistLocal();
  }

  // Lee lo último conocido justo antes de escribir para pisar lo menos posible a otros
  async patch(id: string, fn: (s: PcState) => PcState) {
    const cur = this.states[id];
    if (!cur) return;
    await this.write(fn(cur));
  }

  async remove(id: string) {
    const { [id]: _removed, ...rest } = this.states;
    this.states = rest;
    this.emit();
    if (inOwlbear) await OBR.room.setMetadata({ [META_PC_PREFIX + id]: undefined });
    else this.persistLocal();
  }
}

export const live = new LiveStore();

export function useLiveStates(): { states: Record<string, PcState>; ready: boolean } {
  const [states, setStates] = useState<Record<string, PcState>>(() => live.all());
  const [ready, setReady] = useState(live.ready);
  useEffect(() => {
    live.start();
    return live.subscribe((s) => {
      setStates(s);
      setReady(live.ready);
    });
  }, []);
  return { states, ready };
}
