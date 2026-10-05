// Selectores de color para los efectos visuales de clase y de magia
import { CLASS_FX, MAGIC_DESIGNS, defaultColor, type FxKind } from "../fx";
import type { Extras } from "../extras";

const labelOf = (k: FxKind) => MAGIC_DESIGNS.find((d) => d.id === k)?.label ?? CLASS_FX.find((d) => d.id === k)?.label ?? k;

export function FxColors(props: { kinds: FxKind[]; extras: Extras; canEdit: boolean; updateExtras: (fn: (e: Extras) => Extras) => void }) {
  const { kinds, extras, canEdit, updateExtras } = props;
  if (!kinds.length) return null;
  const colors = extras.cls?.colors ?? {};
  return (
    <div className="fx-colors">
      {kinds.map((k) => (
        <label key={k} className="fx-color" title={`Color del efecto: ${labelOf(k)}`}>
          <input
            type="color"
            value={colors[k] ?? defaultColor(k)}
            disabled={!canEdit}
            onChange={(e) => updateExtras((x) => ({ ...x, cls: { ...x.cls, colors: { ...x.cls?.colors, [k]: e.target.value } } }))}
          />
          <span className="muted small">{labelOf(k)}</span>
        </label>
      ))}
    </div>
  );
}
