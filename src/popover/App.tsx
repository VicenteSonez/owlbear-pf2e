import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { damageFormula, fmtMod, type Character, type Weapon } from "../pathbuilder";
import { Dice3D, evaluate, parseFormula, randomValues, type DiceStyle } from "../dice";
import { autoLinkCandidate, inOwlbear, linkToken, unlinkToken } from "../obr";
import { store } from "../storage";
import { newId, type RollEntry } from "../shared";
import { playerMeta, useParty, useRollLog, useSession, useVitals } from "./hooks";
import { Importer } from "./Importer";
import { SheetTabs } from "./SheetTabs";
import { Vitals } from "./Vitals";
import { LogList } from "./LogList";
import { DiceSettings } from "./DiceSettings";
import { NatFx } from "./NatFx";

const dice = new Dice3D();

export interface RollRequest {
  label: string;
  formula: string;
  kind: RollEntry["kind"];
  crit?: boolean;
}

interface Current {
  label: string;
  formula: string;
  total?: number;
  detail?: string;
  nat?: 1 | 20;
  secret?: boolean;
  rolling: boolean;
}

// Zona grande donde ruedan los dados, encima de la parte baja de la hoja
interface Overlay {
  phase: "hidden" | "rolling" | "result";
  key: number;
  label: string;
  formula?: string;
  total?: number;
  detail?: string;
  nat?: 1 | 20;
}

const OVERLAY_MS = 1700;
const OVERLAY_NAT_MS = 2900;

type View = "sheet" | "party" | "import";

export function App() {
  const session = useSession();
  const [characters, setCharacters] = useState<Character[]>(() => store.characters());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>("sheet");
  const [remoteId, setRemoteId] = useState<string | null>(null);
  const isGm = session.me.role === "GM";
  const party = useParty(session.ready && isGm);

  useEffect(() => {
    if (!session.ready) return;
    const id = store.activeId(session.room);
    const exists = characters.some((c) => c.id === id);
    setActiveId(exists ? id : null);
    if (!exists) setView("import");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.ready, session.room]);

  const own = useMemo(() => characters.find((c) => c.id === activeId), [characters, activeId]);

  // El GM puede abrir la hoja de otro jugador desde "Grupo"
  const remotePlayer = party.find((p) => p.id === remoteId);
  const remoteMeta = remotePlayer ? playerMeta(remotePlayer) : undefined;
  const remoteChar = remoteMeta?.character;
  const remoteKey = remoteChar ? `${remoteChar.id}:${remoteChar.importedAt}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRemote = useMemo(() => remoteChar, [remoteKey]);

  const showingRemote = view === "sheet" && !!stableRemote;
  const character = showingRemote ? stableRemote : own;
  const vit = useVitals(character, showingRemote ? "remote" : "own", showingRemote ? remoteMeta?.vitals : undefined);

  const { log, publish, clear } = useRollLog(session);

  const selectCharacter = useCallback(
    (id: string | null) => {
      store.setActiveId(session.room, id);
      setActiveId(id);
      setRemoteId(null);
      if (id) setView("sheet");
    },
    [session.room],
  );

  const onImported = useCallback(
    async (c: Character) => {
      store.saveCharacter(c);
      setCharacters(store.characters());
      selectCharacter(c.id);
      if (!inOwlbear) return;
      // Reconocimiento automático: busca el token del personaje en el mapa
      const cand = await autoLinkCandidate(c);
      if (cand) {
        await linkToken(cand.id, c, store.vitals(c));
        OBR.notification.show(`${c.name} vinculado a "${cand.name}".`, "SUCCESS");
      }
    },
    [selectCharacter],
  );

  const onDeleted = useCallback(
    (id: string) => {
      store.removeCharacter(id);
      setCharacters(store.characters());
      if (id === activeId) selectCharacter(null);
    },
    [activeId, selectCharacter],
  );

  // ---------- Dados ----------
  const [current, setCurrent] = useState<Current | null>(null);
  const [secret, setSecret] = useState(false);
  const [extra, setExtra] = useState(0);
  const [freeText, setFreeText] = useState("");
  const [diceStyle, setDiceStyle] = useState<DiceStyle>(() => store.diceStyle());
  const [showDiceSettings, setShowDiceSettings] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>({ phase: "hidden", key: 0, label: "" });
  const busy = useRef(false);
  const rollKey = useRef(0);
  const hideTimer = useRef<number | undefined>(undefined);
  const overlayPhase = useRef<Overlay["phase"]>("hidden");

  useEffect(() => {
    dice.setStyle(diceStyle);
  }, [diceStyle]);

  useEffect(() => {
    dice.init("#dice-stage");
  }, []);

  // dice-box mide el canvas al redimensionar la ventana; si estaba oculto, forzamos la medida
  const sheetVisible = view === "sheet" && !!character;
  useEffect(() => {
    if (sheetVisible) requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }, [sheetVisible]);

  const showOverlay = useCallback((next: Overlay) => {
    window.clearTimeout(hideTimer.current);
    overlayPhase.current = next.phase;
    setOverlay(next);
    if (next.phase === "result") {
      hideTimer.current = window.setTimeout(
        () => {
          overlayPhase.current = "hidden";
          setOverlay((o) => ({ ...o, phase: "hidden" }));
        },
        next.nat ? OVERLAY_NAT_MS : OVERLAY_MS,
      );
    }
  }, []);

  // Cualquier clic esconde los dados una vez que ya se ve el resultado
  useEffect(() => {
    const onDown = () => {
      if (overlayPhase.current !== "result") return;
      window.clearTimeout(hideTimer.current);
      overlayPhase.current = "hidden";
      setOverlay((o) => ({ ...o, phase: "hidden" }));
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  // Solo en desarrollo: permite probar los efectos de 20/1 natural desde la consola
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __pf2: unknown }).__pf2 = {
      showOverlay,
      setOverlay,
      setCurrent,
      holdOverlay: () => window.clearTimeout(hideTimer.current),
    };
  }, [showOverlay]);

  const changeDiceStyle = useCallback((s: DiceStyle) => {
    setDiceStyle(s);
    store.setDiceStyle(s);
  }, []);

  const roll = useCallback(
    async (req: RollRequest, opts: { preview?: boolean } = {}) => {
      if (busy.current) return;
      let formula = req.formula;
      if (req.kind === "check" && extra) formula += fmtMod(extra);
      let f;
      try {
        f = parseFormula(formula);
      } catch (err) {
        if (inOwlbear) OBR.notification.show(String((err as Error).message), "ERROR");
        return;
      }
      busy.current = true;
      // Un jugador no ve su tirada secreta: ni animación ni resultado
      const isSecret = secret && !opts.preview;
      const hideFromMe = isSecret && !isGm;
      const key = ++rollKey.current;
      setCurrent({ label: req.label, formula, rolling: true, secret: isSecret });
      if (!hideFromMe) showOverlay({ phase: "rolling", key, label: req.label });
      try {
        const values = hideFromMe ? randomValues(f) : await dice.roll(f);
        const out = evaluate(f, values, { crit: req.crit, check: req.kind !== "damage" });
        const shownFormula = req.crit ? `2×(${formula})` : formula;
        if (!hideFromMe) {
          showOverlay({ phase: "result", key, label: req.label, formula: shownFormula, total: out.total, detail: out.detail, nat: out.nat });
        }
        setCurrent(
          hideFromMe
            ? { label: req.label, formula, rolling: false, secret: true }
            : { label: req.label, formula: shownFormula, total: out.total, detail: out.detail, nat: out.nat, secret: isSecret, rolling: false },
        );
        if (opts.preview) return;
        const entry: RollEntry = {
          id: newId(),
          time: Date.now(),
          playerId: session.me.id,
          playerName: session.me.name,
          playerColor: session.me.color,
          charName: character?.name,
          label: req.label,
          formula: shownFormula,
          detail: out.detail,
          total: out.total,
          kind: req.kind,
          nat: out.nat,
          crit: req.crit,
          secret: isSecret || undefined,
          diceColor: diceStyle.color,
        };
        await publish(entry);
      } finally {
        busy.current = false;
      }
    },
    [extra, secret, isGm, session.me, character?.name, publish, showOverlay, diceStyle.color],
  );

  const rollWeapon = useCallback(
    (w: Weapon, what: "attack" | "damage" | "crit", mapIndex = 0, bonus = w.attack) => {
      if (what === "attack") {
        const mapTxt = ["1er ataque", "2º ataque", "3er ataque"][mapIndex];
        roll({ label: `${w.name}: ${mapTxt}`, formula: `1d20${fmtMod(bonus)}`, kind: "check" });
      } else {
        roll({
          label: `${w.name}: ${what === "crit" ? "Crítico" : "Daño"}${w.damageType ? ` (${w.damageType})` : ""}`,
          formula: damageFormula(w),
          kind: "damage",
          crit: what === "crit",
        });
      }
    },
    [roll],
  );

  const freeRoll = (formula: string) => roll({ label: "Tirada libre", formula, kind: "free" });

  if (!session.ready) return <div className="loading">Conectando con Owlbear…</div>;

  return (
    <div className="app">
      <nav className="topnav">
        <button className={view === "sheet" && !showingRemote ? "on" : ""} onClick={() => { setRemoteId(null); setView(own ? "sheet" : "import"); }}>
          {own ? own.name : "Mi hoja"}
        </button>
        {isGm && (
          <button className={view === "party" ? "on" : ""} onClick={() => setView("party")}>
            Grupo
          </button>
        )}
        {showingRemote && <button className="on">{stableRemote!.name}</button>}
        <button className={`icon ${view === "import" ? "on" : ""}`} title="Personajes / importar" onClick={() => setView("import")}>
          ⚙
        </button>
      </nav>

      {view === "import" && (
        <Importer characters={characters} activeId={activeId} onImported={onImported} onSelect={selectCharacter} onDelete={onDeleted} />
      )}

      {view === "party" && (
        <PartyView players={party} onOpen={(id) => { setRemoteId(id); setView("sheet"); }} />
      )}

      <div className={view === "sheet" && character ? "sheet" : "sheet hidden"}>
        {character && vit.vitals && (
          <Vitals
            character={character}
            vitals={vit.vitals}
            canEdit={vit.canEdit}
            token={vit.token}
            remote={showingRemote}
            onUpdate={vit.update}
            onLink={async () => {
              if (!inOwlbear) return;
              const sel = await OBR.player.getSelection();
              if (sel?.length === 1) {
                await vit.link(sel[0]);
                return;
              }
              const cand = await autoLinkCandidate(character);
              if (cand) await vit.link(cand.id);
              else OBR.notification.show("Selecciona tu token en el mapa y vuelve a pulsar Vincular.", "INFO");
            }}
            onUnlink={() => vit.token && unlinkToken(vit.token.id)}
          />
        )}

        <div className="sheet-body">
          <div className="sheet-scroll">
            <section className="roller">
              <div className="dice-row">
                {[4, 6, 8, 10, 12, 20].map((s) => (
                  <button key={s} className="btn dice" onClick={() => freeRoll(`1d${s}`)}>
                    d{s}
                  </button>
                ))}
                <button
                  className={`btn dice palette ${showDiceSettings ? "on" : ""}`}
                  title="Color y tema de tus dados"
                  onClick={() => setShowDiceSettings((v) => !v)}
                >
                  <span className="palette-dot" style={{ background: diceStyle.color }} />
                </button>
              </div>
              {showDiceSettings && (
                <DiceSettings
                  style={diceStyle}
                  onChange={changeDiceStyle}
                  onClose={() => setShowDiceSettings(false)}
                  onTest={() => roll({ label: "Prueba de dados", formula: "1d20", kind: "free" }, { preview: true })}
                />
              )}
              <div className={`result-bar ${current?.nat === 20 ? "nat20" : current?.nat === 1 ? "nat1" : ""}`}>
                <div className="rb-label">{current?.label ?? "Elige una tirada"}</div>
                {current?.rolling && <div className="rb-rolling">Tirando…</div>}
                {current && !current.rolling && current.total === undefined && (
                  <div className="rb-secret">🔒 Enviada al GM</div>
                )}
                {current && !current.rolling && current.total !== undefined && (
                  <div className="rb-main">
                    <b>{current.total}</b>
                    <small>
                      {current.formula}: {current.detail}
                      {current.nat === 20 ? " · ¡20 natural!" : current.nat === 1 ? " · 1 natural" : ""}
                    </small>
                  </div>
                )}
              </div>
              <div className="roll-opts">
                <label className="mod">
                  Mod.
                  <button type="button" onClick={() => setExtra((n) => n - 1)}>−</button>
                  <span className={extra ? "active" : ""}>{fmtMod(extra)}</span>
                  <button type="button" onClick={() => setExtra((n) => n + 1)}>+</button>
                  {extra !== 0 && (
                    <button type="button" className="reset" onClick={() => setExtra(0)} title="Quitar modificador">
                      ×
                    </button>
                  )}
                </label>
                <form
                  className="free-inline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (freeText.trim()) freeRoll(freeText.trim());
                  }}
                >
                  <input value={freeText} placeholder="2d6+3" title="Tirada libre" onChange={(e) => setFreeText(e.target.value)} />
                  <button className="btn" title="Tirar">▶</button>
                </form>
                <label className={`secret ${secret ? "active" : ""}`} title="Solo el GM ve el resultado">
                  <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
                  Secreta
                </label>
              </div>
              <LogList log={log.slice(0, 2)} compact />
            </section>

            {character && (
              <SheetTabs character={character} onRoll={roll} onWeapon={rollWeapon} log={log} onClearLog={clear} />
            )}
          </div>

          <div
            className={`dice-overlay ${overlay.phase !== "hidden" ? "show" : ""} ${
              overlay.phase === "result" && overlay.nat ? `nat${overlay.nat}` : ""
            }`}
            aria-hidden
          >
            <div className="dice-backdrop" />
            <div id="dice-stage" />
            <div className="overlay-label">{overlay.label}</div>
            {overlay.phase === "result" && (
              <div className="overlay-total" key={`total-${overlay.key}`}>
                <small>TOTAL</small>
                <b>{overlay.total}</b>
                <span>
                  {overlay.formula}: {overlay.detail}
                </span>
              </div>
            )}
            {overlay.phase === "result" && overlay.nat && <NatFx key={`fx-${overlay.key}`} nat={overlay.nat} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function PartyView(props: { players: ReturnType<typeof useParty>; onOpen: (id: string) => void }) {
  const withSheets = props.players.filter((p) => playerMeta(p));
  const without = props.players.filter((p) => !playerMeta(p));
  return (
    <section className="party">
      {!inOwlbear && <p className="muted">El grupo solo está disponible dentro de Owlbear.</p>}
      {withSheets.map((p) => {
        const m = playerMeta(p)!;
        const c = m.character;
        const pct = Math.max(0, Math.min(100, (m.vitals.hp / c.maxHp) * 100));
        return (
          <button key={p.connectionId} className="party-card" onClick={() => props.onOpen(p.id)}>
            <div className="party-top">
              <span className="dot" style={{ background: p.color }} />
              <b>{c.name}</b>
              <span className="muted">{p.name}</span>
            </div>
            <div className="muted small">
              {c.ancestry} {c.className} {c.level} · CA {m.vitals.ac} · Perc {fmtMod(c.perception.mod)}
            </div>
            <div className="mini-bar">
              <div style={{ width: `${pct}%` }} />
              <span>
                {m.vitals.hp}/{c.maxHp}
                {m.vitals.temp ? ` +${m.vitals.temp}` : ""}
              </span>
            </div>
          </button>
        );
      })}
      {without.length > 0 && (
        <p className="muted small">Sin hoja subida: {without.map((p) => p.name).join(", ")}</p>
      )}
      {inOwlbear && props.players.length === 0 && <p className="muted">No hay otros jugadores conectados.</p>}
    </section>
  );
}
