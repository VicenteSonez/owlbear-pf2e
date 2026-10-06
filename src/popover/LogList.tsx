import { readableColor, type RollEntry } from "../shared";
import { DEGREE_LABEL } from "../rules";

const time = (t: number) =>
  new Date(t).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function LogList({ log, compact }: { log: RollEntry[]; compact?: boolean }) {
  if (!log.length) return compact ? null : <p className="muted">Todavía no hay tiradas en esta sala.</p>;
  return (
    <ul className={`log ${compact ? "compact" : ""}`}>
      {log.map((e) => {
        const note = e.kind === "note";
        const hidden = !note && (Number.isNaN(e.total) || e.total === null);
        return (
          <li key={e.id} className={e.nat === 20 ? "nat20" : e.nat === 1 ? "nat1" : ""}>
            <div>
              <span className="muted">{time(e.time)}</span>{" "}
              <span style={{ color: readableColor(e.playerColor) }}>{e.playerName}</span>
              {e.charName && !compact ? <span className="muted"> ({e.charName})</span> : null} — {e.secret ? "🔒 " : ""}
              {e.title ? (
                <>
                  {e.label} <b>{e.title}</b>
                </>
              ) : (
                e.label
              )}
              {e.targetName ? <span className="muted"> → {e.targetName}</span> : null}
              {note ? (e.detail ? <span className="muted">: {e.detail}</span> : null) : <>: <b>{hidden ? "enviada al GM" : e.total}</b></>}
              {!hidden && e.degree ? <span className={e.degree.includes("success") ? "deg ok" : "deg fail"}> {DEGREE_LABEL[e.degree]}</span> : null}
            </div>
            {!note && !hidden && !compact && (
              <small className="muted">
                {e.formula}: {e.detail}
                {e.notes ? ` · ${e.notes}` : ""}
              </small>
            )}
          </li>
        );
      })}
    </ul>
  );
}
