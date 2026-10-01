import type { Character } from "../../pathbuilder";
import { IconBag, IconBook, IconFeats, IconFlask, IconSheet, IconWolf } from "./icons";

export type Side = "feats" | "inventory" | "magic" | "recipes" | "pet";

// Pestañas que se asoman por el lado derecho de la hoja, en el orden pedido
export function sidesFor(c: Character): { id: Side; label: string; icon: React.ReactNode }[] {
  const alch = c.alchemy;
  return [
    { id: "feats" as const, label: "Dotes y rasgos", icon: <IconFeats /> },
    { id: "inventory" as const, label: "Inventario", icon: <IconBag /> },
    ...(c.casters.length ? [{ id: "magic" as const, label: "Magia", icon: <IconBook /> }] : []),
    ...(c.formulas?.length || alch?.alchemist || alch?.advanced || alch?.quick
      ? [{ id: "recipes" as const, label: "Recetas", icon: <IconFlask /> }]
      : []),
    ...(c.pets?.length ? [{ id: "pet" as const, label: "Mascota", icon: <IconWolf /> }] : []),
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
