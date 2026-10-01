import { DIRS } from "../fx";

// Rosa de 8 direcciones para los efectos de ataque; el centro los activa o apaga
const GRID = [7, 0, 1, 6, -1, 2, 5, 4, 3];

export function FxDir({ dir, on, onChange }: { dir: number; on: boolean; onChange: (p: { dir: number; on: boolean }) => void }) {
  return (
    <div className={`fx-dir ${on ? "" : "off"}`} title="Dirección del efecto de ataque en el mapa">
      {GRID.map((d, i) =>
        d < 0 ? (
          <button
            key={i}
            className={`fx-center ${on ? "on" : ""}`}
            title={on ? "Efectos activos (clic para apagar)" : "Efectos apagados (clic para activar)"}
            onClick={() => onChange({ dir, on: !on })}
          >
            ✦
          </button>
        ) : (
          <button key={i} className={dir === d && on ? "on" : ""} title={DIRS[d].label} onClick={() => onChange({ dir: d, on: true })}>
            {DIRS[d].arrow}
          </button>
        ),
      )}
    </div>
  );
}
