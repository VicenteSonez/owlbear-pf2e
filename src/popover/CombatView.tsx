import { useEffect, useState } from "react";
import type { Character } from "../pathbuilder";
import type { PcState } from "../live";
import { DEATH_DYING, effectiveMaxHp } from "../rules";
import { hpColor, npcLabel, npcPlayerView, type NpcState } from "../shared";
import { NpcHpBar } from "./NpcStatus";
import type { Combat, Entry } from "../combat";
import { ConditionRow, CondIcon } from "./bits";
import { InitPanel, type InitOption } from "./Initiative";
import type { CombatActions } from "./useCombatActions";

interface Props {
  combat: Combat;
  entries: Entry[];
  isGm: boolean;
  own?: Character;
  ownState?: PcState;
  // Estado de los PNJ con token, para que el GM vea sus PG
  npcStates: Record<string, NpcState>;
  allPcs: PcState[];
  actions: CombatActions;
  onRollInit: (opt: InitOption, winsTies: boolean) => void;
}

function InitInput({ value, onCommit }: { value: number | null; onCommit: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const t = text.trim();
    const n = parseInt(t, 10);
    if (t === "") onCommit(null);
    else if (Number.isFinite(n)) onCommit(n);
    else setText(value === null ? "" : String(value));
  };
  return (
    <input
      className="ie-input"
      inputMode="numeric"
      value={text}
      placeholder="—"
      title="Iniciativa (editable)"
      onChange={(e) => setText(e.target.value.replace(/[^\d-]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function HpBar({ hp, max, dying }: { hp: number; max: number; dying?: number }) {
  const pct = Math.max(0, Math.min(100, (hp / Math.max(1, max)) * 100));
  return (
    <div className="mini-bar ie-bar">
      <div style={{ width: `${pct}%`, background: hpColor(hp, max) }} />
      <span>
        {dying && dying >= DEATH_DYING ? "MUERTO" : `${hp}/${max}`}
      </span>
    </div>
  );
}

export function CombatView({ combat, entries, isGm, own, ownState, npcStates, allPcs, actions, onRollInit }: Props) {
  const [name, setName] = useState("");
  const [mod, setMod] = useState("");
  const [msg, setMsg] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const modValue = parseInt(mod, 10) || 0;
  const visible = isGm ? entries : entries.filter((e) => !e.hidden);
  const current = entries.find((e) => e.key === combat.current);
  const showList = isGm || combat.active;
  const excluded = allPcs.filter((s) => combat.excluded.includes(s.id));

  const report = (n: number, what: string) => {
    setMsg(n ? `${n} agregado${n > 1 ? "s" : ""}.` : what);
    window.setTimeout(() => setMsg(""), 5000);
  };

  return (
    <div className="combat">
      <header className="combat-head">
        {combat.active ? (
          <>
            <div className="round">
              <small>Ronda</small>
              <b>{combat.round || "—"}</b>
            </div>
            <div className="turn-of">
              <small>{current ? "Turno de" : "Combate iniciado"}</small>
              <b>{current && (isGm || !current.hidden) ? current.name : current ? "???" : isGm ? "Pulsa Empezar para la ronda 1" : "Esperando al GM"}</b>
            </div>
          </>
        ) : (
          <div className="turn-of">
            <small>Combate</small>
            <b>{isGm ? "Sin combate activo" : "El GM aún no inicia el combate"}</b>
          </div>
        )}
        {isGm && (
          <div className="combat-ctl">
            {!combat.active && (
              <button className="btn primary" onClick={actions.start}>
                Iniciar combate
              </button>
            )}
            {combat.active && (
              <>
                <button className="btn" title="Turno anterior (sin efectos)" onClick={() => actions.step(-1)} disabled={!combat.current}>
                  ◀
                </button>
                <button className="btn primary" onClick={() => actions.step(1)} title="Aplica el fin de turno y empieza el siguiente">
                  {combat.current ? "Siguiente turno ▶" : "Empezar ▶"}
                </button>
                {confirmEnd ? (
                  <>
                    <button className="btn danger" onClick={() => { setConfirmEnd(false); actions.end(); }}>
                      Sí, terminar
                    </button>
                    <button className="btn ghost" onClick={() => setConfirmEnd(false)}>
                      No
                    </button>
                  </>
                ) : (
                  <button className="btn ghost" onClick={() => setConfirmEnd(true)} title="Borra la iniciativa y los PNJ de la lista">
                    Terminar
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </header>

      {own && <InitPanel character={own} state={ownState} onRoll={onRollInit} inline />}

      {showList && (
        <div className="init-list">
          {visible.length === 0 && <p className="muted small">Nadie en la iniciativa todavía.</p>}
          {visible.map((e, i) => {
            const turn = e.key === combat.current;
            const npc = e.tokenId ? npcStates[e.tokenId] : undefined;
            // Los jugadores ven del PNJ lo que el GM deje (barra sin números y estados, por defecto)
            const cond = e.pc ? e.pc.cond : npc && (isGm || npcPlayerView(npc) !== "none") ? npc.cond : undefined;
            return (
              <div key={e.key} className={`init-entry ${e.kind} ${turn ? "turn" : ""} ${e.init === null ? "pending" : ""}`}>
                <span className="ie-marker">{turn ? "▶" : ""}</span>
                {isGm ? <InitInput value={e.init} onCommit={(v) => actions.setInit(e, v)} /> : <b className="ie-init">{e.init ?? "—"}</b>}
                <div className="ie-main">
                  <div className="ie-name">
                    <b>{npc ? npcLabel({ name: e.name, num: npc.num, nick: npc.nick }) : e.name}</b>
                    {e.kind === "npc" && <span className="badge">PNJ</span>}
                    {e.hidden && <span className="badge">oculto</span>}
                    {e.pc?.init?.winsTies && (
                      <span className="ie-tag" title="Gana los empates">
                        ★
                      </span>
                    )}
                    {e.pc?.init && <span className="ie-sub">{e.pc.init.label}</span>}
                    {e.npc && isGm && <span className="ie-sub">mod {e.npc.mod >= 0 ? `+${e.npc.mod}` : e.npc.mod}</span>}
                    {e.pc && e.pc.dying > 0 && (
                      <CondIcon icon={e.pc.dying >= DEATH_DYING ? "dead" : "dying"} label="Moribundo" value={e.pc.dying} size={15} />
                    )}
                    {e.pc && e.pc.wounded > 0 && <CondIcon icon="wounded" label="Herido" value={e.pc.wounded} size={15} />}
                  </div>
                  {e.pc && <HpBar hp={e.pc.hp} max={effectiveMaxHp(e.pc.maxHp, e.pc.level, e.pc.cond)} dying={e.pc.dying} />}
                  {npc && <NpcHpBar state={npc} compact />}
                  <ConditionRow cond={cond} size={15} />
                </div>
                {isGm && (
                  <div className="ie-tools">
                    <button title="Subir" disabled={i === 0} onClick={() => actions.move(e, -1)}>
                      ▲
                    </button>
                    <button title="Bajar" disabled={i === visible.length - 1} onClick={() => actions.move(e, 1)}>
                      ▼
                    </button>
                    {e.npc && (
                      <button title={`Volver a tirar (d20${e.npc.mod >= 0 ? "+" : ""}${e.npc.mod})`} onClick={() => actions.reroll(e)}>
                        🎲
                      </button>
                    )}
                    {e.npc && (
                      <button title={e.hidden ? "Mostrar a los jugadores" : "Ocultar a los jugadores"} onClick={() => actions.toggleHidden(e)}>
                        {e.hidden ? "🙈" : "👁"}
                      </button>
                    )}
                    <button title="Quitar de la iniciativa" onClick={() => actions.remove(e)}>
                      ✕
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isGm && (
        <section className="combat-add">
          <h3>Agregar criaturas</h3>
          <form
            className="ca-row"
            onSubmit={async (ev) => {
              ev.preventDefault();
              if (!name.trim()) return;
              report(await actions.addByName(name.trim(), modValue), "");
              setName("");
            }}
          >
            <input className="ca-name" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
            <input
              className="ca-mod"
              placeholder="Mod"
              title="Modificador de iniciativa (Percepción del PNJ)"
              value={mod}
              onChange={(e) => setMod(e.target.value.replace(/[^\d+-]/g, ""))}
            />
            <button className="btn" disabled={!name.trim()}>
              Agregar y tirar
            </button>
          </form>
          <div className="ca-row">
            <button className="btn ghost" onClick={async () => report(await actions.addSelected(modValue), "Nada nuevo: selecciona tokens en el mapa (que no estén ya en la lista).")}>
              + Tokens seleccionados
            </button>
            <button className="btn ghost" onClick={async () => report(await actions.addSceneNpcs(modValue), "No hay PNJ nuevos en la escena.")}>
              + PNJ de la escena
            </button>
          </div>
          <p className="muted small">Se tira d20 + Mod para cada uno; la tirada solo la ves tú.</p>
          {msg && <p className="ca-msg">{msg}</p>}
          {excluded.length > 0 && (
            <div className="ca-excluded">
              <span className="muted small">PJ fuera de la iniciativa:</span>
              {excluded.map((s) => (
                <button key={s.id} className="chip" onClick={() => actions.include(s.id)}>
                  + {s.name}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
