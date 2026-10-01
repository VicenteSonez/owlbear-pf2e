import { useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { fmtMod, type Pet } from "../../pathbuilder";
import { live, petStateId, useLiveStates, type PcState } from "../../live";
import { inOwlbear, linkToken, unlinkToken } from "../../obr";
import { applyDamage, applyHealing, checkAdjust, effectiveAc, modsText, type RollCtx } from "../../rules";
import { hpColor } from "../../shared";
import { store } from "../../storage";
import type { PetAttack, PetStats } from "../../extras";
import type { RollRequest } from "../App";
import { ConditionRow } from "../bits";
import { useLinkedToken } from "../hooks";
import { EditableName, PanelHead } from "./common";
import type { SideProps } from "./types";

const PET_TYPE: Record<string, string> = {
  "Animal Companion": "Compañero animal",
  Familiar: "Familiar",
  Eidolon: "Eidolón",
  "Construct Companion": "Compañero constructo",
  "Undead Companion": "Compañero no muerto",
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

// Crea el estado en la sala de la mascota (PG y CA) para poder llevarla en el mapa
function PetSetup({ onCreate, canEdit }: { onCreate: (maxHp: number, ac: number) => void; canEdit: boolean }) {
  const [hp, setHp] = useState("");
  const [ac, setAc] = useState("");
  return (
    <form
      className="pet-setup"
      onSubmit={(e) => {
        e.preventDefault();
        const h = parseInt(hp, 10);
        if (Number.isFinite(h) && h > 0) onCreate(h, parseInt(ac, 10) || 10);
      }}
    >
      <p className="muted small">Pathbuilder no exporta los PG ni la CA de la mascota. Escríbelos para llevar su vida en la hoja y en el mapa.</p>
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

function PetVitals({ s, canEdit, onLink, onUnlink, linked }: { s: PcState; canEdit: boolean; linked: boolean; onLink: () => void; onUnlink: () => void }) {
  const [amount, setAmount] = useState("");
  const ac = effectiveAc(s.baseAc, s.acAdj, s.cond).ac;
  const pct = Math.max(0, Math.min(100, (s.hp / Math.max(1, s.maxHp)) * 100));
  const apply = (sign: 1 | -1) => {
    const n = parseInt(amount, 10);
    setAmount("");
    if (!Number.isFinite(n) || n <= 0) return;
    live.patch(s.id, (x) => (sign < 0 ? applyDamage(x, n) : applyHealing(x, n, x.maxHp)));
  };
  return (
    <div className="pet-vitals">
      <div className="pet-ac" title="CA">
        <small>CA</small>
        <b>{ac}</b>
      </div>
      <div className="pet-hp">
        <div className="mini-bar">
          <div style={{ width: `${pct}%`, background: hpColor(s.hp, s.maxHp) }} />
          <span>
            PG {s.hp}/{s.maxHp}
            {s.temp ? ` +${s.temp}` : ""}
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

function PetCard(props: SideProps & { pet: Pet; index: number; onRoll: (r: RollRequest) => void }) {
  const { character: c, state: owner, pet, index, extras, canEdit, canEditExtras, updateExtras, onRoll } = props;
  const id = petStateId(c.id, index);
  const { states } = useLiveStates();
  const s = states[id];
  const token = useLinkedToken(s ? id : undefined);
  const [editing, setEditing] = useState(false);
  const stats: PetStats = extras.pets?.[index] ?? {};
  const name = extras.names?.[`pet:${index}`] ?? pet.name;
  const setStats = (fn: (p: PetStats) => PetStats) => updateExtras((x) => ({ ...x, pets: { ...x.pets, [index]: fn(x.pets?.[index] ?? {}) } }));

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
      pet: { parent: c.id, index, type: pet.type },
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
    onRoll({ label: `${name}: ${label}`, formula: `1d20${fmtMod(mod + a.total)}`, kind: "check", notes: modsText(a.applied) || undefined, charName: name });
  };
  const rollAttack = (at: PetAttack, i: number) => {
    const a = checkAdjust(s?.cond, { kind: "attack", melee: true, finesse: false });
    const step = (at.agile ? 4 : 5) * i;
    onRoll({
      label: `${name}: ${at.name || "Ataque"}${i ? ` (${i + 1}º)` : ""}`,
      formula: `1d20${fmtMod(at.attack + a.total - step)}`,
      kind: "check",
      notes: modsText(a.applied) || undefined,
      charName: name,
    });
  };
  const attacks = stats.attacks ?? [];
  const setAttack = (i: number, patch: Partial<PetAttack>) => setStats((p) => ({ ...p, attacks: (p.attacks ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  return (
    <section className="pet">
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

      {s ? (
        <PetVitals s={s} canEdit={canEdit} linked={!!token} onLink={link} onUnlink={() => token && unlinkToken(token.id)} />
      ) : (
        <PetSetup canEdit={canEdit} onCreate={create} />
      )}
      {s && editing && (
        <div className="pet-max">
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

      <div className="pet-attacks">
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
                <span className="muted small">{at.damage}</span>
              </div>
              <div className="weapon-btns">
                {[0, 1, 2].map((m) => (
                  <button key={m} className="btn" onClick={() => rollAttack(at, m)}>
                    {fmtMod(at.attack - (at.agile ? 4 : 5) * m)}
                  </button>
                ))}
                <button
                  className="btn"
                  disabled={!at.damage}
                  onClick={() => onRoll({ label: `${name}: ${at.name || "Ataque"} (daño)`, formula: at.damage, kind: "damage", charName: name })}
                >
                  Daño
                </button>
                <button
                  className="btn crit"
                  disabled={!at.damage}
                  onClick={() => onRoll({ label: `${name}: ${at.name || "Ataque"} (crítico)`, formula: at.damage, kind: "damage", crit: true, charName: name })}
                >
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
    </section>
  );
}

export function PetPanel(props: SideProps & { onRoll: (r: RollRequest) => void }) {
  const pets = props.character.pets ?? [];
  return (
    <div className="side-panel">
      <PanelHead title={pets.length > 1 ? "Mascotas" : "Mascota"} />
      {pets.map((pet, i) => (
        <PetCard key={i} {...props} pet={pet} index={i} />
      ))}
    </div>
  );
}
