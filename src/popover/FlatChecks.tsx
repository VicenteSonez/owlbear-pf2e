import { useState } from "react";

export interface FlatRequest {
  dc: number;
  label: string;
  // La de recuperación cambia el valor de moribundo según el resultado
  recovery?: boolean;
}

interface Props {
  stupefied: number;
  dying: number;
  onFlat: (r: FlatRequest) => void;
  onClose: () => void;
}

export function FlatChecks({ stupefied, dying, onFlat, onClose }: Props) {
  const [custom, setCustom] = useState("");
  const roll = (r: FlatRequest) => {
    onFlat(r);
    onClose();
  };
  return (
    <div className="flat-menu" role="dialog" aria-label="Tiradas planas">
      <div className="ds-head">
        <b>Tirada plana</b>
        <span className="muted small">d20 sin modificadores</span>
        <button className="ds-close" onClick={onClose} title="Cerrar">
          ✕
        </button>
      </div>
      <div className="flat-grid">
        <button className="btn" onClick={() => roll({ dc: 11, label: "Tirada plana CD 11" })}>
          CD 11
        </button>
        <button className="btn" onClick={() => roll({ dc: 5, label: "Tirada plana CD 5" })}>
          CD 5
        </button>
        <form
          className="flat-custom"
          onSubmit={(e) => {
            e.preventDefault();
            const dc = parseInt(custom, 10);
            if (Number.isFinite(dc) && dc > 0) roll({ dc, label: `Tirada plana CD ${dc}` });
          }}
        >
          <input inputMode="numeric" placeholder="CD" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))} />
          <button className="btn">Tirar</button>
        </form>
      </div>
      <div className="flat-grid two">
        <button
          className="btn"
          disabled={!stupefied}
          title={stupefied ? "Al lanzar un conjuro estando estupefacto" : "Solo si está estupefacto"}
          onClick={() => roll({ dc: 5 + stupefied, label: `Estupefacto (lanzar conjuro)` })}
        >
          Estupefacto · CD {5 + stupefied}
        </button>
        <button
          className="btn"
          disabled={!dying}
          title={dying ? "Ajusta moribundo según el resultado" : "Solo si está moribundo"}
          onClick={() => roll({ dc: 10 + dying, label: "Tirada de recuperación", recovery: true })}
        >
          Recuperación · CD {10 + dying}
        </button>
      </div>
    </div>
  );
}
