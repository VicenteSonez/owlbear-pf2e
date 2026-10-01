import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { patchNpc, tokenData, unlinkToken, whenReady } from "../obr";
import { live, useLiveStates } from "../live";
import { applyDamage, applyHealing, effectiveAc, effectiveMaxHp, setHp } from "../rules";
import { hpColor, npcState } from "../shared";
import { ConditionRow } from "../popover/bits";
import "../styles.css";
import { watchForUpdates } from "../autoUpdate";

watchForUpdates();

function NumField(props: { label: string; value: number; onCommit: (n: number) => void; min?: number }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = () => {
    const n = parseInt(text, 10);
    if (Number.isFinite(n)) props.onCommit(Math.max(props.min ?? 0, n));
    else setText(String(props.value));
  };
  return (
    <label className="te-field">
      <span>{props.label}</span>
      <input
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

// Datos comunes para dibujar el editor, sea PJ (estado en la sala) o PNJ (estado en el token)
interface EditorModel {
  hp: number;
  maxHp: number;
  temp: number;
  ac: number;
  cond?: Parameters<typeof ConditionRow>[0]["cond"];
  damage: (n: number) => void;
  heal: (n: number) => void;
  setHp: (n: number) => void;
  setTemp: (n: number) => void;
  setAc: (n: number) => void;
  maxField?: (n: number) => void;
}

function TokenEditor() {
  const [item, setItem] = useState<Item | null>(null);
  const [role, setRole] = useState<"GM" | "PLAYER">("PLAYER");
  const [amount, setAmount] = useState("");
  const { states, ready } = useLiveStates();

  useEffect(() => {
    let off: (() => void) | undefined;
    whenReady().then(async (ok) => {
      if (!ok) return;
      setRole(await OBR.player.getRole());
      const sel = await OBR.player.getSelection();
      const id = sel?.[0];
      if (!id) return;
      const [it] = await OBR.scene.items.getItems([id]);
      setItem(it ?? null);
      off = OBR.scene.items.onChange((items) => {
        const found = items.find((i) => i.id === id);
        setItem(found ?? null);
      });
    });
    return () => off?.();
  }, []);

  const d = item ? tokenData(item) : undefined;
  if (!item || !d) return <div className="te te-empty">Sin datos PF2e</div>;
  const isGm = role === "GM";

  let m: EditorModel | null = null;
  if (d.kind === "pc") {
    const s = d.characterId ? states[d.characterId] : undefined;
    if (!s) return <div className="te te-empty">{ready ? "Este PJ no tiene hoja activa en la sala." : "Cargando…"}</div>;
    const maxHp = effectiveMaxHp(s.maxHp, s.level, s.cond);
    const eff = effectiveAc(s.baseAc, s.acAdj, s.cond, s.shield).ac;
    const patch = (fn: Parameters<typeof live.patch>[1]) => live.patch(s.id, fn);
    m = {
      hp: s.hp,
      maxHp,
      temp: s.temp,
      ac: eff,
      cond: s.cond,
      damage: (n) => patch((x) => applyDamage(x, n)),
      heal: (n) => patch((x) => applyHealing(x, n, effectiveMaxHp(x.maxHp, x.level, x.cond))),
      setHp: (n) => patch((x) => setHp(x, n, effectiveMaxHp(x.maxHp, x.level, x.cond))),
      setTemp: (n) => patch((x) => ({ ...x, temp: n })),
      // La CA que se escribe es la final: se guarda como ajuste sobre lo que dan hoja y condiciones
      setAc: (n) => patch((x) => ({ ...x, acAdj: x.acAdj + (n - effectiveAc(x.baseAc, x.acAdj, x.cond, x.shield).ac) })),
    };
  } else {
    const n = npcState(d);
    const eff = effectiveAc(n.baseAc, n.acAdj, n.cond).ac;
    const patch = (fn: Parameters<typeof patchNpc>[1]) => patchNpc(item.id, fn);
    m = {
      hp: n.hp,
      maxHp: n.maxHp,
      temp: n.temp,
      ac: eff,
      cond: n.cond,
      damage: (v) =>
        patch((x) => {
          const hit = applyDamage({ hp: x.hp, temp: x.temp, dying: 0, wounded: 0 }, v);
          return { ...x, hp: hit.hp, temp: hit.temp };
        }),
      heal: (v) => patch((x) => ({ ...x, hp: Math.min(x.maxHp, x.hp + v) })),
      setHp: (v) => patch((x) => ({ ...x, hp: Math.max(0, Math.min(x.maxHp, v)) })),
      setTemp: (v) => patch((x) => ({ ...x, temp: v })),
      setAc: (v) => patch((x) => ({ ...x, acAdj: x.acAdj + (v - effectiveAc(x.baseAc, x.acAdj, x.cond).ac) })),
      maxField: (v) => patch((x) => ({ ...x, maxHp: Math.max(1, v), hp: Math.min(x.hp, Math.max(1, v)) })),
    };
  }

  const apply = (sign: 1 | -1) => {
    const n = parseInt(amount, 10);
    setAmount("");
    if (!Number.isFinite(n) || n <= 0) return;
    if (sign < 0) m!.damage(n);
    else m!.heal(n);
  };
  const pct = m.maxHp ? Math.max(0, Math.min(100, (m.hp / m.maxHp) * 100)) : 0;

  return (
    <div className="te">
      <div className="te-bar" title={`${m.hp}/${m.maxHp}`}>
        <div className="te-bar-fill" style={{ width: `${pct}%`, background: hpColor(m.hp, m.maxHp) }} />
        <span>
          {m.hp}/{m.maxHp}
          {m.temp ? ` (+${m.temp})` : ""} · CA {m.ac}
        </span>
      </div>
      <div className="te-row">
        <input
          className="te-amount"
          inputMode="numeric"
          placeholder="Cant."
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && apply(-1)}
        />
        <button className="btn danger" onClick={() => apply(-1)}>
          Daño
        </button>
        <button className="btn heal" onClick={() => apply(1)}>
          Curar
        </button>
      </div>
      <div className="te-row">
        <NumField label="PG" value={m.hp} onCommit={m.setHp} />
        {isGm && m.maxField && <NumField label="Máx" value={m.maxHp} min={1} onCommit={m.maxField} />}
        <NumField label="Temp" value={m.temp} onCommit={m.setTemp} />
        <NumField label="CA" value={m.ac} onCommit={m.setAc} />
      </div>
      <ConditionRow cond={m.cond} size={16} />
      {isGm && (
        <div className="te-row te-small">
          {d.kind === "npc" && (
            <label className="te-check">
              <input
                type="checkbox"
                checked={!!d.hidden}
                onChange={(e) => patchNpc(item.id, (x) => ({ ...x, hidden: e.target.checked }))}
              />
              Ocultar a jugadores
            </label>
          )}
          <button className="btn ghost" onClick={() => unlinkToken(item.id)}>
            Quitar
          </button>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TokenEditor />
  </StrictMode>,
);
