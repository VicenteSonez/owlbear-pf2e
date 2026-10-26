// Pestaña de sanación: descansar, ayudas contra el daño persistente, botiquín de sanador,
// Primeros auxilios y, con Medicina entrenada, Tratar heridas.
import { useState } from "react";
import { fmtMod } from "../../pathbuilder";
import { live, useLiveStates, type PcState } from "../../live";
import { DEGREE_LABEL, checkAdjust, deathAt, persistentByType, persistentFlatDc, recoveryDc, type Degree, type PersAid, type PersImprovement } from "../../rules";
import type { HealPrefs } from "../../extras";
import { healTarget, dealDamage } from "../../damage";
import { useActions } from "../ctx";
import { PanelHead } from "./common";
import { IconBed } from "./icons";
import { inventoryRows } from "./InventoryPanel";
import type { SideProps } from "./types";

// Actividades que piden botiquín (se puede marcar a mano cada una)
const KIT_ACTIVITIES: { id: string; label: string }[] = [
  { id: "firstaid", label: "Primeros auxilios" },
  { id: "treat", label: "Tratar heridas" },
];

// Mejoras más comunes contra el daño persistente (dotes)
const PRESETS: PersImprovement[] = [
  { ty: "", dc: 10, adc: 5 },
  { ty: "fuego", dc: 10, adc: 5 },
  { ty: "sangrado", dc: 10, adc: 5 },
];

// Tratar heridas: CD según el rango en Medicina y su curación extra
const TREAT_TIERS: { dc: number; prof: number; bonus: number; label: string }[] = [
  { dc: 15, prof: 2, bonus: 0, label: "Entrenado" },
  { dc: 20, prof: 4, bonus: 10, label: "Experto" },
  { dc: 30, prof: 6, bonus: 30, label: "Maestro" },
  { dc: 40, prof: 8, bonus: 50, label: "Legendario" },
];

export function HealPanel({ character: c, state, extras, canEdit, canEditExtras, updateExtras, patch }: SideProps) {
  const { roll, notify } = useActions();
  const { states } = useLiveStates();
  const prefs: HealPrefs = extras.heal ?? {};
  const setPrefs = (fn: (p: HealPrefs) => HealPrefs) => updateExtras((x) => ({ ...x, heal: fn(x.heal ?? {}) }));
  const [bonus, setBonus] = useState(prefs.restBonus ?? "");
  const [ally, setAlly] = useState("");
  const [aidMode, setAidMode] = useState<"stabilize" | "bleed">("stabilize");
  const [aidResult, setAidResult] = useState<{ who: string; degree: Degree; mode: "stabilize" | "bleed" } | null>(null);
  const [tier, setTier] = useState(15);
  const [imp, setImp] = useState<PersImprovement>({ ty: "", dc: 10, adc: 5 });

  const aid: PersAid = state?.aid ?? {};
  const patchAid = (fn: (a: PersAid) => PersAid) =>
    patch((s) => {
      const next = fn(s.aid ?? {});
      return { ...s, aid: next.assist || next.imp?.length ? next : undefined };
    });

  // Botiquín: si está en el inventario o se marcó a mano (en general o para la actividad)
  const kitInInventory = inventoryRows(c, extras).some(
    (r) => /healer'?s?\s*(tool\s*kit|toolkit|tools)/i.test(extras.names?.[r.key] ?? r.name) && (extras.qty?.[r.key] ?? r.qty) > 0,
  );
  const hasKit = (activity: string) => kitInInventory || !!prefs.kit || !!prefs.kitFor?.includes(activity);

  const medicine = c.skills.find((s) => s.key === "medicine");
  const medProf = medicine?.prof ?? 0;
  const medMod = (medicine?.mod ?? 0) + checkAdjust(state?.cond, { kind: "skill", key: "medicine", ability: "wis" }).total;
  const people = Object.values(states).sort((a, b) => a.name.localeCompare(b.name));
  const allyId = ally || state?.id || "";
  const who: PcState | undefined = states[allyId];

  // ---------- Descanso ----------
  const restHeal = Math.max(1, c.abilities.con * c.level);
  const rest = async () => {
    if (!state) return;
    const extra = bonus.trim().replace(/^\+/, "");
    const formula = `${restHeal}${extra ? `+${extra}` : ""}`;
    // Primero se quitan Fatigado y un punto de Drenado (así cura hasta el máximo nuevo)
    await live.patch(state.id, (s) => ({
      ...s,
      cond: { ...s.cond, fatigued: undefined, drained: Math.max(0, (s.cond.drained ?? 0) - 1) || undefined },
      res: { ...s.res, used: undefined, focus: undefined },
    }));
    const r = await roll({ label: "Descanso", title: "Descanso", formula, kind: "damage", notes: "Constitución × nivel", tag: "Curación" });
    if (r) await healTarget({ kind: "pc", id: state.id }, r.total);
    await notify({ label: "Descansa:", title: c.name, detail: "Sin Fatigado · Drenado −1 · espacios de conjuro y foco recuperados", tag: "Descanso" });
  };

  // ---------- Primeros auxilios ----------
  const firstAid = async () => {
    if (!who) return;
    if (aidMode === "stabilize") {
      const dc = 5 + recoveryDc(who);
      const r = await roll({ label: `Primeros auxilios: estabilizar a ${who.name}`, title: "Estabilizar", formula: `1d20${fmtMod(medMod)}`, kind: "check", vs: { dc, name: who.name, showDc: true }, tag: "Medicina" });
      if (!r?.degree) return;
      if (r.degree === "crit-failure") {
        await live.patch(who.id, (s) => ({ ...s, dying: Math.min(deathAt(s), s.dying + 1) }));
        await notify({ label: "Fallo crítico al estabilizar:", title: who.name, detail: "Moribundo +1", tag: "Medicina" });
      }
      setAidResult({ who: who.id, degree: r.degree, mode: "stabilize" });
    } else {
      const r = await roll({ label: `Primeros auxilios: detener el sangrado de ${who.name}`, title: "Detener el sangrado", formula: `1d20${fmtMod(medMod)}`, kind: "check", tag: "Medicina" });
      if (r) setAidResult({ who: who.id, degree: r.degree ?? "success", mode: "bleed" });
    }
  };
  const stabilize = async (id: string) => {
    // Pierde moribundo (queda estable e inconsciente): como siempre al perderlo, herido +1
    await live.patch(id, (s) => ({ ...s, dying: 0, wounded: s.dying > 0 ? s.wounded + 1 : s.wounded }));
    await notify({ label: "Estabilizado:", title: states[id]?.name ?? "", detail: "Sin moribundo; sigue inconsciente a 0 PG", tag: "Medicina" });
    setAidResult(null);
  };
  const giveAssist = async (id: string) => {
    await live.patch(id, (s) => ({ ...s, aid: { ...s.aid, assist: true } }));
    await notify({ label: "Asiste contra el daño persistente de", title: states[id]?.name ?? "", detail: "Su próxima prueba plana es más fácil", tag: "Medicina" });
    setAidResult(null);
  };

  // ---------- Tratar heridas ----------
  const treat = async () => {
    if (!who) return;
    const t = TREAT_TIERS.find((x) => x.dc === tier) ?? TREAT_TIERS[0];
    const r = await roll({ label: `Tratar heridas a ${who.name} (CD ${t.dc})`, title: "Tratar heridas", formula: `1d20${fmtMod(medMod)}`, kind: "check", vs: { dc: t.dc, name: who.name, showDc: true }, tag: "Medicina" });
    if (!r?.degree) return;
    if (r.degree === "crit-failure") {
      const d = await roll({ label: `Tratar heridas: fallo crítico (${who.name})`, formula: "1d8", kind: "damage", tag: "Medicina" });
      if (d) await dealDamage({ kind: "pc", id: who.id }, d.total);
      return;
    }
    if (r.degree === "failure") return;
    const dice = r.degree === "crit-success" ? "4d8" : "2d8";
    const h = await roll({ label: `Tratar heridas → ${who.name}`, title: "Curación", formula: `${dice}${t.bonus ? `+${t.bonus}` : ""}`, kind: "damage", tag: "Curación" });
    if (!h) return;
    await healTarget({ kind: "pc", id: who.id }, h.total);
    // Tratar heridas quita la condición de herido
    await live.patch(live.hpHolder(who.id), (s) => ({ ...s, wounded: 0 }));
  };

  const persList = persistentByType(state?.cond.persistent);
  const allyPicker = (
    <select value={allyId} onChange={(e) => setAlly(e.target.value)} title="A quién">
      {people.map((s) => (
        <option key={s.id} value={s.id}>
          {s.id === state?.id ? `${s.name} (tú)` : s.name}
          {s.dying ? ` · moribundo ${s.dying}` : ""}
        </option>
      ))}
    </select>
  );

  return (
    <div className="side-panel heal-panel">
      <PanelHead title="Sanación" />

      <button className="rest-btn" disabled={!canEdit || !state} onClick={rest} title="Cura Constitución × nivel, quita Fatigado, baja Drenado en 1 y recupera los espacios de conjuro">
        <IconBed />
        <span>
          <b>Descansar</b>
          <small>
            Cura {restHeal}
            {bonus.trim() ? ` + ${bonus.trim().replace(/^\+/, "")}` : ""} PG · quita Fatigado · Drenado −1 · recupera espacios
          </small>
        </span>
      </button>
      <div className="cb-row">
        <span className="muted small">Bono a la curación</span>
        <input
          className="sm2"
          placeholder="+2 / 1d8"
          value={bonus}
          disabled={!canEditExtras}
          onChange={(e) => setBonus(e.target.value)}
          onBlur={() => setPrefs((p) => ({ ...p, restBonus: bonus.trim() || undefined }))}
        />
      </div>

      <h3>Daño persistente</h3>
      <div className="cb-row">
        <button className={`btn ${aid.assist ? "on" : ""}`} disabled={!canEdit} onClick={() => patchAid((a) => ({ ...a, assist: !a.assist || undefined }))} title="Con asistencia la prueba plana es CD 10 (se gasta en la próxima prueba)">
          🤝 Asistencia {aid.assist ? "activa" : "apagada"}
        </button>
        {persList.length > 0 && (
          <span className="muted small">
            {persList.map(({ top: p }) => `${p.type || "sin tipo"}: CD ${persistentFlatDc(p.type, aid)}`).join(" · ")}
          </span>
        )}
      </div>
      <div className="pers-imps">
        {(aid.imp ?? []).map((m, i) => (
          <div key={i} className="cb-row">
            <span className="chip on">{m.ty || "Todo persistente"}</span>
            <span className="muted small">
              CD {m.dc} · con asistencia {m.adc}
            </span>
            {canEdit && (
              <button className="row-x" title="Quitar" onClick={() => patchAid((a) => ({ ...a, imp: (a.imp ?? []).filter((_, j) => j !== i) }))}>
                ✕
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <>
            <div className="cb-row">
              <span className="muted small">Mejoras de dotes:</span>
              {PRESETS.map((p) => (
                <button key={p.ty || "all"} className="chip" onClick={() => patchAid((a) => ({ ...a, imp: [...(a.imp ?? []).filter((x) => x.ty !== p.ty), p] }))}>
                  + {p.ty || "Todo"} (CD {p.dc}/{p.adc})
                </button>
              ))}
            </div>
            <form
              className="cb-row"
              onSubmit={(e) => {
                e.preventDefault();
                patchAid((a) => ({ ...a, imp: [...(a.imp ?? []).filter((x) => x.ty !== imp.ty.trim()), { ...imp, ty: imp.ty.trim() }] }));
              }}
            >
              <input className="sm2" list="pf2-damage-types" placeholder="Tipo (vacío = todos)" value={imp.ty} onChange={(e) => setImp((v) => ({ ...v, ty: e.target.value }))} />
              <label className="range" title="CD normal">
                CD
                <input inputMode="numeric" value={imp.dc} onChange={(e) => setImp((v) => ({ ...v, dc: parseInt(e.target.value.replace(/\D/g, ""), 10) || 0 }))} />
              </label>
              <label className="range" title="CD con asistencia">
                Asist.
                <input inputMode="numeric" value={imp.adc} onChange={(e) => setImp((v) => ({ ...v, adc: parseInt(e.target.value.replace(/\D/g, ""), 10) || 0 }))} />
              </label>
              <button className="btn small-btn">+</button>
            </form>
          </>
        )}
      </div>

      <h3>Botiquín de sanador</h3>
      <div className="cb-row">
        <label className="te-check" title={kitInInventory ? "Está en tu inventario" : "Márcalo si una dote te deja usar otra cosa o no lo necesitas"}>
          <input type="checkbox" checked={kitInInventory || !!prefs.kit} disabled={kitInInventory || !canEditExtras} onChange={(e) => setPrefs((p) => ({ ...p, kit: e.target.checked || undefined }))} />
          Healer's Toolkit{kitInInventory ? " (en el inventario)" : ""}
        </label>
      </div>
      {!kitInInventory && !prefs.kit && (
        <div className="cb-row">
          <span className="muted small">Solo para:</span>
          {KIT_ACTIVITIES.map((a) => {
            const on = !!prefs.kitFor?.includes(a.id);
            return (
              <button
                key={a.id}
                className={`chip ${on ? "on" : ""}`}
                disabled={!canEditExtras}
                onClick={() => setPrefs((p) => ({ ...p, kitFor: on ? (p.kitFor ?? []).filter((x) => x !== a.id) : [...(p.kitFor ?? []), a.id] }))}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      )}

      <h3>Primeros auxilios</h3>
      {!hasKit("firstaid") ? (
        <p className="muted small">Necesitas un botiquín de sanador (o marcarlo arriba).</p>
      ) : (
        <>
          <div className="cb-row">
            {allyPicker}
            <button className={`chip ${aidMode === "stabilize" ? "on" : ""}`} onClick={() => setAidMode("stabilize")}>
              Estabilizar
            </button>
            <button className={`chip ${aidMode === "bleed" ? "on" : ""}`} onClick={() => setAidMode("bleed")}>
              Detener el sangrado
            </button>
          </div>
          <div className="cb-row">
            <button className="btn" disabled={!canEdit || !who || (aidMode === "stabilize" && !(who.dying > 0 && who.hp <= 0))} onClick={firstAid}>
              🎲 Medicina {fmtMod(medMod)}
              {aidMode === "stabilize" && who ? ` · CD ${5 + recoveryDc(who)}` : ""}
            </button>
            <span className="muted small">
              {aidMode === "stabilize"
                ? who && !(who.dying > 0 && who.hp <= 0)
                  ? "Solo a un aliado moribundo a 0 PG."
                  : "CD 5 + su CD de recuperación. Fallo crítico: moribundo +1."
                : "La CD depende del efecto: el GM dice si lo logras."}
            </span>
          </div>
          {aidResult && (
            <div className="cb-row aid-result">
              <span className={`deg ${aidResult.degree.includes("success") ? "ok" : "fail"}`}>{DEGREE_LABEL[aidResult.degree]}</span>
              {aidResult.mode === "stabilize" && aidResult.degree.includes("success") && (
                <button className="btn small-btn primary" onClick={() => stabilize(aidResult.who)}>
                  Estabilizar a {states[aidResult.who]?.name}
                </button>
              )}
              {aidResult.mode === "bleed" && (
                <button className="btn small-btn primary" onClick={() => giveAssist(aidResult.who)} title="Su próxima prueba plana contra el daño persistente es con asistencia">
                  🤝 Dar asistencia a {states[aidResult.who]?.name}
                </button>
              )}
              <button className="link-btn" onClick={() => setAidResult(null)}>
                Cerrar
              </button>
            </div>
          )}
        </>
      )}

      <h3>Medicina</h3>
      {medProf < 2 ? (
        <p className="muted small locked">🔒 Requiere estar entrenado en Medicina.</p>
      ) : (
        <div className="medicine">
          <b>Tratar heridas</b>
          {!hasKit("treat") && <p className="muted small">Necesitas un botiquín de sanador (o marcarlo arriba).</p>}
          <div className="cb-row">
            {allyPicker}
            <select value={tier} onChange={(e) => setTier(parseInt(e.target.value, 10))} title="Dificultad (las más altas curan más)">
              {TREAT_TIERS.filter((t) => medProf >= t.prof).map((t) => (
                <option key={t.dc} value={t.dc}>
                  CD {t.dc} ({t.label}) · 2d8{t.bonus ? `+${t.bonus}` : ""}
                </option>
              ))}
            </select>
            <button className="btn" disabled={!canEdit || !who || !hasKit("treat")} onClick={treat}>
              🎲 Medicina {fmtMod(medMod)}
            </button>
          </div>
          <p className="muted small">Éxito: 2d8, crítico: 4d8 (más el bono de la CD). Quita la condición de herido. Fallo crítico: 1d8 de daño.</p>
        </div>
      )}
    </div>
  );
}
