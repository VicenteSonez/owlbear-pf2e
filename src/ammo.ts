// Munición de las armas a distancia y armas arrojadizas: qué objeto del inventario gastan,
// cuántas acciones lleva recargar y cuántos disparos da cada recarga. Puro.
import type { Weapon } from "./pathbuilder";

export type AmmoKind = "arrows" | "bolts" | "bullets" | "sling" | "magazine" | "darts";

export const AMMO: { id: AmmoKind; label: string; re: RegExp }[] = [
  { id: "arrows", label: "Flechas (Arrows)", re: /\barrows?\b/i },
  { id: "bolts", label: "Virotes (Bolts)", re: /\bbolts?\b/i },
  { id: "sling", label: "Balas de honda (Sling Bullets)", re: /sling bullets?/i },
  { id: "magazine", label: "Cargador (8Round Magazine)", re: /magazine/i },
  { id: "darts", label: "Dardos de cerbatana (Blowgun Darts)", re: /blowgun darts?/i },
  // Al final: "Sling Bullets" también contiene "bullets"
  { id: "bullets", label: "Balas (Bullets / Rounds)", re: /\b(bullets?|rounds?)\b/i },
];

export interface AmmoRule {
  kind?: AmmoKind;
  // El arma misma se gasta al arrojarla
  self?: boolean;
  // Acciones de recarga (0 = se recarga en el mismo ataque)
  reload: number;
  cap: number;
}

const FIREARMS = /pistol|musket|arquebus|blunderbuss|pepperbox|hand cannon|jezail|harmona|scattergun|dragon mouth/;

// Lo que gasta el arma según su nombre (el jugador lo puede cambiar)
export function guessAmmo(w: Weapon): AmmoRule {
  const n = (w.key || w.name).toLowerCase();
  if (/barricade buster/.test(n)) return { kind: "magazine", reload: 1, cap: 8 };
  if (!w.ranged) return { reload: 0, cap: 1 };
  if (w.bomb) return { reload: 0, cap: 1 };
  if (/crossbow/.test(n)) return { kind: "bolts", reload: /heavy/.test(n) ? 2 : 1, cap: 1 };
  if (/bow\b|daikyu/.test(n)) return { kind: "arrows", reload: 0, cap: 1 };
  if (/sling/.test(n)) return { kind: "sling", reload: 1, cap: 1 };
  if (/blowgun/.test(n)) return { kind: "darts", reload: 1, cap: 1 };
  if (FIREARMS.test(n)) return { kind: "bullets", reload: 1, cap: 1 };
  if (w.thrown) return { self: true, reload: 0, cap: 1 };
  return { reload: 0, cap: 1 };
}

export interface AmmoRow {
  key: string;
  name: string;
  qty: number;
  container: string;
}

// Objeto del inventario que se gasta: el elegido a mano o el primero que coincide con el tipo
export function ammoRow(w: Weapon, rows: AmmoRow[]): AmmoRow | undefined {
  if (w.ammo === "none" || w.ammo === "self") return undefined;
  if (w.ammo) return rows.find((r) => r.key === w.ammo);
  const kind = guessAmmo(w).kind;
  const def = AMMO.find((a) => a.id === kind);
  if (!def) return undefined;
  const list = rows.filter((r) => def.re.test(r.name) && !(kind === "bullets" && /sling|magazine/i.test(r.name)));
  return list.find((r) => r.qty > 0) ?? list[0];
}

// El arma arrojadiza misma, en el inventario (la fila con su nombre)
export function selfRow(w: Weapon, rows: AmmoRow[]): AmmoRow | undefined {
  const n = w.name.trim().toLowerCase();
  const base = (w.key ?? "").toLowerCase();
  const same = rows.filter((r) => {
    const rn = r.name.trim().toLowerCase();
    return rn === n || (!!base && rn === base);
  });
  return same.find((r) => r.qty > 0) ?? same[0];
}

// Cómo dispara el arma: si gasta el arma misma, qué munición y su recarga
export function ammoRule(w: Weapon): AmmoRule {
  const g = guessAmmo(w);
  const self = w.ammo === "self" || (!w.ammo && !!g.self);
  return {
    kind: w.ammo === "none" || self ? undefined : g.kind,
    self,
    reload: w.reload ?? (w.ammo === "none" || self ? 0 : g.reload),
    cap: Math.max(1, w.cap ?? g.cap),
  };
}

// ¿Usa munición o se gasta? (para mostrar el control en la hoja)
export const usesAmmo = (w: Weapon, rows: AmmoRow[]) => {
  const r = ammoRule(w);
  return r.self || !!ammoRow(w, rows) || (!!w.ammo && w.ammo !== "none") || !!r.kind;
};
