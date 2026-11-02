// Conjuros y poderes del PNJ: ataque y CD de magia, espacios espontáneos por rango, usos de los
// preparados, recursos (puntos de foco, cargas…) y enfriamientos (Aliento de dragón: 1d4 rondas).
import { SAVE_LABEL, newId, type DamageSpec, type NpcCast, type NpcSpell, type NpcState, type SaveKey, type SpellKind } from "../shared";
import { MAGIC_DESIGNS, type MagicDesign } from "../fx";
import { parseFormula } from "../dice";
import { CAST_LABEL, clearCooldowns, countsUses, damageText, restNpc, spellReady, usesMax } from "../npc";
import { fmtMod } from "../pathbuilder";
import { NumInput } from "./bits";

export const KIND_LABEL: Record<SpellKind, string> = { atk: "Ataque", save: "Salvación", fx: "Efecto" };
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const validFormula = (f: string) => {
  try {
    parseFormula(f);
    return true;
  } catch {
    return false;
  }
};
const parseNum = (t: string) => {
  const v = parseInt(t.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(v) ? v : undefined;
};

// Daños de otros tipos (2d8 espiritual además del daño principal)
export function ExtraDamage({ list, onChange }: { list?: DamageSpec[]; onChange: (l: DamageSpec[] | undefined) => void }) {
  const items = list ?? [];
  const set = (l: DamageSpec[]) => onChange(l.length ? l : undefined);
  return (
    <div className="npc-dmg2">
      {items.map((d, i) => (
        <span key={i} className="npc-dmg2-row">
          <span className="muted small">+</span>
          <input className="md" placeholder="2d8" defaultValue={d.f} onBlur={(e) => {
              const f = e.target.value.trim();
              if (!f || validFormula(f)) set(items.map((x, j) => (j === i ? { ...x, f } : x)).filter((x) => x.f));
            }} />
          <input className="md" list="pf2-damage-types" placeholder="Tipo" defaultValue={d.ty} onBlur={(e) => set(items.map((x, j) => (j === i ? { ...x, ty: e.target.value.trim() } : x)))} />
          <button className="row-x" title="Quitar" onClick={() => set(items.filter((_, j) => j !== i))}>
            ✕
          </button>
        </span>
      ))}
      <button className="btn ghost small-btn" title="Otro tipo de daño: cada uno se compara aparte con las resistencias del objetivo" onClick={() => set([...items, { f: "1d6", ty: "" }])}>
        + Otro tipo de daño
      </button>
    </div>
  );
}

interface Props {
  n: NpcState;
  edit: boolean;
  onPatch: (fn: (n: NpcState) => NpcState) => void;
  onCast: (sp: NpcSpell) => void;
  // Lo que impide lanzarlo aparte de los usos (sin objetivo, Restringido…)
  blocked: (sp: NpcSpell) => string | null;
}

export function NpcSpells({ n, edit, onPatch, onCast, blocked }: Props) {
  const spells = n.spells;
  const res = n.res ?? [];
  const setSpell = (id: string, p: Partial<NpcSpell>) => onPatch((x) => ({ ...x, spells: x.spells.map((s) => (s.id === id ? { ...s, ...p } : s)) }));
  const setSlot = (rank: number, fn: (v: { max: number; used: number }) => { max: number; used: number }) =>
    onPatch((x) => {
      const k = String(rank);
      const next = fn(x.slots?.[k] ?? { max: 0, used: 0 });
      const slots = { ...x.slots };
      if (next.max > 0) slots[k] = { max: next.max, used: Math.max(0, Math.min(next.max, next.used)) };
      else delete slots[k];
      return { ...x, slots: Object.keys(slots).length ? slots : undefined };
    });
  const setRes = (id: string, fn: (r: NonNullable<NpcState["res"]>[number]) => NonNullable<NpcState["res"]>[number] | null) =>
    onPatch((x) => {
      const list = (x.res ?? []).flatMap((r) => (r.id === id ? (fn(r) ?? []) : [r]));
      return { ...x, res: list.length ? list : undefined };
    });
  const slotRanks = RANKS.filter((r) => (n.slots?.[String(r)]?.max ?? 0) > 0);
  const usesSpont = spells.some((s) => !s.pow && s.cast === "spont");
  const anyCd = spells.some((s) => (s.cdLeft ?? 0) > 0);

  return (
    <>
      <div className="te-row wrap">
        <NumInput label="Ataque de conjuro" value={n.spellAtk ?? 0} onCommit={(v) => onPatch((x) => ({ ...x, spellAtk: v }))} />
        <NumInput label="CD de conjuro" value={n.spellDc ?? 0} onCommit={(v) => onPatch((x) => ({ ...x, spellDc: v }))} />
        <span className="npc-tools">
          {anyCd && (
            <button className="btn ghost small-btn" title="Quita todos los enfriamientos: se pueden volver a usar ya" onClick={() => onPatch(clearCooldowns)}>
              ⏳ Refrescar enfriamientos
            </button>
          )}
          <button className="btn ghost small-btn" title="Descanso: recupera usos, espacios y recursos, y quita los enfriamientos" onClick={() => onPatch(restNpc)}>
            ☾ Descanso
          </button>
        </span>
      </div>

      {(edit || usesSpont || slotRanks.length > 0) && (
        <div className="npc-slots">
          <span className="muted small">Espacios por rango</span>
          {edit
            ? RANKS.map((r) => (
                <label key={r} className="npc-slot-edit" title={`Espacios de rango ${r}`}>
                  {r}º
                  <input
                    inputMode="numeric"
                    defaultValue={n.slots?.[String(r)]?.max || ""}
                    placeholder="0"
                    onBlur={(e) => {
                      const max = Math.max(0, parseNum(e.target.value) ?? 0);
                      setSlot(r, (v) => ({ ...v, max }));
                    }}
                  />
                </label>
              ))
            : slotRanks.map((r) => {
                const sl = n.slots![String(r)];
                return (
                  <span key={r} className="npc-slot" title={`Rango ${r}: ${sl.max - sl.used} de ${sl.max} libres (pulsa para gastar o recuperar)`}>
                    <b>{r}º</b>
                    {Array.from({ length: sl.max }, (_, i) => (
                      <button key={i} type="button" className={`pip ${i < sl.max - sl.used ? "on" : ""}`} onClick={() =>
                          setSlot(r, (v) => {
                            // Como los puntos de la hoja: pulsar fija los libres; pulsar el último libre lo gasta
                            const free = v.max - v.used;
                            return { ...v, used: v.max - (free === i + 1 ? i : i + 1) };
                          })
                        }
                      />
                    ))}
                  </span>
                );
              })}
          {!edit && !slotRanks.length && <span className="muted small">sin espacios: pulsa ✎ Editar</span>}
        </div>
      )}

      {(edit || res.length > 0) && (
        <div className="npc-res">
          {res.map((r) =>
            edit ? (
              <span key={r.id} className="npc-res-row">
                <input placeholder="Recurso (Puntos de foco…)" defaultValue={r.n} onBlur={(e) => setRes(r.id, (x) => ({ ...x, n: e.target.value.trim() }))} />
                <label className="npc-slot-edit">
                  máx
                  <input inputMode="numeric" defaultValue={r.max} onBlur={(e) => {
                      const max = Math.max(1, parseNum(e.target.value) ?? 1);
                      setRes(r.id, (x) => ({ ...x, max, cur: Math.min(x.cur, max) }));
                    }} />
                </label>
                <button className="row-x" title="Quitar" onClick={() => setRes(r.id, () => null)}>
                  ✕
                </button>
              </span>
            ) : (
              <span key={r.id} className="npc-res-row">
                <span className="cm-label">{r.n || "Recurso"}</span>
                <button className="btn small-btn" disabled={r.cur <= 0} onClick={() => setRes(r.id, (x) => ({ ...x, cur: Math.max(0, x.cur - 1) }))}>
                  −
                </button>
                <b>
                  {r.cur}/{r.max}
                </b>
                <button className="btn small-btn" disabled={r.cur >= r.max} onClick={() => setRes(r.id, (x) => ({ ...x, cur: Math.min(x.max, x.cur + 1) }))}>
                  +
                </button>
              </span>
            ),
          )}
          {edit && (
            <button className="btn ghost small-btn" onClick={() => onPatch((x) => ({ ...x, res: [...(x.res ?? []), { id: newId(), n: "", max: 1, cur: 1 }] }))}>
              + Recurso
            </button>
          )}
        </div>
      )}

      {spells.length === 0 && !edit && <p className="muted small">Sin conjuros ni poderes.</p>}
      {spells.map((sp) =>
        edit ? (
          <div key={sp.id} className="npc-edit spell">
            <input placeholder={sp.pow ? "Poder" : "Conjuro"} defaultValue={sp.n} onBlur={(e) => setSpell(sp.id, { n: e.target.value.trim() })} />
            <select value={sp.pow ? "pow" : "spell"} title="Conjuro (Estupefacto, espacios) o poder (Aliento, habilidad especial)" onChange={(e) => setSpell(sp.id, { pow: e.target.value === "pow" || undefined })}>
              <option value="spell">Conjuro</option>
              <option value="pow">Poder</option>
            </select>
            <select value={sp.kind} onChange={(e) => setSpell(sp.id, { kind: e.target.value as SpellKind })}>
              {(Object.keys(KIND_LABEL) as SpellKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            {sp.kind === "save" && (
              <>
                <select value={sp.save ?? "reflex"} onChange={(e) => setSpell(sp.id, { save: e.target.value as SaveKey })}>
                  {(["fortitude", "reflex", "will"] as SaveKey[]).map((k) => (
                    <option key={k} value={k}>
                      {SAVE_LABEL[k]}
                    </option>
                  ))}
                </select>
                <button className={`chip ${sp.basic ? "on" : ""}`} onClick={() => setSpell(sp.id, { basic: !sp.basic })}>
                  Básica
                </button>
              </>
            )}
            {sp.pow ? (
              <>
                <select value={sp.own ? "own" : "magic"} title="Ataque y CD: los de magia del PNJ o propios de este poder" onChange={(e) => setSpell(sp.id, { own: e.target.value === "own" || undefined })}>
                  <option value="magic">Usa ataque/CD de magia</option>
                  <option value="own">Ataque/CD propios</option>
                </select>
                {sp.own && (
                  <>
                    <input className="sm" placeholder="Atq +0" title="Ataque del poder" defaultValue={sp.atk !== undefined ? fmtMod(sp.atk) : ""} onBlur={(e) => setSpell(sp.id, { atk: parseNum(e.target.value) })} />
                    <input className="sm" placeholder="CD" title="CD del poder" defaultValue={sp.dc ?? ""} onBlur={(e) => setSpell(sp.id, { dc: parseNum(e.target.value) })} />
                  </>
                )}
                <input className="sm" placeholder="Usos" title="Usos por día (vacío = sin límite)" defaultValue={sp.uses ?? ""} onBlur={(e) => {
                    const v = parseNum(e.target.value);
                    setSpell(sp.id, { uses: v && v > 0 ? v : undefined });
                  }} />
              </>
            ) : (
              <>
                <select value={sp.cast ?? "will"} title="Preparado: usos por día · Espontáneo: gasta un espacio de su rango · A voluntad: sin límite" onChange={(e) => setSpell(sp.id, { cast: e.target.value as NpcCast })}>
                  {(Object.keys(CAST_LABEL) as NpcCast[]).map((k) => (
                    <option key={k} value={k}>
                      {CAST_LABEL[k]}
                    </option>
                  ))}
                </select>
                {(sp.cast === "spont" || sp.cast === "prep") && (
                  <input className="sm" placeholder="Rango" title="Rango del conjuro (0 = truco, a voluntad)" defaultValue={sp.rank ?? ""} onBlur={(e) => setSpell(sp.id, { rank: parseNum(e.target.value) })} />
                )}
                {sp.cast === "prep" && (
                  <input className="sm" placeholder="Usos" title="Veces que lo tiene preparado" defaultValue={sp.uses ?? 1} onBlur={(e) => setSpell(sp.id, { uses: Math.max(1, parseNum(e.target.value) ?? 1) })} />
                )}
              </>
            )}
            <input
              className="sm"
              placeholder="Enfr."
              title="Enfriamiento en rondas: fijo (2) o un dado (1d4). Vacío = sin enfriamiento"
              defaultValue={sp.cd ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (!v || validFormula(v)) setSpell(sp.id, { cd: v || undefined });
              }}
            />
            {res.length > 0 && (
              <select
                value={sp.cost?.r ?? ""}
                title="Recurso que gasta al usarse"
                onChange={(e) => {
                  const r = e.target.value;
                  setSpell(sp.id, { cost: r ? { r, n: sp.cost?.n ?? 1 } : undefined });
                }}
              >
                <option value="">Sin recurso</option>
                {res.map((r) => (
                  <option key={r.id} value={r.id}>
                    Gasta {r.n || "recurso"}
                  </option>
                ))}
              </select>
            )}
            {sp.cost && (
              <input className="sm" title="Cuánto gasta" defaultValue={sp.cost.n} onBlur={(e) => setSpell(sp.id, { cost: { ...sp.cost!, n: Math.max(1, parseNum(e.target.value) ?? 1) } })} />
            )}
            <input className="md" placeholder="Daño" defaultValue={sp.dmg} onBlur={(e) => setSpell(sp.id, { dmg: e.target.value.trim() || undefined })} />
            <input className="md" list="pf2-damage-types" placeholder="Tipo" defaultValue={sp.ty} onBlur={(e) => setSpell(sp.id, { ty: e.target.value.trim() || undefined })} />
            <ExtraDamage list={sp.dmg2} onChange={(dmg2) => setSpell(sp.id, { dmg2 })} />
            <button className={`chip ${sp.area ? "on" : ""}`} title="De área: no pide prueba plana contra objetivos escondidos u ocultos" onClick={() => setSpell(sp.id, { area: !sp.area || undefined })}>
              Área
            </button>
            <select className="fx-select" value={sp.fx ?? "arcane"} onChange={(e) => setSpell(sp.id, { fx: e.target.value as MagicDesign })}>
              {MAGIC_DESIGNS.map((d) => (
                <option key={d.id} value={d.id}>
                  ✦ {d.label}
                </option>
              ))}
            </select>
            <button className="row-x" title="Quitar" onClick={() => onPatch((x) => ({ ...x, spells: x.spells.filter((y) => y.id !== sp.id) }))}>
              ✕
            </button>
            <textarea className="feat-notes" placeholder="Descripción" defaultValue={sp.desc} onBlur={(e) => setSpell(sp.id, { desc: e.target.value || undefined })} />
          </div>
        ) : (
          <SpellRow key={sp.id} n={n} sp={sp} onCast={onCast} blocked={blocked(sp)} onPatch={onPatch} />
        ),
      )}
      {edit && (
        <div className="te-row">
          <button className="btn ghost" onClick={() => onPatch((x) => ({ ...x, spells: [...x.spells, { id: newId(), n: "", kind: "save", save: "reflex" }] }))}>
            + Conjuro
          </button>
          <button className="btn ghost" onClick={() => onPatch((x) => ({ ...x, spells: [...x.spells, { id: newId(), n: "", kind: "save", save: "reflex", basic: true, pow: true, cd: "1d4" }] }))}>
            + Poder
          </button>
        </div>
      )}
    </>
  );
}

function SpellRow({ n, sp, onCast, blocked, onPatch }: { n: NpcState; sp: NpcSpell; onCast: (sp: NpcSpell) => void; blocked: string | null; onPatch: Props["onPatch"] }) {
  const why = spellReady(n, sp) ?? blocked;
  const max = usesMax(sp);
  const cost = sp.cost && n.res?.find((r) => r.id === sp.cost!.r);
  const setSp = (p: Partial<NpcSpell>) => onPatch((x) => ({ ...x, spells: x.spells.map((s) => (s.id === sp.id ? { ...s, ...p } : s)) }));
  const castText = sp.pow ? "Poder" : `${CAST_LABEL[sp.cast ?? "will"]}${sp.cast !== "will" && sp.cast && sp.rank !== undefined ? ` · ${sp.rank ? `rango ${sp.rank}` : "truco"}` : ""}`;
  return (
    <div className={`spell-row npc-spell ${why ? "spent" : ""}`} title={sp.desc}>
      <span className="ename">{sp.n || (sp.pow ? "Poder" : "Conjuro")}</span>
      <span className="muted small">{castText}</span>
      <span className="badge">
        {KIND_LABEL[sp.kind]}
        {sp.kind === "save" ? ` · ${SAVE_LABEL[sp.save ?? "reflex"]}` : ""}
      </span>
      {(sp.dmg || sp.dmg2) && <span className="muted small">{damageText(sp.dmg, sp.ty, sp.dmg2)}</span>}
      {countsUses(sp) && (
        <span className="npc-uses" title="Usos gastados (pulsa para devolver uno)">
          <button className="link-btn" disabled={!sp.used} onClick={() => setSp({ used: Math.max(0, (sp.used ?? 0) - 1) || undefined })}>
            {max - (sp.used ?? 0)}/{max}
          </button>
        </span>
      )}
      {cost && <span className="muted small">−{sp.cost!.n} {cost.n}</span>}
      {sp.cd && !(sp.cdLeft ?? 0) && <span className="muted small" title="Enfriamiento al usarlo">⏳ {sp.cd}</span>}
      {(sp.cdLeft ?? 0) > 0 && (
        <button className="chip warn on" title="Enfriamiento: baja una ronda al empezar su turno. Pulsa para refrescarlo ya" onClick={() => setSp({ cdLeft: undefined })}>
          ⏳ {sp.cdLeft} ↺
        </button>
      )}
      <button className="btn small-btn" disabled={!!why} title={why ?? undefined} onClick={() => onCast(sp)}>
        {sp.pow ? "Usar" : "Lanzar"}
      </button>
    </div>
  );
}
