import { StrictMode, useEffect, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { store } from "../storage";
import { TOAST_KEY, type ToastItem } from "../shared";
import { watchForUpdates } from "../autoUpdate";
import "../styles.css";

// Tarjetas de tirada en la esquina inferior derecha. El script de fondo decide
// cuándo se abre, cierra y redimensiona esta ventana; aquí solo se dibujan.

function Card({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const e = item.entry;
  const hidden = e.total === null || Number.isNaN(e.total);
  const who = e.charName ? `${e.playerName} · ${e.charName}` : e.playerName;
  const tag =
    e.nat === 20 ? "20 natural" : e.nat === 1 ? "1 natural" : e.secret ? "🔒 secreta" : e.crit ? "crítico" : "";
  return (
    <div
      className={`toast ${e.nat === 20 ? "nat20" : e.nat === 1 ? "nat1" : ""}`}
      style={{ "--toast-color": e.diceColor ?? e.playerColor } as CSSProperties}
      onClick={onDismiss}
      title="Clic para cerrar"
    >
      <div className="t-head">
        <span className="dot" style={{ background: e.playerColor }} />
        {who}
        {tag && <span className="t-tag">{tag}</span>}
      </div>
      <div className="t-body">
        <div className="t-text">
          <div className="t-label">{e.label}</div>
          {!hidden && (
            <div className="t-detail">
              {e.formula}: {e.detail}
            </div>
          )}
        </div>
        {hidden ? <div className="t-secret">🔒 Enviada al GM</div> : <div className="t-total">{e.total}</div>}
      </div>
    </div>
  );
}

function Toasts() {
  const [list, setList] = useState<ToastItem[]>(() => store.toasts());

  useEffect(() => {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === TOAST_KEY) setList(store.toasts());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const write = (next: ToastItem[]) => {
    store.setToasts(next);
    setList(next);
  };

  return (
    <div className="toasts">
      {list.length > 1 && (
        <button className="toast-clear" onClick={() => write([])}>
          LIMPIAR ✕
        </button>
      )}
      {list.map((item) => (
        <Card
          key={item.entry.id}
          item={item}
          onDismiss={() => write(store.toasts().filter((x) => x.entry.id !== item.entry.id))}
        />
      ))}
    </div>
  );
}

watchForUpdates();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Toasts />
  </StrictMode>,
);
