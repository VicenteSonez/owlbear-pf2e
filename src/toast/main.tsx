import { StrictMode, useEffect, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { store } from "../storage";
import { TOAST_KEY, type ToastItem } from "../shared";
import { DEGREE_LABEL } from "../rules";
import { watchForUpdates } from "../autoUpdate";
import "../styles.css";

// Tarjetas de tirada en la esquina inferior derecha. El script de fondo decide
// cuándo se abre, cierra y redimensiona esta ventana; aquí solo se dibujan.

function Card({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const e = item.entry;
  const note = e.kind === "note";
  const hidden = !note && (e.total === null || Number.isNaN(e.total));
  const who = e.charName ? `${e.playerName} · ${e.charName}` : e.playerName;
  const degree = e.degree ? `${DEGREE_LABEL[e.degree]}${e.dc ? ` · CD ${e.dc}` : ""}` : "";
  const tag =
    e.secret ? "🔒 secreta" : degree || e.tag || (e.nat === 20 ? "20 natural" : e.nat === 1 ? "1 natural" : e.crit ? "crítico" : "");
  return (
    <div
      className={`toast ${note ? "note" : ""} ${e.nat === 20 ? "nat20" : e.nat === 1 ? "nat1" : ""} ${e.degree ? (e.degree.includes("success") ? "ok" : "fail") : ""}`}
      style={{ "--toast-color": e.diceColor ?? e.playerColor } as CSSProperties}
      onClick={onDismiss}
      title="Clic para cerrar"
    >
      <div className="t-head">
        <span className="dot" style={{ background: e.playerColor }} />
        <span className="t-who">{who}</span>
        {tag && <span className="t-tag">{tag}</span>}
      </div>
      <div className="t-body">
        <div className="t-text">
          <div className="t-label">
            {e.label}
            {e.targetName ? <span className="t-target"> → {e.targetName}</span> : null}
          </div>
          {note && e.detail && <div className="t-detail">{e.detail}</div>}
          {!note && !hidden && (
            <div className="t-detail">
              {e.formula}: {e.detail}
              {e.notes ? ` · ${e.notes}` : ""}
            </div>
          )}
        </div>
        {note ? null : hidden ? <div className="t-secret">🔒 Enviada al GM</div> : <div className="t-total">{e.total}</div>}
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
