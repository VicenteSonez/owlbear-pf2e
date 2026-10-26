import { useEffect, useMemo, useState } from "react";
import { fmtMod, type Character, type RuneDamage, type Weapon, type WeaponRune } from "../pathbuilder";
import type { PcState } from "../live";
import { BONUS_LABEL, FLAT_LABEL, MATERIALS, checkAdjust, hiddenFrom, modsText, targetFlatDc, type BonusType, type Degree } from "../rules";
import { applyWeaponFlags, extraKey, store, type WeaponFlags } from "../storage";
import { newId } from "../shared";
import type { CustomMod, CustomWeapon, Extras } from "../extras";
import { parseFormula } from "../dice";
import { ATTACK_FX, IMPACT_AT, SPLASH_FX, defaultWeaponFx, fxTiming, type AttackFx, type SplashFx } from "../fx";
import { featuresOf, guessSlinger, type SlingerKind } from "../classes";
import { customWeapon, deadlyDice, keepsThrown, strikeAttack, strikeDamage, weaponDice, type StrikeContext, type StrikeOpts } from "../strike";
import { AMMO, ammoRow, ammoRule, guessAmmo, selfRow, type AmmoRow } from "../ammo";
import { damageReqs } from "../requests";
import { dealDamage } from "../damage";
import { inOwlbear } from "../obr";
import { FxDir } from "./FxDir";
import { NpcPicker, useNpcOptions } from "./NpcPicker";
import { useActions } from "./ctx";
import { spellstrikeStep } from "./classActions";
import { DamageTypeList } from "./DamageBox";
import { FxColors } from "./FxColors";
import { EditableName } from "./side/common";
import { NpcStatus } from "./NpcStatus";
import { inventoryRows } from "./side/InventoryPanel";
import { setIn } from "./side/types";
import { useSceneTokens } from "./hooks";
import { distancesFrom } from "./splash";

const isDice = (t: string) => /d/i.test(t);
const validFormula = (t: string) => {
  try {
    parseFormula(t);
    return true;
  } catch {
    return false;
  }
};

const MAP_LABEL = ["1er ataque", "2º ataque", "3er ataque"];
const weaponKey = (w: Weapon) => w.key ?? w.name.toLowerCase();
const DIE_SIDES = [4, 6, 8, 10, 12];
// Runas con efecto propio (se escriben con su nombre)
const KNOWN_RUNES = ["Ghost Touch", "Returning", "Flaming", "Frost", "Shock", "Thundering", "Corrosive", "Wounding", "Holy", "Unholy"];

interface Props {
  character: Character;
  state?: PcState;
  canEdit: boolean;
  extras: Extras;
  canEditExtras: boolean;
  updateExtras: (fn: (e: Extras) => Extras) => void;
  onPatch: (fn: (s: PcState) => PcState) => void;
}

// Bonos y penalizadores del jugador para ataque y daño
function CustomMods({ extras, canEdit, update }: { extras: Extras; canEdit: boolean; update: (fn: (e: Extras) => Extras) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [type, setType] = useState<BonusType>("circumstance");
  const [to, setTo] = useState<CustomMod["to"]>("atk");
  const [dt, setDt] = useState("");
  const [pers, setPers] = useState(false);
  const [critOnly, setCritOnly] = useState(false);
  const [perDie, setPerDie] = useState(false);
  const [splash, setSplash] = useState(false);
  const [error, setError] = useState("");
  const mods = extras.mods ?? [];
  const active = mods.filter((m) => m.on);
  const set = (fn: (l: CustomMod[]) => CustomMod[]) => update((x) => ({ ...x, mods: fn(x.mods ?? []) }));
  return (
    <div className="custom-mods">
      <button className="cm-head" onClick={() => setOpen((o) => !o)}>
        <b>Bonos y penalizadores</b>
        <span className="muted small">
          {active.length ? active.map((m) => `${m.label || "Ajuste"} ${modValueText(m)}`).join(" · ") : "Ninguno activo"}
        </span>
        <span className="muted">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="cm-body">
          {mods.map((m) => (
            <div key={m.id} className="cm-row">
              <button className={`chip ${m.on ? "on" : ""}`} disabled={!canEdit} onClick={() => set((l) => l.map((x) => (x.id === m.id ? { ...x, on: !x.on } : x)))}>
                {m.on ? "Activo" : "Apagado"}
              </button>
              <span className="cm-label">{m.label || "Ajuste"}</span>
              <b className={m.value < 0 ? "down" : "up"}>{modValueText(m)}</b>
              <span className="muted small">
                {m.dice || m.pers || m.splash ? "" : `${BONUS_LABEL[m.type]} · `}
                {m.to === "atk" ? "ataque" : m.pers ? "daño persistente" : m.splash ? "salpicadura" : "daño"}
                {m.dt ? ` · ${m.dt}` : ""}
                {m.perDie ? " · por dado" : ""}
                {m.critOnly ? " · solo crítico" : ""}
              </span>
              {canEdit && (
                <button className="row-x" title="Quitar" onClick={() => set((l) => l.filter((x) => x.id !== m.id))}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <form
              className="cm-form"
              onSubmit={(e) => {
                e.preventDefault();
                const raw = value.trim().replace(/^\+/, "");
                const dmg = to === "dmg";
                const extra = {
                  dt: dmg ? dt.trim() || undefined : undefined,
                  pers: (dmg && pers) || undefined,
                  critOnly: (dmg && critOnly) || undefined,
                  perDie: (dmg && perDie) || undefined,
                  splash: (dmg && splash && !pers) || undefined,
                };
                // Al daño se puede escribir un dado (1d4) con su tipo
                if (dmg && isDice(raw)) {
                  if (!validFormula(raw)) {
                    setError("Fórmula no válida (ej. 1d4, 2d6)");
                    return;
                  }
                  set((l) => [...l, { id: newId(), label: label.trim(), value: 0, type: "untyped", to, on: true, dice: raw, ...extra }]);
                } else {
                  const v = parseInt(raw.replace(/[^\d-]/g, ""), 10);
                  if (!Number.isFinite(v) || !v) {
                    setError(dmg ? "Escribe un número (+1) o un dado (1d4)" : "Escribe un número (+1, −2)");
                    return;
                  }
                  set((l) => [...l, { id: newId(), label: label.trim(), value: v, type: pers || splash ? "untyped" : type, to, on: true, ...extra }]);
                }
                setError("");
                setLabel("");
                setValue("");
                setDt("");
                setPers(false);
                setCritOnly(false);
                setPerDie(false);
                setSplash(false);
              }}
            >
              <input placeholder="Nombre (Bendecir…)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <input className="sm" placeholder={to === "dmg" ? "+1 / 1d4" : "+1"} value={value} onChange={(e) => setValue(e.target.value)} />
              <select value={type} disabled={to === "dmg" && (isDice(value) || pers || splash)} title="Tipo de bono (los dados, el persistente y la salpicadura no se apilan por tipo)" onChange={(e) => setType(e.target.value as BonusType)}>
                <option value="status">Estado</option>
                <option value="circumstance">Circunstancial</option>
                <option value="item">Objeto</option>
                <option value="untyped">Sin tipo</option>
              </select>
              <select value={to} onChange={(e) => setTo(e.target.value as CustomMod["to"])}>
                <option value="atk">Ataque</option>
                <option value="dmg">Daño</option>
              </select>
              {to === "dmg" && (
                <>
                  <input className="md" list="pf2-damage-types" placeholder="Tipo de daño" value={dt} onChange={(e) => setDt(e.target.value)} />
                  <label className="te-check" title="Se multiplica por los dados de daño del arma (dado base + runas de golpe)">
                    <input type="checkbox" checked={perDie} onChange={(e) => setPerDie(e.target.checked)} /> Por dado
                  </label>
                  <label className="te-check" title="Se agrega al objetivo como daño persistente">
                    <input type="checkbox" checked={pers} onChange={(e) => setPers(e.target.checked)} /> Persistente
                  </label>
                  <label className="te-check" title="Daño de salpicadura: al objetivo y, con un éxito, a los que estén a 5 pies">
                    <input type="checkbox" checked={splash} onChange={(e) => setSplash(e.target.checked)} /> Salpicadura
                  </label>
                  <label className="te-check" title="Solo con crítico; ese daño no se multiplica">
                    <input type="checkbox" checked={critOnly} onChange={(e) => setCritOnly(e.target.checked)} /> Solo crítico
                  </label>
                  <DamageTypeList />
                </>
              )}
              <button className="btn">+</button>
            </form>
          )}
          {error && <p className="error small">{error}</p>}
          <p className="muted small">
            Del mismo tipo solo cuenta el mayor bono y el peor penalizador; los sin tipo se suman. Al daño también puedes poner dados (1d4) con su tipo, daño
            persistente o de salpicadura, y que sea por cada dado del arma. Lo de “solo crítico” no se multiplica.
          </p>
        </div>
      )}
    </div>
  );
}

const modValueText = (m: CustomMod) => `${m.dice ? `+${m.dice}` : fmtMod(m.value)}${m.perDie ? "/dado" : ""}`;

// Formulario para agregar un ataque a mano (arma encontrada en la partida)
function AddWeapon({ onAdd }: { onAdd: (w: CustomWeapon) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [atk, setAtk] = useState("");
  const [dmg, setDmg] = useState("");
  const [ty, setTy] = useState("");
  const [ranged, setRanged] = useState(false);
  const [error, setError] = useState("");
  if (!open) {
    return (
      <button className="btn ghost add-weapon" onClick={() => setOpen(true)}>
        + Agregar ataque
      </button>
    );
  }
  return (
    <form
      className="weapon add-weapon-form"
      onSubmit={(e) => {
        e.preventDefault();
        const a = parseInt(atk.replace(/[^\d-]/g, ""), 10);
        if (!name.trim() || !Number.isFinite(a)) {
          setError("Escribe el nombre y el bono de ataque.");
          return;
        }
        if (!validFormula(dmg.trim())) {
          setError("Daño no válido (ej. 1d8+4).");
          return;
        }
        onAdd({ id: newId(), name: name.trim(), attack: a, dmg: dmg.trim(), ty: ty.trim(), ranged: ranged || undefined });
        setOpen(false);
        setName("");
        setAtk("");
        setDmg("");
        setTy("");
        setError("");
      }}
    >
      <div className="weapon-head">
        <b>Nuevo ataque</b>
        <span className="muted small">Rasgos, runas y munición se configuran después en ⚙</span>
      </div>
      <div className="cm-form">
        <input placeholder="Nombre (Hacha +1…)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="sm" placeholder="+7" title="Bono de ataque total" value={atk} onChange={(e) => setAtk(e.target.value)} />
        <input className="md" placeholder="1d8+4" title="Daño" value={dmg} onChange={(e) => setDmg(e.target.value)} />
        <input className="md" list="pf2-damage-types" placeholder="Tipo" value={ty} onChange={(e) => setTy(e.target.value)} />
        <button type="button" className={`chip ${ranged ? "on" : ""}`} onClick={() => setRanged((v) => !v)}>
          {ranged ? "A distancia" : "Cuerpo a cuerpo"}
        </button>
        <button className="btn primary">Agregar</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          Cancelar
        </button>
        <DamageTypeList />
      </div>
      {error && <p className="error small">{error}</p>}
    </form>
  );
}

// Runas de un arma: nombre, descripción y daños extra (normal, persistente o salpicadura)
function RuneEditor({ runes, canEdit, onChange }: { runes: WeaponRune[]; canEdit: boolean; onChange: (r: WeaponRune[]) => void }) {
  const [name, setName] = useState("");
  const set = (id: string, patch: Partial<WeaponRune>) => onChange(runes.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const setDmg = (r: WeaponRune, i: number, patch: Partial<RuneDamage>) => set(r.id, { dmg: (r.dmg ?? []).map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  return (
    <div className="runes">
      {runes.map((r) => (
        <div key={r.id} className="rune-card">
          <div className="cb-row">
            <b>{r.n}</b>
            {/ghost touch|toque fantasmal/i.test(r.n) && <span className="badge">salta resistencias de incorpóreos</span>}
            {/returning|retornante/i.test(r.n) && <span className="badge">no se gasta al arrojarla</span>}
            {canEdit && (
              <button className="row-x" title="Quitar runa" onClick={() => onChange(runes.filter((x) => x.id !== r.id))}>
                ✕
              </button>
            )}
          </div>
          <textarea className="feat-notes" placeholder="Qué hace…" defaultValue={r.note} readOnly={!canEdit} onBlur={(e) => set(r.id, { note: e.target.value.trim() || undefined })} />
          {(r.dmg ?? []).map((d, i) => (
            <div key={i} className="cb-row">
              <input className="sm2" placeholder="1d6" defaultValue={d.f} disabled={!canEdit} onBlur={(e) => validFormula(e.target.value.trim()) && setDmg(r, i, { f: e.target.value.trim() })} />
              <input className="sm2" list="pf2-damage-types" placeholder="tipo" defaultValue={d.ty} disabled={!canEdit} onBlur={(e) => setDmg(r, i, { ty: e.target.value.trim() })} />
              <select value={d.kind ?? ""} disabled={!canEdit} onChange={(e) => setDmg(r, i, { kind: (e.target.value || undefined) as RuneDamage["kind"] })}>
                <option value="">Normal</option>
                <option value="pers">Persistente</option>
                <option value="splash">Salpicadura</option>
              </select>
              <button className={`chip ${d.crit ? "on" : ""}`} disabled={!canEdit} title="Solo con crítico (no se multiplica)" onClick={() => setDmg(r, i, { crit: !d.crit || undefined })}>
                Solo crítico
              </button>
              {canEdit && (
                <button className="row-x" title="Quitar daño" onClick={() => set(r.id, { dmg: (r.dmg ?? []).filter((_, j) => j !== i) })}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <button className="link-btn" onClick={() => set(r.id, { dmg: [...(r.dmg ?? []), { f: "1d6", ty: "" }] })}>
              + daño extra
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <form
          className="cb-row"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            onChange([...runes, { id: newId(), n }]);
            setName("");
          }}
        >
          <input className="sm2" list="pf2-weapon-runes" placeholder="Nueva runa…" value={name} onChange={(e) => setName(e.target.value)} />
          <datalist id="pf2-weapon-runes">
            {KNOWN_RUNES.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <button className="btn small-btn">+ Runa</button>
        </form>
      )}
    </div>
  );
}

export function AttacksTab({ character: c, state, canEdit, extras, canEditExtras, updateExtras, onPatch }: Props) {
  const { roll, notify, playFx, isGm } = useActions();
  const [flags, setFlags] = useState<Record<string, WeaponFlags>>(() => store.weaponFlags(c.id));
  const [flagsFor, setFlagsFor] = useState(c.id);
  const [fxPref, setFxPrefState] = useState(() => store.fxPref(c.id));
  const [opts, setOpts] = useState<StrikeOpts>({});
  // Arma con su configuración abierta
  const [cfg, setCfg] = useState<string | null>(null);
  // Armas cuerpo a cuerpo en modo "arrojar"
  const [throwing, setThrowing] = useState<Record<string, boolean>>({});
  // Último resultado de ataque de cada arma (para la salpicadura de un fallo)
  const [hits, setHits] = useState<Record<string, Degree>>({});
  // Salpicados elegidos a mano por arma (sin elegir: los que estén a su alcance)
  const [splashSel, setSplashSel] = useState<Record<string, string[]>>({});
  const [warn, setWarn] = useState<Record<string, string>>({});
  const [dist, setDist] = useState<Record<string, number>>({});
  if (flagsFor !== c.id) {
    setFlagsFor(c.id);
    setFlags(store.weaponFlags(c.id));
    setFxPrefState(store.fxPref(c.id));
    setOpts({});
    setCfg(null);
    setThrowing({});
    setHits({});
    setSplashSel({});
  }
  const f = featuresOf(c);
  const npcs = useNpcOptions();
  const tokens = useSceneTokens();
  const cls = state?.cls;
  const targetTok = state?.target;
  const target = npcs.find((n) => n.tok === targetTok);
  const me = `pc:${c.id}`;
  // Escondido del objetivo: lo encuentra desprevenido. Objetivo escondido u oculto: prueba plana.
  const og = !!target && hiddenFrom(state?.cond, `npc:${target.tok}`);
  const flatDc = target ? targetFlatDc(target.state.cond, me) : 0;
  const targetAc = target ? target.ac - (og && !target.state.cond.offGuard ? 2 : 0) : 0;
  const strikeTarget = target
    ? { key: `npc:${target.tok}`, tok: target.tok, cond: target.state.cond, hp: target.state.hp, maxHp: target.state.maxHp, og }
    : undefined;
  const o: StrikeOpts = { ...opts, target: strikeTarget };

  // Distancias al objetivo para la salpicadura
  useEffect(() => {
    setDist({});
    if (!targetTok || !inOwlbear) return;
    let alive = true;
    distancesFrom(targetTok)
      .then((d) => alive && setDist(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [targetTok]);

  // Quienes pueden recibir salpicadura: PNJ y PJ con token en la escena (menos el objetivo)
  const splashOptions = useMemo(
    () =>
      tokens
        .filter((t) => t.item.id !== targetTok && (isGm || t.item.visible))
        .flatMap((t) => {
          if (t.data.kind === "pc") return t.data.characterId ? [{ key: `pc:${t.data.characterId}`, tok: t.item.id, name: t.item.name || t.data.name }] : [];
          const n = npcs.find((x) => x.tok === t.item.id);
          return n ? [{ key: `npc:${n.tok}`, tok: n.tok, name: n.name }] : [];
        }),
    [tokens, targetTok, isGm, npcs],
  );

  // Inventario para la munición
  const rows: AmmoRow[] = inventoryRows(c, extras).map((r) => ({ key: r.key, name: extras.names?.[r.key] ?? r.name, qty: extras.qty?.[r.key] ?? r.qty, container: r.container }));

  const setFxPref = (p: { dir: number; on: boolean }) => {
    setFxPrefState(p);
    store.setFxPref(c.id, p);
  };
  const setFlag = (w: Weapon, patch: WeaponFlags) => {
    const key = weaponKey(w);
    const next = { ...flags, [key]: { ...flags[key], ...patch } };
    setFlags(next);
    store.setWeaponFlags(c.id, next);
  };
  const fxOf = (w: Weapon): AttackFx | "none" => flags[weaponKey(w)]?.fx ?? defaultWeaponFx(w);
  const customs = extras.weapons ?? [];
  const weapons = [...c.weapons, ...customs.map(customWeapon)].map((w) => applyWeaponFlags(w, flags[weaponKey(w)]));
  const setCustom = (id: string, patch: Partial<CustomWeapon>) =>
    updateExtras((x) => ({ ...x, weapons: (x.weapons ?? []).map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
  const customOf = (w: Weapon) => (w.custom ? customs.find((x) => `custom:${x.id}` === w.key) : undefined);
  const rename = (w: Weapon, v: string) => {
    const cw = customOf(w);
    if (cw) setCustom(cw.id, { name: v || cw.name });
    else setFlag(w, { name: v && v !== c.weapons.find((x) => weaponKey(x) === weaponKey(w))?.name ? v : undefined });
  };
  const ctxFor = (w: Weapon): StrikeContext => ({ c, s: state, x: extras, f, slinger: flags[weaponKey(w)]?.sling });
  const thrownNow = (w: Weapon) => !w.ranged && !!w.throwRange && !!throwing[weaponKey(w)];
  const optsFor = (w: Weapon): StrikeOpts => ({ ...o, thrown: thrownNow(w) });

  const setTarget = (tok: string | undefined) => onPatch((s) => ({ ...s, target: tok }));

  // ---------- Munición ----------
  const ammoOf = (w: Weapon) => {
    const thrown = thrownNow(w);
    const rule = thrown ? { self: true, reload: 0, cap: 1, kind: undefined } : ammoRule(w);
    const keep = (thrown || rule.self) && keepsThrown(w, ctxFor(w));
    const row = rule.self ? (keep ? undefined : selfRow(w, rows)) : ammoRow(w, rows);
    const loaded = rule.reload > 0 ? (extras.loaded?.[weaponKey(w)] ?? rule.cap) : undefined;
    const label = rule.self ? "se arroja" : AMMO.find((a) => a.id === rule.kind)?.label ?? row?.name;
    return { rule, keep, row, loaded, label };
  };
  // Lo que impide disparar (sin munición o sin recargar); solo lo controla el dueño de la hoja
  const blocked = (w: Weapon): string => {
    if (!canEditExtras) return "";
    const a = ammoOf(w);
    if (a.rule.reload > 0 && (a.loaded ?? 0) <= 0) return "Recarga primero.";
    if (a.rule.reload === 0 && a.row && a.row.qty <= 0) return a.rule.self ? `No te quedan ${a.row.name}.` : `Sin ${a.row.name} en el inventario.`;
    return "";
  };
  const spend = (w: Weapon) => {
    if (!canEditExtras) return;
    const a = ammoOf(w);
    const key = weaponKey(w);
    if (a.rule.reload > 0) {
      updateExtras((x) => ({ ...x, loaded: setIn(x.loaded, key, Math.max(0, (x.loaded?.[key] ?? a.rule.cap) - 1)) }));
      return;
    }
    if (a.row) {
      const row = a.row;
      updateExtras((x) => ({ ...x, qty: setIn(x.qty, row.key, Math.max(0, (x.qty?.[row.key] ?? row.qty) - 1)) }));
    }
  };
  const reload = (w: Weapon) => {
    const a = ammoOf(w);
    const key = weaponKey(w);
    if (a.row && a.row.qty <= 0) {
      setWarn((m) => ({ ...m, [key]: `Sin ${a.row!.name} para recargar.` }));
      return;
    }
    const row = a.row;
    updateExtras((x) => ({
      ...x,
      loaded: setIn(x.loaded, key, a.rule.cap),
      qty: row ? setIn(x.qty, row.key, Math.max(0, (x.qty?.[row.key] ?? row.qty) - 1)) : x.qty,
    }));
    setWarn((m) => ({ ...m, [key]: "" }));
  };

  // ---------- Salpicadura ----------
  const splashTargets = (w: Weapon, r: number) => {
    const chosen = splashSel[weaponKey(w)];
    if (chosen) return chosen;
    return splashOptions.filter((x) => x.key !== me && (dist[x.tok] ?? 99) <= r).map((x) => x.key);
  };
  const splashFxOf = (w: Weapon): SplashFx => flags[weaponKey(w)]?.splashFx ?? (w.bomb ? "burst" : "splat");
  const sendSplash = async (w: Weapon, amt: number, ty: string, keys: string[]) => {
    for (const k of keys) {
      if (k.startsWith("npc:")) {
        const tok = k.slice(4);
        const n = npcs.find((x) => x.tok === tok);
        const id = newId();
        await damageReqs.set(id, { id, from: c.id, fromName: c.name, tok, n: n?.name ?? "PNJ", amt, ty, label: `${w.name} (salpicadura)`, parts: [{ amt, ty }], splash: true, t: Date.now() });
      } else if (k.startsWith("pc:")) {
        await dealDamage({ kind: "pc", id: k.slice(3) }, amt, { type: ty });
      }
    }
  };

  // ---------- Tiradas ----------
  const attack = async (w: Weapon, mapIndex: number) => {
    const key = weaponKey(w);
    const why = blocked(w);
    if (why) {
      setWarn((m) => ({ ...m, [key]: why }));
      return;
    }
    setWarn((m) => ({ ...m, [key]: "" }));
    const ws = optsFor(w);
    const a = strikeAttack(w, ctxFor(w), ws, mapIndex);
    const base = fxOf(w);
    const fx: AttackFx | "none" = ws.thrown && base !== "none" && !ATTACK_FX.find((x) => x.id === base)?.ranged ? "spin" : base;
    // Objetivo escondido u oculto: prueba plana antes; con un fallo, el ataque falla
    if (target && flatDc) {
      const fr = await roll({ label: `${w.name}: prueba plana (${FLAT_LABEL[flatDc]})`, formula: "1d20", kind: "flat", flat: { dc: flatDc, label: FLAT_LABEL[flatDc] }, tag: "Ataque" });
      if (!fr) return;
      if (fr.degree !== "success") {
        spend(w);
        await notify({ label: `${w.name} contra ${target.name}:`, title: "Falla", detail: `No supera la prueba plana CD ${flatDc} (${FLAT_LABEL[flatDc].toLowerCase()})`, tag: "Ataque" });
        afterAttack();
        return;
      }
    }
    const r = await roll({
      label: `${w.name}: ${MAP_LABEL[mapIndex]}`,
      formula: a.formula,
      kind: "check",
      notes: [a.notes, og ? "Objetivo desprevenido (no te ve)" : ""].filter(Boolean).join(" · ") || undefined,
      vs: target ? { dc: targetAc, name: target.name } : undefined,
      tag: "Ataque",
      fx: fxPref.on && fx !== "none" ? (target ? { kind: fx, to: target.tok } : { kind: fx, dir: fxPref.dir }) : undefined,
    });
    if (!r) return;
    spend(w);
    if (r.degree) setHits((h) => ({ ...h, [key]: r.degree! }));
    // Salpicadura: se ve justo después del impacto (salvo con fallo crítico)
    const d = strikeDamage(w, ctxFor(w), ws);
    if (d.splash && target && r.degree && r.degree !== "crit-failure") {
      const delay = fx !== "none" && fxPref.on ? fxTiming(fx) * (IMPACT_AT[fx] ?? 0.8) : 0;
      const kind = splashFxOf(w);
      window.setTimeout(() => playFx({ kind, from: target.tok }), delay);
    }
    // La estratagema se gasta al usarla
    if (o.stratagem && cls?.strat) {
      onPatch((s) => ({ ...s, cls: { ...s.cls, strat: undefined } }));
      setOpts((p) => ({ ...p, stratagem: false }));
    }
    afterAttack();
    spellstrikeStep(state, onPatch, notify, playFx, { attack: w.name });
  };

  // Atacar normalmente revela al que estaba escondido (el invisible sigue escondido)
  const afterAttack = () => {
    if (state?.cond.hidden && !state.cond.invisible) onPatch((s) => ({ ...s, cond: { ...s.cond, hidden: undefined, hidFrom: undefined } }));
  };

  const damage = async (w: Weapon, crit: boolean) => {
    const d = strikeDamage(w, ctxFor(w), { ...optsFor(w), crit });
    const r = await roll({
      label: `${w.name}: ${crit ? "Crítico" : "Daño"}${w.damageType ? ` (${w.damageType})` : ""}`,
      formula: d.formula,
      extra: d.groups.map((g) => ({ f: g.f, mult: g.mult })),
      kind: "damage",
      crit,
      notes: d.notes || undefined,
      vs: undefined,
      tag: target ? `→ ${target.name}` : undefined,
    });
    if (!r) return;
    // Efectos de clase al golpear
    if (d.sneak) playFx({ kind: "rogue", from: `pc:${c.id}`, color: extras.cls?.colors?.rogue });
    if (d.finisher) {
      playFx({ kind: "finisher", from: `pc:${c.id}`, color: extras.cls?.colors?.finisher });
      onPatch((s) => ({ ...s, cls: { ...s.cls, panache: undefined } }));
      setOpts((p) => ({ ...p, finisher: false }));
    }
    if (opts.preyFirst) setOpts((p) => ({ ...p, preyFirst: false }));
    const parts = [{ amt: r.parts?.[0] ?? r.total, ty: w.damageType }, ...d.groups.map((g, i) => ({ amt: r.parts?.[i + 1] ?? 0, ty: g.ty }))];
    const splashIdx = d.groups.findIndex((g) => g.splash);
    const splashAmt = splashIdx >= 0 ? (r.parts?.[splashIdx + 1] ?? 0) : 0;
    if (target) {
      const mortal = cls?.exploit?.mode === "mortal" && cls.exploit.tok === target.tok;
      const id = newId();
      await damageReqs.set(id, {
        id,
        from: c.id,
        fromName: c.name,
        tok: target.tok,
        n: target.name,
        amt: r.total,
        ty: w.damageType,
        crit,
        label: w.name,
        mortal: mortal || undefined,
        pers: d.pers.length ? d.pers : undefined,
        parts: parts.filter((p) => p.amt > 0),
        tags: d.tags.length ? d.tags : undefined,
        t: Date.now(),
      });
      // Con éxito o crítico la salpicadura también alcanza a los de alrededor
      if (d.splash && splashAmt > 0) await sendSplash(w, splashAmt, d.splash.ty, splashTargets(w, d.splash.r));
    }
  };

  // Fallo con un arma de salpicadura: el objetivo recibe solo la salpicadura
  const splashOnly = async (w: Weapon) => {
    const d = strikeDamage(w, ctxFor(w), optsFor(w));
    if (!d.splash || !target) return;
    const r = await roll({ label: `${w.name}: salpicadura (fallo)`, formula: d.splash.f, kind: "damage", tag: `→ ${target.name}` });
    if (!r || r.total <= 0) return;
    await sendSplash(w, r.total, d.splash.ty, [`npc:${target.tok}`]);
    setHits((h) => ({ ...h, [weaponKey(w)]: "crit-failure" }));
  };

  const toggles: { key: keyof StrikeOpts; label: string; title: string; show: boolean }[] = [
    { key: "preyFirst", label: "1er ataque a la presa", title: "Precisión: +1d8 de precisión al primer ataque del turno contra tu presa", show: f.edge === "precision" && !!cls?.prey },
    { key: "flurry", label: "Ráfaga", title: "Penalizador por ataque múltiple reducido (se aplica solo contra tu presa)", show: f.edge === "flurry" },
    { key: "finisher", label: "Golpe de gracia", title: "Requiere Panache; lo gasta al tirar el daño", show: f.precise && !!cls?.panache },
    { key: "stratagem", label: `Estratagema (${cls?.strat?.v ?? "—"})`, title: "Ataque con Inteligencia usando el d20 guardado, +daño de precisión", show: f.stratagem && !!cls?.strat },
    { key: "sneak", label: "Furtivo", title: "Fuerza el Ataque furtivo (si el objetivo no figura desprevenido)", show: f.sneak > 0 },
  ];

  // Rasgos del arma en una línea (lo que se configura en ⚙)
  const traitText = (w: Weapon) =>
    [
      w.agile ? "ágil" : "",
      w.finesse && !w.ranged ? "sutil" : "",
      w.ranged ? (w.thrown ? "arrojadiza" : "a distancia") : "",
      w.throwRange ? `arrojadiza ${w.throwRange} ft` : "",
      w.deadly ? `letal d${w.deadly}` : "",
      w.fatal ? `fatal d${w.fatal}` : "",
      w.splash?.f ? `salpicadura ${w.splash.f}` : "",
      w.mat ? MATERIALS.find((m) => m.id === w.mat)?.label.toLowerCase() : "",
      ...(w.runes ?? []).map((r) => r.n.toLowerCase()),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <>
      <CustomMods extras={extras} canEdit={canEditExtras} update={updateExtras} />
      {weapons.length === 0 && !c.impulse && <p className="muted">Este personaje no tiene armas en Pathbuilder.</p>}
      {weapons.length > 0 && (
        <div className="fx-row">
          <div>
            <b>Objetivo</b>
            <NpcPicker value={targetTok} onChange={setTarget} placeholder="— Sin objetivo (dirección) —" disabled={!canEdit} />
            <span className="muted small">
              {target
                ? flatDc
                  ? `${FLAT_LABEL[flatDc]}: antes de atacar hay una prueba plana CD ${flatDc}.`
                  : "Se compara con su CA; el daño queda pendiente hasta que el GM lo autorice."
                : fxPref.on
                  ? "Sin objetivo: elige hacia dónde atacas."
                  : "Apagado: los ataques no muestran efecto."}
            </span>
          </div>
          {!target && <FxDir dir={fxPref.dir} on={fxPref.on} onChange={setFxPref} />}
        </div>
      )}
      {target && <NpcStatus state={target.state} name={target.name} />}
      {toggles.some((t) => t.show) && (
        <div className="strike-opts">
          {toggles
            .filter((t) => t.show)
            .map((t) => (
              <button key={t.key} className={`chip ${opts[t.key] ? "on" : ""}`} title={t.title} onClick={() => setOpts((p) => ({ ...p, [t.key]: !p[t.key] }))}>
                {t.label}
              </button>
            ))}
          {f.sneak > 0 && <FxColors kinds={["rogue"]} extras={extras} canEdit={canEditExtras} updateExtras={updateExtras} />}
        </div>
      )}
      {weapons.map((w) => {
        const ws = optsFor(w);
        const steps = [0, 1, 2].map((m) => strikeAttack(w, ctxFor(w), ws, m));
        const dmg = strikeDamage(w, ctxFor(w), ws);
        const crit = strikeDamage(w, ctxFor(w), { ...ws, crit: true });
        const sling = flags[weaponKey(w)]?.sling ?? guessSlinger(w);
        const key = weaponKey(w);
        const cw = customOf(w);
        const am = ammoOf(w);
        const showAmmo = am.rule.reload > 0 || !!am.row || am.rule.self;
        const why = blocked(w);
        const guess = guessAmmo(w);
        const thrown = thrownNow(w);
        const sp = dmg.splash;
        const chosen = sp ? splashTargets(w, sp.r) : [];
        return (
          <div key={key} className={`weapon ${w.custom ? "custom" : ""}`}>
            <div className="weapon-head">
              <EditableName className="weapon-name" value={w.name} canEdit={canEditExtras} onChange={(v) => rename(w, v)} />
              {w.custom && <span className="badge">agregado</span>}
              <span className="muted small" title={dmg.notes || undefined}>
                {[`${dmg.formula} ${w.damageType}`.trim(), ...dmg.groups.map((g) => `${g.f} ${g.splash ? "salpicadura" : g.ty}`.trim())].join(" + ")}
                {w.pers ? ` · ${w.pers.f} persist.${w.pers.crit ? " (crít.)" : ""}` : ""}
              </span>
              <button className={`w-cfg ${cfg === key ? "on" : ""}`} title="Rasgos, crítico, runas, munición y más opciones" onClick={() => setCfg((k) => (k === key ? null : key))}>
                ⚙
              </button>
            </div>
            {traitText(w) && <div className="w-traits muted small">{traitText(w)}</div>}
            {cfg === key && (
              <div className="w-cfg-panel">
                {cw && (
                  <div className="w-cfg-row">
                    <span className="w-sec">Ataque agregado</span>
                    <label className="range" title="Bono de ataque">
                      Ataque
                      <input className="wide" defaultValue={fmtMod(cw.attack)} onBlur={(e) => {
                        const v = parseInt(e.target.value.replace(/[^\d-]/g, ""), 10);
                        if (Number.isFinite(v)) setCustom(cw.id, { attack: v });
                      }} />
                    </label>
                    <label className="range" title="Daño">
                      Daño
                      <input className="wide" defaultValue={cw.dmg} onBlur={(e) => validFormula(e.target.value.trim()) && setCustom(cw.id, { dmg: e.target.value.trim() })} />
                    </label>
                    <label className="range" title="Tipo de daño">
                      <input className="wide" list="pf2-damage-types" placeholder="tipo" defaultValue={cw.ty} onBlur={(e) => setCustom(cw.id, { ty: e.target.value.trim() })} />
                    </label>
                    {canEditExtras && (
                      <button className="link-btn" onClick={() => updateExtras((x) => ({ ...x, weapons: (x.weapons ?? []).filter((y) => y.id !== cw.id) }))}>
                        Quitar ataque
                      </button>
                    )}
                  </div>
                )}
                <div className="w-cfg-row">
                  <span className="w-sec">Rasgos</span>
                  {!w.bomb && (
                    <button className={`chip ${w.agile ? "on" : ""}`} onClick={() => setFlag(w, { agile: !w.agile })} title="Ágil: penalizador por ataque múltiple −4/−8">
                      Ágil
                    </button>
                  )}
                  {!w.ranged && (
                    <button className={`chip ${w.finesse ? "on" : ""}`} onClick={() => setFlag(w, { finesse: !w.finesse })} title="Sutil: usa Fuerza o Destreza (Torpe lo penaliza; Débil, no)">
                      Sutil
                    </button>
                  )}
                  {!w.bomb && (
                    <button className={`chip ${w.ranged ? "on" : ""}`} onClick={() => setFlag(w, { ranged: !w.ranged })} title="A distancia o cuerpo a cuerpo">
                      {w.ranged ? "A distancia" : "Cuerpo a cuerpo"}
                    </button>
                  )}
                  {w.ranged && !w.bomb && (
                    <button className={`chip ${w.thrown ? "on" : ""}`} onClick={() => setFlag(w, { thrown: !w.thrown })} title="Arrojadiza: el daño suma Fuerza, así que Débil lo penaliza">
                      Arrojadiza
                    </button>
                  )}
                  {!w.ranged && (
                    <label className="range" title="Arma cuerpo a cuerpo que también se puede arrojar (daga, lanza…): incremento de alcance. Al arrojarla solo usa Destreza.">
                      Arrojadiza
                      <input
                        inputMode="numeric"
                        value={w.throwRange ?? ""}
                        placeholder="—"
                        onChange={(e) => {
                          const v = parseInt(e.target.value.replace(/\D/g, ""), 10);
                          setFlag(w, { throwRange: Number.isFinite(v) ? v : 0 });
                        }}
                      />
                      ft
                    </label>
                  )}
                  {w.ranged && (
                    <label className="range" title="Incremento de alcance">
                      Alcance
                      <input
                        inputMode="numeric"
                        value={w.range ?? ""}
                        placeholder="—"
                        onChange={(e) => {
                          const v = parseInt(e.target.value.replace(/\D/g, ""), 10);
                          setFlag(w, { range: Number.isFinite(v) ? v : undefined });
                        }}
                      />
                      ft
                    </label>
                  )}
                  {f.slinger && w.ranged && (
                    <select className="fx-select" value={sling} title="Precisión del pistolero" onChange={(e) => setFlag(w, { sling: e.target.value as SlingerKind })}>
                      <option value="none">Sin precisión</option>
                      <option value="crossbow">Ballesta (+{f.slingerLegend ? 3 : 2})</option>
                      <option value="pistol">Pistola (+1d{f.slingerLegend ? 6 : 4})</option>
                    </select>
                  )}
                </div>
                <div className="w-cfg-row">
                  <span className="w-sec">Crítico</span>
                  <label className="range" title={`Letal: con crítico suma dados que no se multiplican (${deadlyDice(w)} con esta arma)`}>
                    Letal
                    <select value={w.deadly ?? 0} onChange={(e) => setFlag(w, { deadly: parseInt(e.target.value, 10) })}>
                      <option value={0}>—</option>
                      {DIE_SIDES.map((s) => (
                        <option key={s} value={s}>
                          d{s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="range" title="Fatal: con crítico los dados del arma pasan a este dado y suma uno más (que no se multiplica)">
                    Fatal
                    <select value={w.fatal ?? 0} onChange={(e) => setFlag(w, { fatal: parseInt(e.target.value, 10) })}>
                      <option value={0}>—</option>
                      {DIE_SIDES.map((s) => (
                        <option key={s} value={s}>
                          d{s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="muted small" title={crit.notes}>
                    Crítico: {crit.shown}
                  </span>
                </div>
                {w.bomb && (
                  <div className="w-cfg-row">
                    <span className="w-sec">Bomba</span>
                    <label className="range" title="Daño de la bomba">
                      Daño
                      <input className="wide" defaultValue={w.dmgFormula ?? "1d6"} onBlur={(e) => setFlag(w, { dmg: e.target.value.trim() || undefined })} />
                    </label>
                    <label className="range" title="Tipo de daño">
                      <input className="wide" list="pf2-damage-types" placeholder="sin tipo" defaultValue={w.damageType} onBlur={(e) => setFlag(w, { dmgType: e.target.value.trim() })} />
                    </label>
                  </div>
                )}
                <div className="w-cfg-row">
                  <span className="w-sec">Salpicadura</span>
                  <label className="range" title="Daño de salpicadura (no se duplica con crítico; con un fallo solo lo recibe el objetivo)">
                    <input
                      className="wide"
                      placeholder="—"
                      defaultValue={w.splash?.f}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        setFlag(w, { splash: v && validFormula(v) ? { ty: "", ...w.splash, f: v } : null });
                      }}
                    />
                  </label>
                  {w.splash && (
                    <>
                      <input className="wide sm2" list="pf2-damage-types" placeholder="tipo (el del arma)" defaultValue={w.splash.ty} onBlur={(e) => setFlag(w, { splash: { ...w.splash!, ty: e.target.value.trim() } })} />
                      <label className="range" title="Alcance de la salpicadura">
                        <input
                          inputMode="numeric"
                          value={w.splash.r ?? 5}
                          onChange={(e) => {
                            const v = parseInt(e.target.value.replace(/\D/g, ""), 10);
                            setFlag(w, { splash: { ...w.splash!, r: Number.isFinite(v) && v !== 5 ? v : undefined } });
                          }}
                        />
                        ft
                      </label>
                      <select className="fx-select" value={splashFxOf(w)} title="Efecto de la salpicadura en el mapa" onChange={(e) => setFlag(w, { splashFx: e.target.value as SplashFx })}>
                        {SPLASH_FX.map((x) => (
                          <option key={x.id} value={x.id}>
                            ✦ {x.label}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                <div className="w-cfg-row">
                  <span className="w-sec">Persistente</span>
                  <label className="range" title="Daño persistente que deja el golpe (1d6)">
                    <input
                      className="wide"
                      placeholder="1d6"
                      defaultValue={w.pers?.f}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        setFlag(w, { pers: v && validFormula(v) ? { ty: "", ...w.pers, f: v } : undefined });
                      }}
                    />
                  </label>
                  {w.pers && (
                    <>
                      <input className="wide sm2" list="pf2-damage-types" placeholder="tipo (sangrado…)" defaultValue={w.pers.ty} onBlur={(e) => setFlag(w, { pers: { ...w.pers!, ty: e.target.value.trim() } })} />
                      <button className={`chip ${w.pers.crit ? "on" : ""}`} title="Solo con un crítico (y entonces no se duplica); si no, siempre, y con crítico se duplica" onClick={() => setFlag(w, { pers: { ...w.pers!, crit: w.pers!.crit ? undefined : true } })}>
                        Solo crítico
                      </button>
                    </>
                  )}
                </div>
                <div className="w-cfg-row">
                  <span className="w-sec">Material</span>
                  <select value={w.mat ?? ""} title="Activa debilidades (plata, hierro frío) y excepciones de resistencias" onChange={(e) => setFlag(w, { mat: e.target.value || "" })}>
                    <option value="">Normal</option>
                    {MATERIALS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-cfg-row column">
                  <span className="w-sec">Runas</span>
                  <RuneEditor runes={w.runes ?? []} canEdit onChange={(runes) => setFlag(w, { runes })} />
                </div>
                <div className="w-cfg-row">
                  <span className="w-sec">Munición</span>
                  <select
                    value={w.ammo ?? ""}
                    title="Qué gasta al atacar (o al recargar)"
                    onChange={(e) => setFlag(w, { ammo: e.target.value || undefined })}
                  >
                    <option value="">Automático{guess.kind ? ` (${AMMO.find((x) => x.id === guess.kind)?.label})` : guess.self ? " (se arroja el arma)" : " (ninguna)"}</option>
                    <option value="none">Sin munición</option>
                    <option value="self">El arma misma (se arroja)</option>
                    <optgroup label="Del inventario">
                      {rows
                        .filter((r) => r.container !== "Equipado" || r.name.toLowerCase() !== w.name.toLowerCase())
                        .map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.name} ×{r.qty}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                  <label className="range" title="Acciones para recargar (0 = se recarga al disparar, como los arcos)">
                    Recarga
                    <input
                      inputMode="numeric"
                      value={w.reload ?? am.rule.reload}
                      onChange={(e) => {
                        const v = parseInt(e.target.value.replace(/\D/g, ""), 10);
                        setFlag(w, { reload: Number.isFinite(v) ? v : undefined });
                      }}
                    />
                  </label>
                  {am.rule.reload > 0 && (
                    <label className="range" title="Disparos por recarga (un cargador da varios)">
                      Capacidad
                      <input
                        inputMode="numeric"
                        value={w.cap ?? am.rule.cap}
                        onChange={(e) => {
                          const v = parseInt(e.target.value.replace(/\D/g, ""), 10);
                          setFlag(w, { cap: Number.isFinite(v) && v > 0 ? v : undefined });
                        }}
                      />
                    </label>
                  )}
                  {(am.rule.self || !!w.throwRange) && (
                    <button className={`chip ${w.keep ? "on" : ""}`} title="No se gasta al arrojarla (runa Retornante u otro efecto)" onClick={() => setFlag(w, { keep: !w.keep || undefined })}>
                      No se gasta
                    </button>
                  )}
                </div>
                <div className="w-cfg-row">
                  <span className="w-sec">Efecto</span>
                  <select className="fx-select" value={fxOf(w)} title="Efecto visual de este ataque" onChange={(e) => setFlag(w, { fx: e.target.value as AttackFx | "none" })}>
                    <option value="none">✦ Sin efecto</option>
                    <optgroup label="Cuerpo a cuerpo">
                      {ATTACK_FX.filter((x) => !x.ranged).map((x) => (
                        <option key={x.id} value={x.id}>
                          ✦ {x.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="A distancia">
                      {ATTACK_FX.filter((x) => x.ranged).map((x) => (
                        <option key={x.id} value={x.id}>
                          ✦ {x.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  {w.extra
                    .filter((e) => !(/precision/i.test(e.type) && (f.precise || f.sneak > 0 || f.stratagem)))
                    .map((e) => (
                      <button
                        key={extraKey(e)}
                        className={`chip ${e.active ? "on" : ""}`}
                        onClick={() => setFlag(w, { extras: { ...flags[weaponKey(w)]?.extras, [extraKey(e)]: !e.active } })}
                        title="Sumar este daño extra (de Pathbuilder) a Daño y Crítico"
                      >
                        +{e.dice}d{e.sides} {e.type}
                      </button>
                    ))}
                  <span className="muted small">Dados del arma: {weaponDice(w)}</span>
                </div>
                <DamageTypeList />
              </div>
            )}
            {w.throwRange ? (
              <div className="extras">
                <button className={`chip ${!thrown ? "on" : ""}`} onClick={() => setThrowing((m) => ({ ...m, [key]: false }))} title="Cuerpo a cuerpo: Fuerza (o Destreza si es sutil)">
                  Cuerpo a cuerpo
                </button>
                <button className={`chip ${thrown ? "on" : ""}`} onClick={() => setThrowing((m) => ({ ...m, [key]: true }))} title={`Arrojarla (${w.throwRange} ft): ataque a distancia con Destreza; el daño suma Fuerza`}>
                  Arrojar ({w.throwRange} ft)
                </button>
              </div>
            ) : null}
            {showAmmo && (
              <div className="ammo-row">
                {am.rule.self ? (
                  am.keep ? (
                    <span className="muted small">Se arroja y vuelve (no se gasta)</span>
                  ) : am.row ? (
                    <span className={`small ${am.row.qty <= 0 ? "down" : "muted"}`}>
                      🗡 {am.row.name} ×{am.row.qty}
                    </span>
                  ) : (
                    <span className="muted small">Se gasta al arrojarla (no está en el inventario)</span>
                  )
                ) : (
                  <span className={`small ${am.row && am.row.qty <= 0 ? "down" : "muted"}`}>
                    {am.row ? `🏹 ${am.row.name} ×${am.row.qty}` : `⚠ No encuentro ${am.label ?? "munición"} en el inventario`}
                  </span>
                )}
                {am.rule.reload > 0 && (
                  <>
                    <span className={`small ${(am.loaded ?? 0) > 0 ? "up" : "down"}`}>
                      {(am.loaded ?? 0) > 0 ? `Cargada ${am.loaded}/${am.rule.cap}` : "Descargada"}
                    </span>
                    <button className="btn small-btn" disabled={!canEditExtras || (am.loaded ?? 0) >= am.rule.cap} onClick={() => reload(w)} title={`Recargar (${am.rule.reload} ${am.rule.reload === 1 ? "acción" : "acciones"})`}>
                      ↻ Recargar
                    </button>
                  </>
                )}
              </div>
            )}
            {(why || warn[key]) && <div className="error small">{warn[key] || why}</div>}
            <div className="weapon-btns">
              {steps.map((a, m) => (
                <button key={m} className={`btn ${a.value < a.base - mapStepOf(w) * m ? "down" : ""}`} title={a.notes || undefined} onClick={() => attack(w, m)}>
                  {fmtMod(a.value)}
                </button>
              ))}
              <button className="btn" onClick={() => damage(w, false)}>
                Daño
              </button>
              <button className="btn crit" title={crit.shown} onClick={() => damage(w, true)}>
                Crítico
              </button>
            </div>
            {sp && target && (
              <div className="splash-row">
                <span className="small">
                  💥 Salpicadura {sp.f} {sp.ty} · {sp.r} ft
                </span>
                <div className="sf-targets">
                  {splashOptions.map((x) => (
                    <button
                      key={x.key}
                      className={`chip ${chosen.includes(x.key) ? "on" : ""}`}
                      title={dist[x.tok] !== undefined ? `A ${dist[x.tok]} ft del objetivo` : undefined}
                      onClick={() => setSplashSel((m) => ({ ...m, [key]: chosen.includes(x.key) ? chosen.filter((k) => k !== x.key) : [...chosen, x.key] }))}
                    >
                      {x.key.startsWith("npc:") ? "◆ " : ""}
                      {x.name}
                      {dist[x.tok] !== undefined ? ` · ${dist[x.tok]} ft` : ""}
                    </button>
                  ))}
                  {!splashOptions.length && <span className="muted small">Nadie más cerca.</span>}
                </div>
                {hits[key] === "failure" && (
                  <button className="btn small-btn danger" onClick={() => splashOnly(w)} title="Con un fallo, el objetivo recibe solo la salpicadura">
                    Salpicadura al objetivo (fallo)
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {canEditExtras && <AddWeapon onAdd={(w) => updateExtras((x) => ({ ...x, weapons: [...(x.weapons ?? []), w] }))} />}
      {c.impulse && (
        <div className="weapon">
          <div className="weapon-head">
            <b>Impulsos</b>
            <span className="muted small">Kineticista (Constitución) · lista completa en la pestaña Magia</span>
          </div>
          <div className="weapon-btns">
            {(() => {
              const atk = checkAdjust(state?.cond, { kind: "impulse-attack" });
              const dc = checkAdjust(state?.cond, { kind: "impulse-dc" });
              return (
                <>
                  <button
                    className="btn"
                    title={modsText(atk.applied) || undefined}
                    onClick={() =>
                      roll({
                        label: "Ataque de impulso",
                        formula: `1d20${fmtMod(c.impulse!.attack + atk.total)}`,
                        kind: "check",
                        notes: modsText(atk.applied) || undefined,
                        vs: target ? { dc: targetAc, name: target.name } : undefined,
                      })
                    }
                  >
                    Ataque <b className={atk.total < 0 ? "down" : ""}>{fmtMod(c.impulse.attack + atk.total)}</b>
                  </button>
                  <span className="dc" title={modsText(dc.applied) || undefined}>
                    CD {c.impulse.dc + dc.total}
                  </span>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}

const mapStepOf = (w: Weapon) => (w.agile ? 4 : 5);
