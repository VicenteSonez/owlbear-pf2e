import { useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { fmtMod, type Pet } from "../../pathbuilder";
import { live, petStateId, useLiveStates, type PcState } from "../../live";
import { inOwlbear, linkToken, unlinkToken } from "../../obr";
import { applyDamage, applyHealing, checkAdjust, effectiveAc, effectiveMaxHp, modsText, stackMods, type Mod, type RollCtx } from "../../rules";
import { hpColor, newId } from "../../shared";
import { store } from "../../storage";
import { parseFormula } from "../../dice";
import { featuresOf, rangerPrecisionDice } from "../../classes";
import { damageReqs } from "../../requests";
import type { FamiliarAbility, PetAttack, PetStats } from "../../extras";
import type { RollRequest } from "../App";
import { ConditionRow } from "../bits";
import { useLinkedToken, useSceneTokens } from "../hooks";
import { useActions } from "../ctx";
import { useNpcOptions } from "../NpcPicker";
import { EditableName, PanelHead } from "./common";
import { ThrallLinker } from "./ThrallLinker";
import { defaultColor } from "../../fx";
import type { SideProps } from "./types";

const PET_TYPE: Record<string, string> = {
  "Animal Companion": "Compañero animal",
  Familiar: "Familiar",
  Eidolon: "Eidolón",
  "Construct Companion": "Compañero constructo",
  "Undead Companion": "Compañero no muerto",
};

type PetKind = "animal" | "familiar" | "eidolon" | "construct" | "other";
const kindOf = (p: Pet): PetKind => {
  const t = p.type.toLowerCase();
  if (t.includes("familiar")) return "familiar";
  if (t.includes("eidolon")) return "eidolon";
  if (t.includes("construct")) return "construct";
  if (t.includes("animal")) return "animal";
  return "other";
};

const STATS: { key: string; label: string; ctx: RollCtx }[] = [
  { key: "perception", label: "Percepción", ctx: { kind: "perception" } },
  { key: "fortitude", label: "Fortaleza", ctx: { kind: "save", key: "fortitude" } },
  { key: "reflex", label: "Reflejos", ctx: { kind: "save", key: "reflex" } },
  { key: "will", label: "Voluntad", ctx: { kind: "save", key: "will" } },
  { key: "acrobatics", label: "Acrobacias", ctx: { kind: "skill", key: "acrobatics", ability: "dex" } },
  { key: "athletics", label: "Atletismo", ctx: { kind: "skill", key: "athletics", ability: "str" } },
  { key: "stealth", label: "Sigilo", ctx: { kind: "skill", key: "stealth", ability: "dex" } },
  { key: "survival", label: "Supervivencia", ctx: { kind: "skill", key: "survival", ability: "wis" } },
];

const parseMod = (t: string) => {
  const n = parseInt(t.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

// Cantidad de dados de una fórmula (para Potenciar eidolón)
const diceCount = (formula: string) => {
  try {
    return parseFormula(formula).dice.reduce((a, d) => a + (d.sign > 0 ? d.count : 0), 0);
  } catch {
    return 0;
  }
};

// Los familiares tienen 5 PG por nivel (+2 por nivel con Resistente)
const familiarHp = (level: number, tough: boolean) => level * (tough ? 7 : 5);

// Crea el estado en la sala de la mascota (PG y CA) para poder llevarla en el mapa
function PetSetup({ onCreate, canEdit, hint, presetHp, presetAc }: { onCreate: (maxHp: number, ac: number) => void; canEdit: boolean; hint?: string; presetHp?: number; presetAc?: number }) {
  const [hp, setHp] = useState(presetHp ? String(presetHp) : "");
  const [ac, setAc] = useState(presetAc ? String(presetAc) : "");
  return (
    <form
      className="pet-setup"
      onSubmit={(e) => {
        e.preventDefault();
        const h = parseInt(hp, 10);
        if (Number.isFinite(h) && h > 0) onCreate(h, parseInt(ac, 10) || 10);
      }}
    >
      <p className="muted small">{hint ?? "Pathbuilder no exporta los PG ni la CA de la mascota. Escríbelos para llevar su vida en la hoja y en el mapa."}</p>
      <label>
        PG máx <input inputMode="numeric" value={hp} onChange={(e) => setHp(e.target.value.replace(/\D/g, ""))} />
      </label>
      <label>
        CA <input inputMode="numeric" value={ac} onChange={(e) => setAc(e.target.value.replace(/\D/g, ""))} />
      </label>
      <button className="btn primary" disabled={!canEdit || !hp}>
        Activar
      </button>
    </form>
  );
}

function PetVitals({ s, hp, canEdit, onLink, onUnlink, linked, shared }: { s: PcState; hp: PcState; canEdit: boolean; linked: boolean; shared: boolean; onLink: () => void; onUnlink: () => void }) {
  const [amount, setAmount] = useState("");
  const ac = effectiveAc(s.baseAc, s.acAdj, s.cond).ac;
  const max = effectiveMaxHp(hp.maxHp, hp.level, hp.cond);
  const pct = Math.max(0, Math.min(100, (hp.hp / Math.max(1, max)) * 100));
  const apply = (sign: 1 | -1) => {
    const n = parseInt(amount, 10);
    setAmount("");
    if (!Number.isFinite(n) || n <= 0) return;
    live.patch(hp.id, (x) => (sign < 0 ? applyDamage(x, n) : applyHealing(x, n, effectiveMaxHp(x.maxHp, x.level, x.cond))));
  };
  return (
    <div className="pet-vitals">
      <div className="pet-ac" title="CA">
        <small>CA</small>
        <b>{ac}</b>
      </div>
      <div className="pet-hp">
        <div className="mini-bar">
          <div style={{ width: `${pct}%`, background: hpColor(hp.hp, max) }} />
          <span>
            PG {hp.hp}/{max}
            {hp.temp ? ` +${hp.temp}` : ""}
            {shared ? " · compartidos" : ""}
          </span>
        </div>
        <div className="pet-hp-row">
          <input
            inputMode="numeric"
            placeholder="Cant."
            value={amount}
            disabled={!canEdit}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && apply(-1)}
          />
          <button className="btn danger small-btn" disabled={!canEdit} onClick={() => apply(-1)}>
            Daño
          </button>
          <button className="btn heal small-btn" disabled={!canEdit} onClick={() => apply(1)}>
            Curar
          </button>
          {inOwlbear &&
            (linked ? (
              <button className="btn ghost small-btn" disabled={!canEdit} onClick={onUnlink} title="Quitar el vínculo con el token">
                Desvincular
              </button>
            ) : (
              <button className="btn ghost small-btn" disabled={!canEdit} onClick={onLink} title="Selecciona el token de la mascota en el mapa">
                Vincular token
              </button>
            ))}
        </div>
        <ConditionRow cond={s.cond} size={15} />
      </div>
    </div>
  );
}

// Ranuras de habilidades de familiar (se pueden cambiar cada día)
function FamiliarAbilities({ stats, defaults, canEdit, setStats }: { stats: PetStats; defaults: string[]; canEdit: boolean; setStats: (fn: (p: PetStats) => PetStats) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const list: FamiliarAbility[] = stats.abilities ?? (defaults.length ? defaults.map((n) => ({ n })) : [{ n: "" }, { n: "" }]);
  const set = (fn: (l: FamiliarAbility[]) => FamiliarAbility[]) => setStats((p) => ({ ...p, abilities: fn(p.abilities ?? list) }));
  return (
    <div className="fam-abilities">
      <h4>Habilidades de familiar</h4>
      {list.map((a, i) => (
        <div key={i} className={`fam-ab ${open === i ? "open" : ""}`}>
          <div className="spell-row">
            <EditableName value={a.n} placeholder={`Habilidad ${i + 1}`} canEdit={canEdit} onChange={(v) => set((l) => l.map((x, j) => (j === i ? { ...x, n: v } : x)))} />
            <button className="spell-kind" title="Notas" onClick={() => setOpen(open === i ? null : i)}>
              📝{a.note ? "·" : ""}
            </button>
            {canEdit && (
              <button className="row-x" title="Quitar ranura" onClick={() => set((l) => l.filter((_, j) => j !== i))}>
                ✕
              </button>
            )}
          </div>
          {open === i && (
            <textarea
              className="feat-notes"
              placeholder="¿Qué hace?"
              value={a.note ?? ""}
              readOnly={!canEdit}
              onChange={(e) => set((l) => l.map((x, j) => (j === i ? { ...x, note: e.target.value || undefined } : x)))}
            />
          )}
        </div>
      ))}
      {canEdit && (
        <button className="btn ghost small-btn" onClick={() => set((l) => [...l, { n: "" }])}>
          + Ranura de habilidad
        </button>
      )}
    </div>
  );
}

function PetCard(props: SideProps & { pet: Pet; index: number; onRoll: (r: RollRequest) => void }) {
  const { character: c, state: owner, pet, index, extras, canEdit, canEditExtras, updateExtras, onRoll } = props;
  const id = petStateId(c.id, index);
  const { states } = useLiveStates();
  const s = states[id];
  const token = useLinkedToken(s ? id : undefined);
  const npcs = useNpcOptions();
  const { roll } = useActions();
  const [editing, setEditing] = useState(false);
  const [vsPrey, setVsPrey] = useState(false);
  const [preyFirst, setPreyFirst] = useState(false);
  const kind = kindOf(pet);
  const f = featuresOf(c);
  const stats: PetStats = extras.pets?.[index] ?? {};
  const name = extras.names?.[`pet:${index}`] ?? pet.name;
  const setStats = (fn: (p: PetStats) => PetStats) => updateExtras((x) => ({ ...x, pets: { ...x.pets, [index]: fn(x.pets?.[index] ?? {}) } }));
  const shared = kind === "eidolon";
  const hpState = shared && owner ? owner : s;
  const ocls = owner?.cls;
  const target = npcs.find((n) => n.tok === owner?.target);

  const create = (maxHp: number, ac: number) =>
    live.write({
      v: 1,
      id,
      name,
      owner: owner?.owner,
      ownerName: owner?.ownerName,
      level: c.level,
      maxHp,
      baseAc: ac,
      acAdj: 0,
      cond: {},
      hp: maxHp,
      temp: 0,
      dying: 0,
      wounded: 0,
      hero: 0,
      pet: { parent: c.id, index, type: pet.type, shared: shared || undefined },
      t: Date.now(),
    });

  const link = async () => {
    if (!s) return;
    let ids = (await OBR.player.getSelection()) ?? [];
    const last = store.lastSelection();
    if (!ids.length && last && Date.now() - last.t < 120_000) ids = last.ids;
    if (ids.length === 1) await linkToken(ids[0], { id, name }, s.owner);
    else OBR.notification.show("Selecciona el token de la mascota en el mapa y vuelve a pulsar Vincular.", "INFO");
  };

  const rollStat = (label: string, mod: number, ctx: RollCtx) => {
    const a = checkAdjust(s?.cond, ctx);
    onRoll({ label: `${name}: ${label}`, formula: `1d20${fmtMod(mod + a.total)}`, kind: "check", notes: modsText(a.applied) || undefined, charName: name, charId: id });
  };
  // La presa y la ventaja del explorador se comparten con su compañero
  const flurry = (ocls?.edge ?? f.edge) === "flurry" && vsPrey;
  const mapStep = (at: PetAttack) => (flurry ? (at.agile ? 2 : 3) : at.agile ? 4 : 5);
  const rollAttack = (at: PetAttack, i: number) => {
    const a = checkAdjust(s?.cond, { kind: "attack", melee: true, finesse: false });
    onRoll({
      label: `${name}: ${at.name || "Ataque"}${i ? ` (${i + 1}º)` : ""}`,
      formula: `1d20${fmtMod(at.attack + a.total - mapStep(at) * i)}`,
      kind: "check",
      notes: modsText(a.applied) || undefined,
      charName: name,
      charId: id,
      vs: target ? { dc: target.ac, name: target.name } : undefined,
      fx: target ? { kind: "slash", to: target.tok } : undefined,
    });
  };
  // Daño con Potenciar eidolón, Sobrecarga compartida (constructo) y precisión del explorador
  const damageOf = (at: PetAttack) => {
    const mods: Mod[] = [...checkAdjust(s?.cond, { kind: "damage", melee: true }).applied];
    if (kind === "eidolon" && ocls?.boost) mods.push({ label: "Potenciar eidolón", type: "status", value: Math.min(8, 2 * diceCount(at.damage)) });
    if (kind === "construct" && ocls?.od?.b) mods.push({ label: "Sobrecarga", type: "untyped", value: ocls.od.b });
    const { total, applied } = stackMods(mods);
    let formula = at.damage + (total ? fmtMod(total) : "");
    const notes = [modsText(applied)];
    if ((ocls?.edge ?? f.edge) === "precision" && vsPrey && preyFirst) {
      formula += `+${rangerPrecisionDice(c.level)}d8`;
      notes.push("Precisión (presa)");
    }
    return { formula, notes: notes.filter(Boolean).join(" · ") };
  };
  const rollDamage = async (at: PetAttack, crit: boolean) => {
    const d = damageOf(at);
    const r = await roll({ label: `${name}: ${at.name || "Ataque"} (${crit ? "crítico" : "daño"})`, formula: d.formula, kind: "damage", crit, notes: d.notes || undefined, charName: name, charId: id });
    if (preyFirst) setPreyFirst(false);
    if (r && target) {
      const rid = newId();
      await damageReqs.set(rid, { id: rid, from: id, fromName: name, tok: target.tok, n: target.name, amt: r.total, ty: "", crit, label: at.name || "Ataque", t: Date.now() });
    }
  };
  const attacks = stats.attacks ?? [];
  const setAttack = (i: number, patch: Partial<PetAttack>) => setStats((p) => ({ ...p, attacks: (p.attacks ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  // Familiar: PG automáticos y CA del amo
  const famHp = familiarHp(c.level, !!stats.tough);
  const setTough = (on: boolean) => {
    setStats((p) => ({ ...p, tough: on || undefined }));
    if (s) live.patch(id, (x) => ({ ...x, maxHp: familiarHp(c.level, on), hp: Math.min(x.hp, familiarHp(c.level, on)) }));
  };

  return (
    <section className={`pet k-${kind}`}>
      <div className="pet-head">
        <EditableName
          className="pet-name"
          value={name}
          canEdit={canEditExtras}
          onChange={(v) => updateExtras((x) => ({ ...x, names: { ...x.names, [`pet:${index}`]: v || pet.name } }))}
        />
        <span className="badge">{PET_TYPE[pet.type] ?? pet.type}</span>
        {pet.animal && <span className="muted small">{pet.animal}</span>}
        {canEditExtras && (
          <button className={`btn ghost small-btn pet-edit ${editing ? "on" : ""}`} onClick={() => setEditing((e) => !e)}>
            {editing ? "Listo" : "✎ Editar"}
          </button>
        )}
      </div>

      {s && hpState ? (
        <PetVitals s={s} hp={hpState} shared={shared} canEdit={canEdit} linked={!!token} onLink={link} onUnlink={() => token && unlinkToken(token.id)} />
      ) : kind === "eidolon" ? (
        <PetSetup canEdit={canEdit} onCreate={(_, ac) => create(owner?.maxHp ?? c.maxHp, ac)} hint="El eidolón comparte los PG con su invocador. Escribe su CA para activarlo." presetHp={owner?.maxHp ?? c.maxHp} />
      ) : kind === "familiar" ? (
        <PetSetup canEdit={canEdit} onCreate={create} hint={`Los familiares tienen ${c.level * 5} PG (5 por nivel) y tu CA.`} presetHp={famHp} presetAc={c.ac} />
      ) : (
        <PetSetup canEdit={canEdit} onCreate={create} />
      )}
      {kind === "familiar" && (
        <label className="te-check">
          <input type="checkbox" checked={!!stats.tough} disabled={!canEditExtras} onChange={(e) => setTough(e.target.checked)} />
          Resistente (+2 PG por nivel) · PG máx {famHp}
        </label>
      )}
      {s && editing && (
        <div className="pet-max">
          {!shared && (
            <label>
              PG máx
              <input
                inputMode="numeric"
                defaultValue={s.maxHp}
                onBlur={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (n > 0) live.patch(id, (x) => ({ ...x, maxHp: n, hp: Math.min(x.hp, n) }));
                }}
              />
            </label>
          )}
          <label>
            CA
            <input
              inputMode="numeric"
              defaultValue={s.baseAc}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10);
                if (n > 0) live.patch(id, (x) => ({ ...x, baseAc: n }));
              }}
            />
          </label>
        </div>
      )}

      <div className="pet-stats">
        {STATS.map((st) => {
          const mod = stats.mods?.[st.key];
          if (editing) {
            return (
              <label key={st.key} className="pet-stat edit">
                <span>{st.label}</span>
                <input
                  inputMode="numeric"
                  defaultValue={mod === undefined ? "" : fmtMod(mod)}
                  placeholder="—"
                  onBlur={(e) => {
                    const t = e.target.value.trim();
                    setStats((p) => {
                      const mods = { ...p.mods };
                      if (t === "") delete mods[st.key];
                      else mods[st.key] = parseMod(t);
                      return { ...p, mods };
                    });
                  }}
                />
              </label>
            );
          }
          if (mod === undefined) return null;
          const adj = mod + checkAdjust(s?.cond, st.ctx).total;
          return (
            <button key={st.key} className="pet-stat" onClick={() => rollStat(st.label, mod, st.ctx)}>
              <span>{st.label}</span>
              <b className={adj < mod ? "down" : ""}>{fmtMod(adj)}</b>
            </button>
          );
        })}
        {!editing && !Object.keys(stats.mods ?? {}).length && (
          <p className="muted small">Pulsa “✎ Editar” para escribir sus modificadores y poder tirar.</p>
        )}
      </div>

      {kind === "familiar" && <FamiliarAbilities stats={stats} defaults={pet.abilities ?? []} canEdit={canEditExtras} setStats={setStats} />}

      {kind !== "familiar" && (
        <div className="pet-attacks">
          {!editing && ocls?.prey && (f.edge || ocls.edge) && (
            <div className="strike-opts">
              <button className={`chip ${vsPrey ? "on" : ""}`} title="Comparte la presa y la ventaja de su explorador" onClick={() => setVsPrey((v) => !v)}>
                Contra la presa
              </button>
              {vsPrey && (ocls.edge ?? f.edge) === "precision" && (
                <button className={`chip ${preyFirst ? "on" : ""}`} onClick={() => setPreyFirst((v) => !v)}>
                  1er ataque (precisión)
                </button>
              )}
            </div>
          )}
          {attacks.map((at, i) =>
            editing ? (
              <div key={`${i}:${attacks.length}`} className="pet-attack edit">
                <input placeholder="Ataque" defaultValue={at.name} onBlur={(e) => setAttack(i, { name: e.target.value })} />
                <input className="sm" placeholder="+0" defaultValue={fmtMod(at.attack)} onBlur={(e) => setAttack(i, { attack: parseMod(e.target.value) })} />
                <input className="md" placeholder="1d8+2" defaultValue={at.damage} onBlur={(e) => setAttack(i, { damage: e.target.value.trim() })} />
                <button className={`chip ${at.agile ? "on" : ""}`} onClick={() => setAttack(i, { agile: !at.agile })}>
                  Ágil
                </button>
                <button className="row-x" title="Quitar" onClick={() => setStats((p) => ({ ...p, attacks: (p.attacks ?? []).filter((_, j) => j !== i) }))}>
                  ✕
                </button>
              </div>
            ) : (
              <div key={i} className="weapon">
                <div className="weapon-head">
                  <b>{at.name || "Ataque"}</b>
                  <span className="muted small" title={damageOf(at).notes || undefined}>
                    {damageOf(at).formula}
                  </span>
                </div>
                <div className="weapon-btns">
                  {[0, 1, 2].map((m) => (
                    <button key={m} className="btn" onClick={() => rollAttack(at, m)}>
                      {fmtMod(at.attack - mapStep(at) * m)}
                    </button>
                  ))}
                  <button className="btn" disabled={!at.damage} onClick={() => rollDamage(at, false)}>
                    Daño
                  </button>
                  <button className="btn crit" disabled={!at.damage} onClick={() => rollDamage(at, true)}>
                    Crítico
                  </button>
                </div>
              </div>
            ),
          )}
          {editing && (
            <button className="btn ghost" onClick={() => setStats((p) => ({ ...p, attacks: [...(p.attacks ?? []), { name: "", attack: 0, damage: "" }] }))}>
              + Ataque
            </button>
          )}
        </div>
      )}

      {kind === "animal" && (
        <label className="pet-note">
          <span>Beneficio de apoyo</span>
          <textarea
            className="feat-notes"
            placeholder="Qué hace cuando usa Apoyar…"
            value={stats.support ?? ""}
            readOnly={!canEditExtras}
            onChange={(e) => setStats((p) => ({ ...p, support: e.target.value || undefined }))}
          />
        </label>
      )}
      {(kind === "eidolon" || kind === "construct") && (
        <label className="pet-note">
          <span>{kind === "eidolon" ? "Habilidad especial" : "Innovación especial"}</span>
          <textarea
            className="feat-notes"
            placeholder="Detalla aquí…"
            value={stats.special ?? ""}
            readOnly={!canEditExtras}
            onChange={(e) => setStats((p) => ({ ...p, special: e.target.value || undefined }))}
          />
        </label>
      )}
      <label className="pet-note">
        <span>Notas</span>
        <textarea
          className="feat-notes"
          placeholder="Notas de la mascota…"
          value={stats.notes ?? ""}
          readOnly={!canEditExtras}
          onChange={(e) => setStats((p) => ({ ...p, notes: e.target.value || undefined }))}
        />
      </label>
    </section>
  );
}

// Siervos del nigromante: 1 PG, sin defensas; atacan con el ataque de conjuro y hacen 1d6
function Thralls(props: SideProps) {
  const { character: c, state, canEdit, patch, extras, canEditExtras, updateExtras } = props;
  const tokens = useSceneTokens();
  const npcs = useNpcOptions();
  const { playFx, roll } = useActions();
  const list = state?.cls?.thralls ?? [];
  const caster = c.casters.find((k) => k.type === "focus") ?? c.casters[0];
  const atkAdj = checkAdjust(state?.cond, { kind: "spell-attack" });
  const attack = (caster?.attack ?? 0) + atkAdj.total;
  const target = npcs.find((n) => n.tok === state?.target);
  const nameOf = (tok: string) => tokens.find((t) => t.item.id === tok)?.item.name || "Siervo";
  const destroy = (tok: string) => patch((s) => ({ ...s, cls: { ...s.cls, thralls: (s.cls?.thralls ?? []).filter((t) => t.tok !== tok) } }));
  return (
    <section className="pet thralls">
      <div className="pet-head">
        <b className="pet-name">Siervos</b>
        <span className="badge">{list.length} activos</span>
        <select
          className="fx-select"
          value={extras.cls?.thrallFx ?? "void"}
          disabled={!canEditExtras}
          title="Efecto al crear siervos"
          onChange={(e) => updateExtras((x) => ({ ...x, cls: { ...x.cls, thrallFx: e.target.value as "void" | "spirit" } }))}
        >
          <option value="void">✦ Vacío</option>
          <option value="spirit">✦ Espíritus</option>
        </select>
      </div>
      {!list.length && <p className="muted small">Lanza Create Thrall (pestaña Magia) o vincula/crea tus siervos aquí.</p>}
      <ThrallLinker {...props} max={featuresOf(c).puppeteer ? 3 : 2} color={extras.cls?.colors?.[extras.cls?.thrallFx ?? "void"] ?? defaultColor(extras.cls?.thrallFx ?? "void")} />
      {list.map((t, idx) => (
        <div key={t.tok} className="weapon">
          <div className="weapon-head">
            <b>{nameOf(t.tok)}</b>
            <span className="muted small">1 PG · {t.ch ? "2d6 (carga)" : "1d6"}</span>
            <button className="link-btn" disabled={!canEdit} onClick={() => destroy(t.tok)}>
              Destruir
            </button>
          </div>
          <div className="weapon-btns">
            {[0, 1, 2].map((m) => (
              <button
                key={m}
                className="btn"
                onClick={() => {
                  roll({
                    label: `Siervo ${idx + 1}: ataque${m ? ` (${m + 1}º)` : ""}`,
                    formula: `1d20${fmtMod(attack - 5 * m)}`,
                    kind: "check",
                    notes: modsText(atkAdj.applied) || undefined,
                    vs: target ? { dc: target.ac, name: target.name } : undefined,
                  });
                  if (target) playFx({ kind: "impact", from: t.tok, to: target.tok });
                }}
              >
                {fmtMod(attack - 5 * m)}
              </button>
            ))}
            {[false, true].map((crit) => (
              <button
                key={String(crit)}
                className={`btn ${crit ? "crit" : ""}`}
                onClick={async () => {
                  const formula = t.ch ? "2d6" : "1d6";
                  const r = await roll({ label: `Siervo ${idx + 1}: ${crit ? "crítico" : "daño"}`, formula, kind: "damage", crit });
                  if (r && target) {
                    const id = newId();
                    await damageReqs.set(id, { id, from: c.id, fromName: c.name, tok: target.tok, n: target.name, amt: r.total, ty: "", crit, label: `Siervo ${idx + 1}`, t: Date.now() });
                  }
                }}
              >
                {crit ? "Crítico" : "Daño"}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function PetPanel(props: SideProps & { onRoll: (r: RollRequest) => void }) {
  const pets = props.character.pets ?? [];
  const f = featuresOf(props.character);
  return (
    <div className="side-panel">
      <PanelHead title={pets.length > 1 ? "Mascotas" : "Mascota"} />
      {pets.map((pet, i) => (
        <PetCard key={i} {...props} pet={pet} index={i} />
      ))}
      {f.thrall && <Thralls {...props} />}
    </div>
  );
}
