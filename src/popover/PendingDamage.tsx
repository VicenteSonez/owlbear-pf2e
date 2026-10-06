// Daño que los jugadores hicieron a PNJ: el GM lo autoriza (con resistencias) o lo descarta
import { useEffect, useState } from "react";
import { addPersistent, autoIwr, type IwrPick } from "../rules";
import { newId } from "../shared";
import { patchNpc } from "../obr";
import { damageReqs, useDamageReqs, type DamageReq } from "../requests";
import { dealDamage, healTarget, readTarget, type TargetInfo } from "../damage";
import { useActions } from "./ctx";
import { IwrChips } from "./DamageBox";

function ReqRow({ r }: { r: DamageReq }) {
  const { notify } = useActions();
  const [info, setInfo] = useState<TargetInfo | null>(null);
  const [pick, setPick] = useState<IwrPick | null>(null);
  const [amt, setAmt] = useState(String(r.amt));
  // Persistentes que se aplicarán (todos marcados al llegar)
  const [persOn, setPersOn] = useState<boolean[]>(() => (r.pers ?? []).map(() => true));
  useEffect(() => {
    readTarget({ kind: "npc", tokenId: r.tok }).then(setInfo);
  }, [r.tok]);
  // Debilidad mortal: activa la mayor debilidad del objetivo aunque no coincida el tipo
  const base = autoIwr(info?.iwr, r.ty);
  const weak = info?.iwr?.weak ?? [];
  const mortalIdx = weak.length ? weak.reduce((best, w, i) => (w.v > weak[best].v ? i : best), 0) : -1;
  const auto: IwrPick = r.mortal && mortalIdx >= 0 && !base.weak.includes(mortalIdx) ? { ...base, weak: [mortalIdx] } : base;
  const cur = pick ?? auto;

  const apply = async () => {
    const n = parseInt(amt, 10);
    if (!Number.isFinite(n)) return;
    if (r.heal) {
      await healTarget({ kind: "npc", tokenId: r.tok }, n);
      await notify({ label: `${r.n} recupera`, title: `${n} PG`, detail: r.label, tag: "Curación", charName: r.fromName, secret: info?.hidden });
    } else {
      const out = await dealDamage({ kind: "npc", tokenId: r.tok }, n, { type: r.ty, pick: cur });
      const pers = (r.pers ?? []).filter((_, i) => persOn[i]);
      if (pers.length) {
        await patchNpc(r.tok, (x) => {
          let list = x.cond.persistent;
          for (const p of pers) list = addPersistent(list, { id: newId(), formula: p.f, type: p.ty, crit: r.crit || undefined });
          return { ...x, cond: { ...x.cond, persistent: list } };
        });
      }
      await notify({
        label: `${r.n} recibe`,
        title: `${out.total} de daño`,
        detail: [r.label, r.ty, out.notes, ...pers.map((p) => `+ ${p.f}${r.crit ? " ×2" : ""} persistente ${p.ty}`.trim())].filter(Boolean).join(" · "),
        tag: r.crit ? "Crítico" : "Daño",
        charName: r.fromName,
        secret: info?.hidden,
      });
    }
    await damageReqs.remove([r.id]);
  };

  return (
    <div className={`dmg-req ${r.heal ? "heal" : ""}`}>
      <div className="dr-head">
        <b>{r.fromName}</b> → <b>{r.n}</b>
        <span className="muted small">{r.label}</span>
        {r.crit && <span className="badge bad">crítico</span>}
        {r.mortal && <span className="badge bad">debilidad mortal</span>}
      </div>
      <div className="te-row">
        <input className="te-amount" inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, ""))} />
        <span className="muted small">{r.heal ? "curación" : r.ty || "sin tipo"}</span>
        <button className={`btn ${r.heal ? "heal" : "danger"}`} onClick={apply}>
          {r.heal ? "Curar" : "Aplicar"}
        </button>
        <button className="btn ghost" onClick={() => damageReqs.remove([r.id])}>
          Descartar
        </button>
      </div>
      {!r.heal && <IwrChips iwr={info?.iwr} type={r.ty} pick={cur} onPick={setPick} />}
      {r.typed?.length ? <div className="muted small">Incluye: {r.typed.join(" · ")}</div> : null}
      {(r.pers ?? []).map((p, i) => (
        <label key={i} className="te-check" title="Se agrega al PNJ (del mismo tipo queda el mayor)">
          <input type="checkbox" checked={!!persOn[i]} onChange={(e) => {
              const on = e.target.checked;
              setPersOn((l) => l.map((v, j) => (j === i ? on : v)));
            }} />
          Persistente {p.f}
          {r.crit ? " ×2" : ""} {p.ty || "sin tipo"}
        </label>
      ))}
    </div>
  );
}

export function PendingDamage() {
  const reqs = Object.values(useDamageReqs()).sort((a, b) => a.t - b.t);
  if (!reqs.length) return <p className="muted small">No hay daño pendiente de autorizar.</p>;
  return (
    <div className="dmg-reqs">
      {reqs.map((r) => (
        <ReqRow key={r.id} r={r} />
      ))}
    </div>
  );
}

export const usePendingCount = () => Object.keys(useDamageReqs()).length;
