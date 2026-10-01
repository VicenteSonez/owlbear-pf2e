import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { fmtMod, parsePathbuilder, type Character } from "../pathbuilder";
import { Dice3D, evaluate, parseFormula, randomValues, type DiceStyle } from "../dice";
import { autoLinkCandidate, inOwlbear, linkToken, publishPlayer, unlinkToken } from "../obr";
import { store } from "../storage";
import { live, needsSheetSync, seedState, syncSheet, useLiveStates, type PcState } from "../live";
import { DEGREE_LABEL, applyRecovery, degreeOf, type Degree } from "../rules";
import { newId, npcState, type NpcState, type RollEntry } from "../shared";
import { combatEntries, pcKey, useCombat } from "../combat";
import { applyPersistent } from "../turns";
import { playerMeta, useLinkedToken, useParty, useRollLog, useSceneTokens, useSession } from "./hooks";
import { Importer } from "./Importer";
import { SheetTabs } from "./SheetTabs";
import { Vitals } from "./Vitals";
import { LogList } from "./LogList";
import { DiceSettings } from "./DiceSettings";
import { NatFx } from "./NatFx";
import { FlatChecks, type FlatRequest } from "./FlatChecks";
import { GmView } from "./GmView";
import type { Target } from "./EffectsPanel";
import { CombatView } from "./CombatView";
import { InitPanel, initFormula, type InitOption } from "./Initiative";
import { useCombatActions } from "./useCombatActions";
import { extrasStore, useExtrasVersion, type Extras } from "../extras";
import { SideRail, sidesFor, type Side } from "./side/SideRail";
import { FeatsPanel } from "./side/FeatsPanel";
import { InventoryPanel } from "./side/InventoryPanel";
import { MagicPanel } from "./side/MagicPanel";
import { RecipesPanel } from "./side/RecipesPanel";
import { PetPanel } from "./side/PetPanel";
import type { SideProps } from "./side/types";

const dice = new Dice3D();

// La pestaña GM necesita más ancho para la lista y el panel de efectos
const WIDTH_SHEET = 420;
const WIDTH_GM = 760;

export interface RollRequest {
  label: string;
  formula: string;
  kind: RollEntry["kind"];
  crit?: boolean;
  // Condiciones que modifican la tirada, para mostrarlas junto al resultado
  notes?: string;
  flat?: FlatRequest;
  // Por defecto la tirada es del personaje en pantalla
  charName?: string;
}

interface Current {
  label: string;
  formula: string;
  total?: number;
  detail?: string;
  nat?: 1 | 20;
  secret?: boolean;
  notes?: string;
  degree?: Degree;
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
  degree?: Degree;
  dc?: number;
  notes?: string;
}

const OVERLAY_MS = 1700;
const OVERLAY_NAT_MS = 2900;

type View = "sheet" | "gm" | "combat" | "import" | "gm-import";

const degreeClass = (d?: Degree) => (d ? (d.includes("success") ? "ok" : "fail") : "");

export function App() {
  const session = useSession();
  const isGm = session.me.role === "GM";
  const { states, ready: liveReady } = useLiveStates();
  const [characters, setCharacters] = useState<Character[]>(() => store.characters());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>("sheet");
  // Hoja de otro PJ abierta por el GM desde la pestaña GM
  const [viewId, setViewId] = useState<string | null>(null);
  const party = useParty(session.ready && isGm);
  const extrasVersion = useExtrasVersion();

  useEffect(() => {
    if (!session.ready) return;
    const id = store.activeId(session.room);
    const exists = characters.some((c) => c.id === id);
    setActiveId(exists ? id : null);
    if (!exists) setView(isGm ? "gm" : "import");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.ready, session.room]);

  const own = useMemo(() => characters.find((c) => c.id === activeId), [characters, activeId]);

  // Hojas que el GM puede abrir: las suyas, las de jugadores conectados y las que ya vio antes
  const [gmCache, setGmCache] = useState(() => store.gmSheets());
  useEffect(() => {
    if (!isGm) return;
    for (const p of party) {
      const c = playerMeta(p)?.character;
      if (c) store.cacheGmSheet(c);
    }
    setGmCache(store.gmSheets());
  }, [party, isGm]);

  const sheets = useMemo(() => {
    const map: Record<string, Character> = { ...gmCache };
    for (const p of party) {
      const c = playerMeta(p)?.character;
      if (c) map[c.id] = c;
    }
    for (const c of characters) map[c.id] = c;
    return map;
  }, [gmCache, party, characters]);

  const character = (viewId ? sheets[viewId] : undefined) ?? own;
  const state = character ? states[character.id] : undefined;
  const canEdit = !inOwlbear || isGm || (!!state && state.owner === session.me.id);
  const token = useLinkedToken(character?.id);
  const ownsCharacter = !!character && characters.some((c) => c.id === character.id);

  // Pestañas laterales: las anotaciones son del dueño; el GM ve las que publica cada jugador
  const [side, setSide] = useState<Side | null>(null);
  useEffect(() => setSide(null), [character?.id]);
  const publishedExtras = useMemo(() => {
    const map: Record<string, Extras> = {};
    for (const p of party) {
      const m = playerMeta(p);
      if (m?.extras) map[m.character.id] = m.extras;
    }
    return map;
  }, [party]);
  const extras: Extras = useMemo(
    () => (character ? (ownsCharacter ? extrasStore.get(character.id) : (publishedExtras[character.id] ?? {})) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [character?.id, ownsCharacter, publishedExtras, extrasVersion],
  );

  // Siembra en la sala el estado de la hoja activa y lo mantiene al día si se reimporta
  useEffect(() => {
    if (!liveReady || !session.ready) return;
    for (const c of characters) {
      const s = states[c.id];
      const isActive = c.id === activeId;
      if (!s) {
        if (isActive) live.write(seedState(c, { id: session.me.id, name: session.me.name }, store.legacyVitals(c.id) ?? undefined));
        continue;
      }
      if (s.owner !== session.me.id) continue;
      const ownerName = isActive ? session.me.name : s.ownerName;
      if (needsSheetSync(s, c) || s.ownerName !== ownerName) live.write({ ...syncSheet(s, c), ownerName });
    }
  }, [liveReady, session.ready, characters, activeId, states, session.me.id, session.me.name]);

  // Publica la hoja propia (y sus anotaciones) para que el GM pueda abrirla
  useEffect(() => {
    if (!own) return;
    const t = window.setTimeout(() => publishPlayer({ character: own, extras: extrasStore.get(own.id) }), 600);
    return () => window.clearTimeout(t);
  }, [own, extrasVersion]);

  useEffect(() => {
    if (inOwlbear && session.ready) OBR.action.setWidth(view === "gm" ? WIDTH_GM : WIDTH_SHEET).catch(() => undefined);
  }, [view, session.ready]);

  const { log, publish, clear } = useRollLog(session);

  const selectCharacter = useCallback(
    (id: string | null) => {
      store.setActiveId(session.room, id);
      setActiveId(id);
      setViewId(null);
      if (id) setView("sheet");
    },
    [session.room],
  );

  const onImported = useCallback(
    async (c: Character, raw: unknown) => {
      store.saveCharacter(c, raw);
      setCharacters(store.characters());
      if (view === "gm-import") {
        // Hoja que controla el GM (o de un jugador ausente): queda en la sala con el GM como dueño
        if (!live.get(c.id)) await live.write(seedState(c, { id: session.me.id, name: "" }));
        setView("gm");
        return;
      }
      selectCharacter(c.id);
      if (!inOwlbear) return;
      // Reconocimiento automático: busca el token del personaje en el mapa
      const cand = await autoLinkCandidate(c);
      if (cand) {
        await linkToken(cand.id, c, session.me.id);
        OBR.notification.show(`${c.name} vinculado a "${cand.name}".`, "SUCCESS");
      }
    },
    [selectCharacter, view, session.me.id],
  );

  const onDeleted = useCallback(
    (id: string) => {
      store.removeCharacter(id);
      setCharacters(store.characters());
      if (id === activeId) selectCharacter(null);
    },
    [activeId, selectCharacter],
  );

  const onPatch = useCallback(
    (fn: (s: PcState) => PcState) => {
      if (character) live.patch(character.id, fn);
    },
    [character],
  );

  // ---------- Dados ----------
  const [current, setCurrent] = useState<Current | null>(null);
  const [secret, setSecret] = useState(false);
  const [extra, setExtra] = useState(0);
  const [freeText, setFreeText] = useState("");
  const [diceStyle, setDiceStyle] = useState<DiceStyle>(() => store.diceStyle());
  const [menu, setMenu] = useState<"dice" | "flat" | "init" | null>(null);
  const [overlay, setOverlay] = useState<Overlay>({ phase: "hidden", key: 0, label: "" });
  const busy = useRef(false);
  const rollKey = useRef(0);
  const hideTimer = useRef<number | undefined>(undefined);
  const overlayPhase = useRef<Overlay["phase"]>("hidden");

  useEffect(() => {
    dice.setStyle(diceStyle);
  }, [diceStyle]);

  // La zona de dados solo existe cuando ya se dibujó la hoja (tras conectar con Owlbear)
  useEffect(() => {
    if (!session.ready) return;
    dice.init("#dice-stage");
    const stage = document.getElementById("dice-stage");
    if (!stage) return;
    const ro = new ResizeObserver(([e]) => dice.fit(e.contentRect.height));
    ro.observe(stage);
    return () => ro.disconnect();
  }, [session.ready]);

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
      dice,
      live,
      importRaw: (raw: unknown) => onImported(parsePathbuilder(raw), raw),
    };
  }, [showOverlay, onImported]);

  const changeDiceStyle = useCallback((s: DiceStyle) => {
    setDiceStyle(s);
    store.setDiceStyle(s);
  }, []);

  const who = useMemo(
    () => ({ playerId: session.me.id, playerName: session.me.name, playerColor: session.me.color }),
    [session.me.id, session.me.name, session.me.color],
  );

  const roll = useCallback(
    async (req: RollRequest, opts: { preview?: boolean; quick?: boolean } = {}): Promise<number | undefined> => {
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
      // Sin la hoja en pantalla no hay dónde animar los dados: se tira sin animación
      const hideFromMe = (isSecret && !isGm) || !!opts.quick;
      const key = ++rollKey.current;
      const rollingFor = character?.id;
      setCurrent({ label: req.label, formula, rolling: true, secret: isSecret });
      if (!hideFromMe) showOverlay({ phase: "rolling", key, label: req.label });
      try {
        const values = hideFromMe ? randomValues(f) : await dice.roll(f);
        const out = evaluate(f, values, { crit: req.crit, check: req.kind !== "damage" });
        const shownFormula = req.crit ? `2×(${formula})` : formula;
        let degree: Degree | undefined;
        if (req.flat) {
          const d20 = values[0]?.[0];
          degree = req.flat.recovery ? degreeOf(out.total, req.flat.dc, d20) : out.total >= req.flat.dc ? "success" : "failure";
        }
        if (!hideFromMe) {
          showOverlay({
            phase: "result",
            key,
            label: req.label,
            formula: shownFormula,
            total: out.total,
            detail: out.detail,
            nat: out.nat,
            degree,
            dc: req.flat?.dc,
            notes: req.notes,
          });
        }
        setCurrent(
          isSecret && !isGm
            ? { label: req.label, formula, rolling: false, secret: true }
            : {
                label: req.label,
                formula: shownFormula,
                total: out.total,
                detail: out.detail,
                nat: out.nat,
                secret: isSecret,
                notes: req.notes,
                degree,
                rolling: false,
              },
        );
        if (opts.preview) return out.total;
        const entry: RollEntry = {
          id: newId(),
          time: Date.now(),
          ...who,
          charName: req.charName ?? character?.name,
          label: req.label,
          formula: shownFormula,
          detail: out.detail,
          total: out.total,
          kind: req.kind,
          nat: out.nat,
          crit: req.crit,
          secret: isSecret || undefined,
          diceColor: diceStyle.color,
          notes: req.notes,
          dc: req.flat?.dc,
          degree,
        };
        await publish(entry);
        // La tirada de recuperación cambia moribundo según el resultado
        if (req.flat?.recovery && degree && rollingFor) await live.patch(rollingFor, (s) => applyRecovery(s, degree!));
        return out.total;
      } finally {
        busy.current = false;
      }
    },
    [extra, secret, isGm, who, character, publish, showOverlay, diceStyle.color],
  );

  const freeRoll = (formula: string) => roll({ label: "Tirada libre", formula, kind: "free" });
  const flatRoll = (r: FlatRequest) => roll({ label: r.label, formula: "1d20", kind: "flat", flat: r });

  // GM: resuelve el daño persistente de un PJ o PNJ fuera de los turnos
  const resolvePersistentFor = useCallback(
    (t: Target) => applyPersistent(t.kind === "pc" ? t : { ...t, secret: t.state.hidden }, who, publish),
    [who, publish],
  );

  // ---------- Combate ----------
  const combat = useCombat();
  const entries = useMemo(() => combatEntries(combat, states), [combat, states]);
  const actions = useCombatActions(combat, entries, who, publish);
  const sceneTokens = useSceneTokens();
  const npcStates = useMemo(() => {
    const map: Record<string, NpcState> = {};
    for (const t of sceneTokens) if (t.data.kind === "npc") map[t.item.id] = npcState(t.data);
    return map;
  }, [sceneTokens]);
  const myTurn = combat.active && !!own && combat.current === pcKey(own.id);

  // Tira iniciativa y la guarda en el estado del PJ para la lista de combate
  const rollInit = useCallback(
    async (c: Character, opt: InitOption, winsTies: boolean) => {
      const f = initFormula(opt, live.get(c.id));
      const total = await roll(
        { label: `Iniciativa (${opt.label})`, formula: f.formula, kind: "check", notes: f.notes, charName: c.name },
        { quick: view !== "sheet" },
      );
      if (total === undefined) return;
      await live.patch(c.id, (s) => ({ ...s, init: { value: total, skill: opt.key, label: opt.label, winsTies, t: Date.now() } }));
    },
    [roll, view],
  );

  if (!session.ready) return <div className="loading">Conectando con Owlbear…</div>;

  const viewingOther = !!viewId && !!sheets[viewId] && viewId !== own?.id;

  return (
    <div className="app">
      <nav className="topnav">
        <button
          className={view === "sheet" && !viewingOther ? "on" : ""}
          onClick={() => {
            setViewId(null);
            setView(own ? "sheet" : "import");
          }}
        >
          {own ? own.name : "Mi hoja"}
        </button>
        {viewingOther && (
          <button className={view === "sheet" ? "on" : ""} onClick={() => setView("sheet")}>
            {sheets[viewId!].name}
          </button>
        )}
        {isGm && (
          <button className={view === "gm" || view === "gm-import" ? "on" : ""} onClick={() => setView("gm")}>
            GM
          </button>
        )}
        <button
          className={`${view === "combat" ? "on" : ""} ${myTurn ? "my-turn" : ""}`}
          title={myTurn ? "¡Es tu turno!" : "Iniciativa y combate"}
          onClick={() => setView("combat")}
        >
          ⚔ Combate{combat.active && combat.round ? ` · R${combat.round}` : ""}
        </button>
        <button className={`icon ${view === "import" ? "on" : ""}`} title="Personajes / importar" onClick={() => setView("import")}>
          ⚙
        </button>
      </nav>

      {view === "import" && (
        <Importer characters={characters} activeId={activeId} onImported={onImported} onSelect={selectCharacter} onDelete={onDeleted} />
      )}
      {view === "gm-import" && (
        <Importer
          mode="gm"
          characters={characters}
          activeId={activeId}
          onImported={onImported}
          onSelect={selectCharacter}
          onDelete={onDeleted}
          onCancel={() => setView("gm")}
        />
      )}

      {view === "gm" && (
        <GmView
          states={states}
          sheets={sheets}
          onOpenSheet={(id) => {
            setViewId(id);
            setView("sheet");
          }}
          onUpload={() => setView("gm-import")}
          onResolvePersistent={resolvePersistentFor}
        />
      )}

      {view === "combat" && (
        <CombatView
          combat={combat}
          entries={entries}
          isGm={isGm}
          own={own}
          ownState={own ? states[own.id] : undefined}
          npcStates={npcStates}
          allPcs={Object.values(states)}
          actions={actions}
          onRollInit={(opt, winsTies) => own && rollInit(own, opt, winsTies)}
        />
      )}

      <div className={view === "sheet" && character ? "sheet" : "sheet hidden"}>
        {character && state && (
          <Vitals
            character={character}
            state={state}
            canEdit={canEdit}
            showLink={inOwlbear && (ownsCharacter || isGm)}
            token={token}
            onPatch={onPatch}
            onLink={async () => {
              if (!inOwlbear) return;
              const sel = await OBR.player.getSelection();
              const owner = state.owner ?? session.me.id;
              if (sel?.length === 1) {
                await linkToken(sel[0], character, owner);
                return;
              }
              const cand = await autoLinkCandidate(character);
              if (cand) await linkToken(cand.id, character, owner);
              else OBR.notification.show("Selecciona tu token en el mapa y vuelve a pulsar Vincular.", "INFO");
            }}
            onUnlink={() => token && unlinkToken(token.id)}
          />
        )}
        {character && !state && <section className="vitals muted">Preparando la hoja en la sala…</section>}

        <div className={`sheet-body ${character ? "with-rail" : ""}`}>
          {character && <SideRail character={character} side={side} onSide={setSide} />}
          {character && side && sidesFor(character).some((x) => x.id === side) && (() => {
            const sp: SideProps = {
              character,
              state,
              extras,
              canEditExtras: ownsCharacter,
              canEdit,
              updateExtras: (fn) => extrasStore.update(character.id, fn),
              patch: onPatch,
            };
            return (
              <div className="side-scroll">
                {side === "feats" && <FeatsPanel {...sp} />}
                {side === "inventory" && <InventoryPanel {...sp} />}
                {side === "magic" && <MagicPanel {...sp} onRoll={roll} />}
                {side === "recipes" && <RecipesPanel {...sp} />}
                {side === "pet" && <PetPanel {...sp} onRoll={roll} />}
              </div>
            );
          })()}
          <div className={side ? "sheet-scroll hidden" : "sheet-scroll"}>
            <section className="roller">
              <div className="dice-row">
                {[4, 6, 8, 10, 12, 20].map((s) => (
                  <button key={s} className="btn dice" onClick={() => freeRoll(`1d${s}`)}>
                    d{s}
                  </button>
                ))}
                <button
                  className={`btn dice init ${menu === "init" ? "on" : ""}`}
                  title="Tirar iniciativa"
                  onClick={() => setMenu((m) => (m === "init" ? null : "init"))}
                >
                  ⚔
                </button>
                <button
                  className={`btn dice flat ${menu === "flat" ? "on" : ""}`}
                  title="Tiradas planas: CD 11, CD 5, recuperación…"
                  onClick={() => setMenu((m) => (m === "flat" ? null : "flat"))}
                >
                  CD
                </button>
                <button
                  className={`btn dice palette ${menu === "dice" ? "on" : ""}`}
                  title="Color y tema de tus dados"
                  onClick={() => setMenu((m) => (m === "dice" ? null : "dice"))}
                >
                  <span className="palette-dot" style={{ background: diceStyle.color }} />
                </button>
              </div>
              {menu === "dice" && (
                <DiceSettings
                  style={diceStyle}
                  onChange={changeDiceStyle}
                  onClose={() => setMenu(null)}
                  onTest={() => roll({ label: "Prueba de dados", formula: "1d20", kind: "free" }, { preview: true })}
                />
              )}
              {menu === "init" && character && (
                <InitPanel
                  character={character}
                  state={state}
                  onRoll={(opt, winsTies) => rollInit(character, opt, winsTies)}
                  onClose={() => setMenu(null)}
                />
              )}
              {menu === "flat" && (
                <FlatChecks
                  stupefied={state?.cond.stupefied ?? 0}
                  dying={state?.dying ?? 0}
                  onFlat={flatRoll}
                  onClose={() => setMenu(null)}
                />
              )}
              <div
                className={`result-bar ${current?.nat === 20 ? "nat20" : current?.nat === 1 ? "nat1" : ""} ${degreeClass(current?.degree)}`}
              >
                <div className="rb-label">{current?.label ?? "Elige una tirada"}</div>
                {current?.rolling && <div className="rb-rolling">Tirando…</div>}
                {current && !current.rolling && current.total === undefined && <div className="rb-secret">🔒 Enviada al GM</div>}
                {current && !current.rolling && current.total !== undefined && (
                  <div className="rb-main">
                    <b>{current.total}</b>
                    {current.degree && <span className={`rb-degree ${degreeClass(current.degree)}`}>{DEGREE_LABEL[current.degree]}</span>}
                    <small>
                      {current.formula}: {current.detail}
                      {current.nat === 20 ? " · ¡20 natural!" : current.nat === 1 ? " · 1 natural" : ""}
                    </small>
                  </div>
                )}
                {current?.notes && !current.rolling && <div className="rb-notes">{current.notes}</div>}
              </div>
              <div className="roll-opts">
                <label className="mod">
                  Mod.
                  <button type="button" onClick={() => setExtra((n) => n - 1)}>
                    −
                  </button>
                  <span className={extra ? "active" : ""}>{fmtMod(extra)}</span>
                  <button type="button" onClick={() => setExtra((n) => n + 1)}>
                    +
                  </button>
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
                  <button className="btn" title="Tirar">
                    ▶
                  </button>
                </form>
                <label className={`secret ${secret ? "active" : ""}`} title="Solo el GM ve el resultado">
                  <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
                  Secreta
                </label>
              </div>
              <LogList log={log.slice(0, 2)} compact />
            </section>

            {character && (
              <SheetTabs
                character={character}
                state={state}
                canEdit={canEdit}
                onRoll={roll}
                onPatch={onPatch}
                log={log}
                onClearLog={clear}
              />
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
                {overlay.degree && (
                  <em className={degreeClass(overlay.degree)}>
                    {DEGREE_LABEL[overlay.degree]}
                    {overlay.dc ? ` · CD ${overlay.dc}` : ""}
                  </em>
                )}
                <span>
                  {overlay.formula}: {overlay.detail}
                </span>
                {overlay.notes && <span className="overlay-notes">{overlay.notes}</span>}
              </div>
            )}
            {overlay.phase === "result" && overlay.nat && <NatFx key={`fx-${overlay.key}`} nat={overlay.nat} />}
          </div>
        </div>
      </div>
    </div>
  );
}
