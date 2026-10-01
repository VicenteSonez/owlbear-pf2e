import { useEffect, useState, type ReactNode } from "react";

// Nombre de una fila que se puede corregir con el botón ✎
export function EditableName(props: {
  value: string;
  placeholder?: string;
  canEdit: boolean;
  className?: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  if (editing) {
    return (
      <form
        className="ename editing"
        onSubmit={(e) => {
          e.preventDefault();
          props.onChange(text.trim());
          setEditing(false);
        }}
      >
        <input autoFocus value={text} placeholder={props.placeholder} onChange={(e) => setText(e.target.value)} onBlur={() => {
          props.onChange(text.trim());
          setEditing(false);
        }} />
      </form>
    );
  }
  return (
    <span className={`ename ${props.className ?? ""}`}>
      <span
        className={props.value ? "" : "muted"}
        // Un espacio vacío se rellena tocándolo directamente
        onClick={() => props.canEdit && !props.value && setEditing(true)}
      >
        {props.value || props.placeholder || "—"}
      </span>
      {props.canEdit && (
        <button type="button" className="ename-btn" title="Editar nombre" onClick={() => setEditing(true)}>
          ✎
        </button>
      )}
    </span>
  );
}

// Contador − valor + con el número editable
export function Counter(props: { value: number; min?: number; max?: number; canEdit: boolean; onChange: (v: number) => void; title?: string }) {
  const { value, min = 0, max = 9999, canEdit, onChange } = props;
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const set = (n: number) => onChange(Math.max(min, Math.min(max, n)));
  return (
    <span className="counter" title={props.title}>
      <button type="button" disabled={!canEdit || value <= min} onClick={() => set(value - 1)}>
        −
      </button>
      <input
        inputMode="numeric"
        value={text}
        disabled={!canEdit}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={() => {
          const n = parseInt(text, 10);
          if (Number.isFinite(n)) set(n);
          else setText(String(value));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <button type="button" disabled={!canEdit || value >= max} onClick={() => set(value + 1)}>
        +
      </button>
    </span>
  );
}

// Fila de puntos con un ícono propio (foco, espacios de conjuro): encendido = disponible
export function IconPips(props: { value: number; max: number; icon: ReactNode; label: string; canEdit: boolean; onChange: (v: number) => void }) {
  const { value, max, icon, label, canEdit, onChange } = props;
  return (
    <span className="ipips" title={`${label}: ${value}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          type="button"
          className={`ipip ${i < value ? "on" : ""}`}
          disabled={!canEdit}
          aria-label={`${label} ${i + 1}`}
          onClick={() => onChange(value === i + 1 ? i : i + 1)}
        >
          {icon}
        </button>
      ))}
    </span>
  );
}

export function PanelHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="panel-head">
      <h2>{title}</h2>
      {children}
    </header>
  );
}
