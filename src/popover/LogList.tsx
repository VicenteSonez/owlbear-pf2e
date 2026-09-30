import type { RollEntry } from "../shared";

const time = (t: number) =>
  new Date(t).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function LogList({ log, compact }: { log: RollEntry[]; compact?: boolean }) {
  if (!log.length) return compact ? null : <p className="muted">Todavía no hay tiradas en esta sala.</p>;
  return (
    <ul className={`log ${compact ? "compact" : ""}`}>
      {log.map((e) => {
        const hidden = Number.isNaN(e.total) || e.total === null;
        return (
          <li key={e.id} className={e.nat === 20 ? "nat20" : e.nat === 1 ? "nat1" : ""}>
            <div>
              <span className="muted">{time(e.time)}</span>{" "}
              <span style={{ color: e.playerColor }}>{e.playerName}</span>
              {e.charName && !compact ? <span className="muted"> ({e.charName})</span> : null} — {e.secret ? "🔒 " : ""}
              {e.label}: <b>{hidden ? "enviada al GM" : e.total}</b>
            </div>
            {!hidden && !compact && (
              <small className="muted">
                {e.formula}: {e.detail}
              </small>
            )}
          </li>
        );
      })}
    </ul>
  );
}
