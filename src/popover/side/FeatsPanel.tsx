import { useState } from "react";
import type { Feat } from "../../pathbuilder";
import { PanelHead } from "./common";
import { setIn, type SideProps } from "./types";

const TYPE_ORDER = ["Rasgo de clase", "Heritage", "Ancestry Feat", "Class Feat", "Archetype Feat", "Skill Feat", "General Feat", "Awarded Feat"];

const TYPE_LABEL: Record<string, string> = {
  "Rasgo de clase": "Rasgo de clase",
  Heritage: "Herencia",
  "Ancestry Feat": "Ascendencia",
  "Class Feat": "Clase",
  "Archetype Feat": "Arquetipo",
  "Skill Feat": "Habilidad",
  "General Feat": "General",
  "Awarded Feat": "Otorgada",
};

const typeRank = (t: string) => {
  const i = TYPE_ORDER.indexOf(t);
  return i < 0 ? TYPE_ORDER.length : i;
};

const featKey = (f: Feat) => `feat:${f.type}:${f.name}`;

export function FeatsPanel({ character: c, extras, canEditExtras, updateExtras }: SideProps) {
  const [open, setOpen] = useState<string | null>(null);
  // Los rasgos de clase no tienen nivel: van antes del nivel 1
  const all: Feat[] = [...(c.specials ?? []).map((name) => ({ name, type: "Rasgo de clase", level: null })), ...(c.feats ?? [])];
  const levels = [...new Set(all.map((f) => f.level))].sort((a, b) => (a ?? 0) - (b ?? 0));

  if (!all.length) {
    return (
      <div className="side-panel">
        <PanelHead title="Dotes y rasgos" />
        <p className="muted">Vuelve a importar el JSON de Pathbuilder para ver las dotes.</p>
      </div>
    );
  }

  return (
    <div className="side-panel">
      <PanelHead title="Dotes y rasgos">
        <span className="muted small">Toca una dote para escribir notas</span>
      </PanelHead>
      {levels.map((lv) => (
        <section key={lv ?? "none"} className="feat-level">
          <h3>{lv === null ? "Antes del nivel 1" : `Nivel ${lv}`}</h3>
          {all
            .filter((f) => f.level === lv)
            .sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name))
            .map((f) => {
              const key = featKey(f);
              const note = extras.notes?.[key] ?? "";
              const isOpen = open === key;
              return (
                <div key={key} className={`feat ${isOpen ? "open" : ""}`}>
                  <button className="feat-row" onClick={() => setOpen(isOpen ? null : key)}>
                    <span className="feat-name">{f.name}</span>
                    {note && <span className="feat-dot" title="Tiene notas" />}
                    {f.free && <span className="chip on small-chip">Arquetipo libre</span>}
                    <span className={`feat-type t${typeRank(f.type)}`}>{TYPE_LABEL[f.type] ?? f.type}</span>
                  </button>
                  {isOpen && (
                    <textarea
                      className="feat-notes"
                      placeholder={canEditExtras ? "¿De qué se trata? Escribe tus notas…" : "Sin notas"}
                      value={note}
                      readOnly={!canEditExtras}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateExtras((x) => ({ ...x, notes: setIn(x.notes, key, v || undefined) }));
                      }}
                    />
                  )}
                </div>
              );
            })}
        </section>
      ))}
    </div>
  );
}
