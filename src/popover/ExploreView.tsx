import { useState } from "react";
import { fmtMod, type Character } from "../pathbuilder";
import { live, type PcState } from "../live";
import { inOwlbear } from "../obr";
import { EXPLORE_ACTS, hasAct, isRecallSkill, scoutBonus, scoutValue, speedText, toggleAct, type ExploreAct } from "../explore";
import { initFormula, initOptions } from "./Initiative";
import { useActions } from "./ctx";

interface Props {
  states: Record<string, PcState>;
  sheets: Record<string, Character>;
  own?: Character;
  combatActive: boolean;
  // GM: compara ahora el Sigilo de iniciativa con la Percepción de los PNJ del combate
  onAvoidNotice: () => Promise<number>;
}

export function ExploreView({ states, sheets, own, combatActive, onAvoidNotice }: Props) {
  const { roll, isGm, meId } = useActions();
  const [msg, setMsg] = useState("");
  // GM: habilidad elegida para Recordar conocimiento de cada PJ
  const [recall, setRecall] = useState<Record<string, string>>({});
  const [gear, setGear] = useState<string | null>(null);

  const pcs = Object.values(states)
    .filter((s) => !s.pet)
    .sort((a, b) => Number(b.id === own?.id) - Number(a.id === own?.id) || a.name.localeCompare(b.name));
  const scout = scoutBonus(pcs);
  const scouts = pcs.filter((s) => hasAct(s, "scout"));

  const report = (text: string) => {
    setMsg(text);
    window.setTimeout(() => setMsg(""), 5000);
  };

  // Tirada secreta de una habilidad del PJ (con sus condiciones): solo el GM ve el resultado
  const secretCheck = async (s: PcState, key: string, why: string) => {
    const c = sheets[s.id];
    const opt = c && initOptions(c).find((o) => o.key === key);
    if (!c || !opt) return;
    const f = initFormula(opt, live.get(s.id));
    await roll(
      { label: `${why} · exploración`, title: opt.label, formula: f.formula, kind: "check", notes: f.notes, secret: true, charName: c.name, charId: c.id, tag: "Exploración" },
      { quick: true },
    );
  };

  const toggle = async (s: PcState, a: ExploreAct) => {
    const on = !hasAct(s, a);
    await live.patch(s.id, (x) => toggleAct(x, a));
    // Buscar y Pasar desapercibido tiran al momento, en secreto
    if (on && a === "search") await secretCheck(s, "perception", "Buscar");
    if (on && a === "avoid") await secretCheck(s, "stealth", "Pasar desapercibido");
  };

  const groupCheck = async (a: ExploreAct, key: string, why: string) => {
    const list = pcs.filter((s) => hasAct(s, a) && sheets[s.id]);
    for (const s of list) await secretCheck(s, key, why);
    report(list.length ? `${list.length} tirada${list.length > 1 ? "s" : ""} secreta${list.length > 1 ? "s" : ""}.` : "Nadie con esa actividad (o falta su hoja).");
  };

  return (
    <div className="explore">
      <header className="ex-top">
        <h2>🧭 Exploración</h2>
        <p className="muted small">Cada PJ elige una o más actividades mientras viaja. Sus efectos se aplican al tirar iniciativa y al empezar el combate.</p>
        {scout > 0 && (
          <div className="ex-banner">
            👁 Atento: <b>+{scout}</b> circunstancial a la iniciativa de todos los PJ
            <span className="muted"> ({scouts.map((s) => s.name).join(", ")})</span>
          </div>
        )}
      </header>

      {isGm && (
        <section className="ex-gm">
          <h3>Tiradas secretas del GM</h3>
          <div className="ex-gm-row">
            <button className="btn" onClick={() => groupCheck("search", "perception", "Buscar")}>
              🧭 Percepción · quienes Buscan
            </button>
            <button className="btn" onClick={() => groupCheck("avoid", "stealth", "Pasar desapercibido")}>
              👣 Sigilo · quienes pasan desapercibidos
            </button>
          </div>
          {combatActive && (
            <div className="ex-gm-row">
              <button
                className="btn ghost"
                title="Se hace solo al pulsar Empezar en el combate; úsalo si alguien tiró después"
                onClick={async () => {
                  const n = await onAvoidNotice();
                  report(n ? `Revisados ${n} PJ con Sigilo de iniciativa.` : "Nadie tiró Sigilo de iniciativa, o no hay PNJ con token en el combate.");
                }}
              >
                Comparar Sigilo de iniciativa con los PNJ
              </button>
            </div>
          )}
          {msg && <p className="ca-msg">{msg}</p>}
        </section>
      )}

      {pcs.length === 0 && <p className="muted small ex-empty">No hay personajes en la sala todavía.</p>}

      {pcs.map((s) => {
        const c = sheets[s.id];
        const editable = !inOwlbear || isGm || s.owner === meId;
        const mine = s.id === own?.id;
        const acts = EXPLORE_ACTS.filter((d) => hasAct(s, d.id));
        const recallOpts = c ? initOptions(c).filter((o) => isRecallSkill(o.key)) : [];
        const best = [...recallOpts].sort((a, b) => b.base - a.base)[0];
        const recallKey = recall[s.id] ?? best?.key;
        return (
          <section key={s.id} className={`ex-card ${mine ? "mine" : ""}`}>
            <div className="ex-head">
              <b>{s.name}</b>
              {mine && <span className="badge">tú</span>}
              {!mine && s.ownerName && <span className="muted small">{s.ownerName}</span>}
              {!editable && (
                <span className="ex-chips">
                  {acts.length ? acts.map((d) => <span key={d.id} className="chip on">{d.icon} {d.label}</span>) : <span className="muted small">Sin actividad</span>}
                </span>
              )}
            </div>

            {editable &&
              EXPLORE_ACTS.map((d) => {
                const on = hasAct(s, d.id);
                return (
                  <div key={d.id} className={`ex-act ${on ? "on" : ""}`}>
                    <label>
                      <input type="checkbox" checked={on} onChange={() => toggle(s, d.id)} />
                      <span className="ex-icon">{d.icon}</span>
                      <span className="ex-text">
                        <b>{d.label}</b> <small className="muted">({d.en})</small>
                        <span className="ex-desc">{d.desc}</span>
                        <small className="ex-speed">🚶 {speedText(d, c?.speed)}</small>
                      </span>
                    </label>
                    {d.id === "scout" && (
                      <button className="ex-gear" title="Bono mayor (dotes)" onClick={() => setGear((g) => (g === s.id ? null : s.id))}>
                        ⚙ +{scoutValue(s)}
                      </button>
                    )}
                    {d.id === "scout" && gear === s.id && (
                      <div className="ex-gear-box">
                        Bono de Atento
                        {[1, 2, 3, 4].map((v) => (
                          <button
                            key={v}
                            className={`chip ${scoutValue(s) === v ? "on" : ""}`}
                            onClick={() => live.patch(s.id, (x) => ({ ...x, explore: { acts: x.explore?.acts ?? [], scout: v > 1 ? v : undefined } }))}
                          >
                            +{v}
                          </button>
                        ))}
                      </div>
                    )}
                    {d.id === "defend" && on && !s.shield && <small className="ex-warn">No tiene escudo en la hoja.</small>}
                  </div>
                );
              })}

            {isGm && c && acts.some((d) => d.id === "investigate" || d.id === "search" || d.id === "avoid") && (
              <div className="ex-rolls">
                {hasAct(s, "investigate") && recallOpts.length > 0 && (
                  <span className="ex-recall">
                    <select value={recallKey} onChange={(e) => setRecall((r) => ({ ...r, [s.id]: e.target.value }))} title="Habilidad para Recordar conocimiento">
                      {recallOpts.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label} {fmtMod(o.base)}
                        </option>
                      ))}
                    </select>
                    <button className="btn small-btn" onClick={() => recallKey && secretCheck(s, recallKey, "Investigar")}>
                      🔎 Conocimiento
                    </button>
                  </span>
                )}
                {hasAct(s, "search") && (
                  <button className="btn small-btn" onClick={() => secretCheck(s, "perception", "Buscar")}>
                    🧭 Percepción
                  </button>
                )}
                {hasAct(s, "avoid") && (
                  <button className="btn small-btn" onClick={() => secretCheck(s, "stealth", "Pasar desapercibido")}>
                    👣 Sigilo
                  </button>
                )}
              </div>
            )}
            {isGm && !c && acts.length > 0 && <p className="muted small">Falta su hoja para tirar por este PJ: el jugador tiene que estar conectado.</p>}
          </section>
        );
      })}
    </div>
  );
}
