import { DICE_COLORS, DICE_THEMES, type DiceStyle } from "../dice";

interface Props {
  style: DiceStyle;
  onChange: (s: DiceStyle) => void;
  onTest: () => void;
  onClose: () => void;
}

export function DiceSettings({ style, onChange, onTest, onClose }: Props) {
  const theme = DICE_THEMES.find((t) => t.id === style.theme) ?? DICE_THEMES[0];
  return (
    <div className="dice-settings" role="dialog" aria-label="Estilo de los dados">
      <div className="ds-head">
        <b>Tus dados</b>
        <button className="ds-close" onClick={onClose} title="Cerrar">
          ✕
        </button>
      </div>
      <div className="ds-label">Tema</div>
      <div className="ds-themes">
        {DICE_THEMES.map((t) => (
          <button
            key={t.id}
            className={`chip ${t.id === style.theme ? "on" : ""}`}
            onClick={() => onChange({ ...style, theme: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ds-label">
        Color {!theme.colorable && <span className="muted small">(este tema trae sus propios colores)</span>}
      </div>
      <div className={`ds-colors ${theme.colorable ? "" : "disabled"}`}>
        {DICE_COLORS.map((c) => (
          <button
            key={c}
            className={`swatch ${c === style.color ? "on" : ""}`}
            style={{ background: c }}
            title={c}
            disabled={!theme.colorable}
            onClick={() => onChange({ ...style, color: c })}
          />
        ))}
        <label className="swatch custom" title="Otro color" style={{ background: style.color }}>
          <input
            type="color"
            value={style.color}
            disabled={!theme.colorable}
            onChange={(e) => onChange({ ...style, color: e.target.value })}
          />
          +
        </label>
      </div>
      <button className="btn ds-test" onClick={onTest}>
        Probar con un d20
      </button>
    </div>
  );
}
