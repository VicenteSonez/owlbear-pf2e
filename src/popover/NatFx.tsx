import { useMemo, type CSSProperties } from "react";

// Efecto de 20 o 1 natural sobre la zona de dados.
// La clave hace que la animación se reinicie con cada tirada.
export function NatFx({ nat }: { nat: 1 | 20 }) {
  const sparks = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        angle: (360 / 22) * i + Math.random() * 10,
        dist: 70 + Math.random() * 90,
        delay: Math.random() * 120,
        size: 3 + Math.random() * 4,
      })),
    [],
  );

  if (nat === 1) {
    return (
      <div className="nat-fx nat1" aria-hidden>
        <div className="vignette" />
        <svg className="cracks" viewBox="0 0 200 200" preserveAspectRatio="none">
          <path d="M100 96 L78 60 L84 40 L66 8" />
          <path d="M100 96 L128 70 L150 72 L182 40" />
          <path d="M100 96 L92 132 L106 158 L96 196" />
          <path d="M100 96 L60 108 L34 100 L4 122" />
          <path d="M100 96 L140 120 L170 150" />
        </svg>
        <div className="nat-text">1 NATURAL</div>
      </div>
    );
  }

  return (
    <div className="nat-fx nat20" aria-hidden>
      <div className="burst" />
      <div className="ring" />
      {sparks.map((s, i) => (
        <i
          key={i}
          style={
            {
              "--a": `${s.angle}deg`,
              "--d": `${s.dist}px`,
              "--delay": `${s.delay}ms`,
              "--s": `${s.size}px`,
            } as CSSProperties
          }
        />
      ))}
      <div className="nat-text">¡20 NATURAL!</div>
    </div>
  );
}
