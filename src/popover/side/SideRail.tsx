import type { Character } from "../../pathbuilder";
import { featuresOf } from "../../classes";
import { IconBag, IconBook, IconFeats, IconFlask, IconSheet, IconWolf } from "./icons";

export type Side = "feats" | "inventory" | "magic" | "recipes" | "pet";

// Pestañas que se asoman por el lado derecho de la hoja, en el orden pedido
export function sidesFor(c: Character): { id: Side; label: string; icon: React.ReactNode }[] {
  const alch = c.alchemy;
  const f = featuresOf(c);
  return [
    { id: "feats" as const, label: "Dotes y rasgos", icon: <IconFeats /> },
    { id: "inventory" as const, label: "Inventario", icon: <IconBag /> },
    // Siempre: aunque no lance conjuros puede tener pergaminos o conjuros innatos de objetos
    { id: "magic" as const, label: "Magia", icon: <IconBook /> },
    ...(c.formulas?.length || alch?.alchemist || alch?.advanced || alch?.quick
      ? [{ id: "recipes" as const, label: "Recetas", icon: <IconFlask /> }]
      : []),
    ...(c.pets?.length || f.thrall ? [{ id: "pet" as const, label: "Mascota", icon: <IconWolf /> }] : []),
  ];
}

export function SideRail({ character, side, onSide }: { character: Character; side: Side | null; onSide: (s: Side | null) => void }) {
  return (
    <nav className="side-rail" aria-label="Pestañas de la hoja">
      <button className={side === null ? "on" : ""} title="Hoja" onClick={() => onSide(null)}>
        <IconSheet />
      </button>
      {sidesFor(character).map((s) => (
        <button key={s.id} className={side === s.id ? "on" : ""} title={s.label} onClick={() => onSide(side === s.id ? null : s.id)}>
          {s.icon}
        </button>
      ))}
    </nav>
  );
}
