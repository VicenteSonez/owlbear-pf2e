// Piezas pequeñas de interfaz que se repiten en la hoja y en el panel del GM
import { activeConditionIcons, type Conditions } from "../rules";

export const iconUrl = (name: string) => `icons/cond/${name}.svg`;

export function CondIcon({ icon, label, value, size = 20 }: { icon: string; label: string; value?: number; size?: number }) {
  return (
    <span className="cond-icon" title={value ? `${label} ${value}` : label}>
      <img src={iconUrl(icon)} alt={label} width={size} height={size} />
      {value ? <b>{value}</b> : null}
    </span>
  );
}

export function ConditionRow({ cond, size }: { cond?: Conditions; size?: number }) {
  const icons = activeConditionIcons(cond);
  if (!icons.length) return null;
  return (
    <div className="cond-row">
      {icons.map((c, i) => (
        <CondIcon key={i} icon={c.icon} label={c.label} value={c.value} size={size} />
      ))}
    </div>
  );
}

// Contador de puntos clicable: pulsar un punto fija el valor; pulsar el último encendido lo apaga
export function Pips(props: {
  value: number;
  max: number;
  icon: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onChange: (v: number) => void;
}) {
  const { value, max, icon, label, disabled, danger, onChange } = props;
  return (
    <span className={`pips ${danger ? "danger" : ""}`} title={`${label}: ${value}`}>
      <img src={iconUrl(icon)} alt="" width={16} height={16} />
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          type="button"
          className={`pip ${i < value ? "on" : ""}`}
          disabled={disabled}
          aria-label={`${label} ${i + 1}`}
          onClick={() => onChange(value === i + 1 ? i : i + 1)}
        />
      ))}
    </span>
  );
}
