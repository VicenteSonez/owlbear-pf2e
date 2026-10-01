import { useState } from "react";
import type { Resources } from "../../live";
import { Counter, EditableName, PanelHead } from "./common";
import { setIn, type SideProps } from "./types";

// Contador de alquimia: valor actual, máximo editable (vacío = sin máximo) y botón para llenarlo
function AlchemyCounter(props: {
  label: string;
  title: string;
  value: number;
  max: number | null;
  canEdit: boolean;
  onValue: (v: number) => void;
  onMax: (v: number | null) => void;
  extra?: React.ReactNode;
}) {
  const { label, value, max, canEdit } = props;
  const [maxText, setMaxText] = useState(max === null ? "" : String(max));
  return (
    <div className="alch" title={props.title}>
      <b>{label}</b>
      <Counter value={value} canEdit={canEdit} max={max ?? 9999} onChange={props.onValue} />
      <span className="muted small">/</span>
      <input
        className="alch-max"
        inputMode="numeric"
        placeholder="máx"
        value={maxText}
        disabled={!canEdit}
        onChange={(e) => setMaxText(e.target.value.replace(/\D/g, ""))}
        onBlur={() => props.onMax(maxText === "" ? null : parseInt(maxText, 10))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <button className="btn small-btn" disabled={!canEdit || max === null} onClick={() => max !== null && props.onValue(max)} title="Dejar en el máximo">
        Máx
      </button>
      {props.extra}
    </div>
  );
}

export function RecipesPanel({ character: c, state, extras, canEdit, canEditExtras, updateExtras, patch }: SideProps) {
  const [newName, setNewName] = useState("");
  const res: Resources = state?.res ?? {};
  const patchRes = (fn: (r: Resources) => Resources) => patch((s) => ({ ...s, res: fn(s.res ?? {}) }));
  const alch = c.alchemy ?? { alchemist: false, advanced: false, quick: false };
  const int = c.abilities.int ?? 0;
  // Máximos predeterminados: solo el alquimista los trae calculados (4 + Int y 2 + Int)
  const aaMax = res.aaMax !== undefined ? res.aaMax : alch.alchemist ? 4 + int : null;
  const vvMax = res.vvMax !== undefined ? res.vvMax : alch.alchemist ? 2 + int : null;
  const aa = res.aa ?? aaMax ?? 0;
  const vv = res.vv ?? vvMax ?? 0;
  const showAA = alch.advanced || alch.alchemist;
  const showVV = alch.quick || alch.alchemist;

  const rows = [
    ...(c.formulas ?? []).map((name) => ({ key: `rec:${name}`, name, added: false })),
    ...(extras.added ?? []).filter((a) => a.list === "recipe").map((a) => ({ key: a.key, name: a.name, added: true })),
  ];
  const qtyOf = (key: string) => extras.qty?.[key] ?? 0;
  const addQty = (key: string, n: number) => updateExtras((x) => ({ ...x, qty: setIn(x.qty, key, Math.max(0, (x.qty?.[key] ?? 0) + n) || undefined) }));

  return (
    <div className="side-panel">
      <PanelHead title="Recetario" />

      {(showAA || showVV) && (
        <section className="alch-box">
          {showAA && (
            <AlchemyCounter
              label="Alquimia avanzada"
              title="Lotes de alquimia avanzada disponibles hoy"
              value={aa}
              max={aaMax}
              canEdit={canEdit}
              onValue={(v) => patchRes((r) => ({ ...r, aa: v }))}
              onMax={(v) => patchRes((r) => ({ ...r, aaMax: v, aa: v === null ? r.aa : Math.min(r.aa ?? v, v) }))}
            />
          )}
          {showVV && (
            <AlchemyCounter
              label="Viales versátiles"
              title="Viales versátiles para Alquimia rápida"
              value={vv}
              max={vvMax}
              canEdit={canEdit}
              onValue={(v) => patchRes((r) => ({ ...r, vv: v }))}
              onMax={(v) => patchRes((r) => ({ ...r, vvMax: v, vv: v === null ? r.vv : Math.min(r.vv ?? v, v) }))}
              extra={
                <button
                  className="btn small-btn"
                  disabled={!canEdit}
                  title="Suma 2 viales (sin pasar del máximo)"
                  onClick={() => patchRes((r) => ({ ...r, vv: Math.min(vvMax ?? 9999, vv + 2) }))}
                >
                  +2
                </button>
              }
            />
          )}
        </section>
      )}

      <section className="recipe-list">
        {rows.length === 0 && <p className="muted small">Sin recetas en la hoja. Agrega una abajo.</p>}
        {rows.map((r) => (
          <div key={r.key} className={`recipe ${qtyOf(r.key) ? "" : "empty"}`}>
            <EditableName
              value={extras.names?.[r.key] ?? r.name}
              canEdit={canEditExtras}
              onChange={(v) => updateExtras((x) => ({ ...x, names: setIn(x.names, r.key, v && v !== r.name ? v : undefined) }))}
            />
            <Counter value={qtyOf(r.key)} canEdit={canEditExtras} onChange={(v) => updateExtras((x) => ({ ...x, qty: setIn(x.qty, r.key, v || undefined) }))} />
            {showAA && (
              <button
                className="btn small-btn"
                disabled={!canEditExtras || !canEdit || aa <= 0}
                title="Alquimia avanzada: +1 de este objeto, −1 lote"
                onClick={() => {
                  addQty(r.key, 1);
                  patchRes((x) => ({ ...x, aa: aa - 1 }));
                }}
              >
                AA
              </button>
            )}
            {showVV && (
              <button
                className="btn small-btn"
                disabled={!canEditExtras || !canEdit || vv <= 0}
                title="Alquimia rápida: +1 de este objeto, −1 vial versátil"
                onClick={() => {
                  addQty(r.key, 1);
                  patchRes((x) => ({ ...x, vv: vv - 1 }));
                }}
              >
                AR
              </button>
            )}
            {r.added && canEditExtras && (
              <button
                className="row-x"
                title="Quitar receta"
                onClick={() => updateExtras((x) => ({ ...x, added: (x.added ?? []).filter((a) => a.key !== r.key), qty: setIn(x.qty, r.key, undefined) }))}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </section>

      {canEditExtras && (
        <form
          className="add-row"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name) return;
            updateExtras((x) => ({ ...x, added: [...(x.added ?? []), { key: `rec+${Date.now().toString(36)}`, list: "recipe", name }] }));
            setNewName("");
          }}
        >
          <input placeholder="Nueva receta" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn" disabled={!newName.trim()} title="Agregar receta">
            +
          </button>
        </form>
      )}
    </div>
  );
}
