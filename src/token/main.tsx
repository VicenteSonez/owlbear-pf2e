import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { patchToken, tokenData, unlinkToken, whenReady } from "../obr";
import { applyHpDelta, hpColor, type TokenData } from "../shared";
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

function TokenEditor() {
  const [item, setItem] = useState<Item | null>(null);
  const [role, setRole] = useState<"GM" | "PLAYER">("PLAYER");
  const [amount, setAmount] = useState("");

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

  const d: TokenData | undefined = item ? tokenData(item) : undefined;
  if (!item || !d) return <div className="te te-empty">Sin datos PF2e</div>;

  const patch = (p: Partial<TokenData>) => patchToken(item.id, p);
  const applyAmount = (sign: 1 | -1) => {
    const n = parseInt(amount, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    patch(applyHpDelta(d, sign * n));
    setAmount("");
  };
  const isGm = role === "GM";
  const pct = d.maxHp ? Math.max(0, Math.min(100, (d.hp / d.maxHp) * 100)) : 0;

  return (
    <div className="te">
      <div className="te-bar" title={`${d.hp}/${d.maxHp}`}>
        <div className="te-bar-fill" style={{ width: `${pct}%`, background: hpColor(d.hp, d.maxHp) }} />
        <span>
          {d.hp}/{d.maxHp}
          {d.temp ? ` (+${d.temp})` : ""} · CA {d.ac}
        </span>
      </div>
      <div className="te-row">
        <input
          className="te-amount"
          inputMode="numeric"
          placeholder="Cant."
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && applyAmount(-1)}
        />
        <button className="btn danger" onClick={() => applyAmount(-1)}>Daño</button>
        <button className="btn heal" onClick={() => applyAmount(1)}>Curar</button>
      </div>
      <div className="te-row">
        <NumField label="HP" value={d.hp} onCommit={(n) => patch({ hp: Math.min(n, d.maxHp) })} />
        {(isGm || d.kind === "npc") && (
          <NumField label="Máx" value={d.maxHp} min={1} onCommit={(n) => patch({ maxHp: n, hp: Math.min(d.hp, n) })} />
        )}
        <NumField label="Temp" value={d.temp} onCommit={(n) => patch({ temp: n })} />
        <NumField label="CA" value={d.ac} onCommit={(n) => patch({ ac: n, ...(d.kind === "npc" ? { baseAc: n } : {}) })} />
      </div>
      {isGm && (
        <div className="te-row te-small">
          {d.kind === "npc" && (
            <label className="te-check">
              <input type="checkbox" checked={!!d.hidden} onChange={(e) => patch({ hidden: e.target.checked })} />
              Ocultar a jugadores
            </label>
          )}
          {d.kind === "pc" && d.ac !== d.baseAc && (
            <button className="btn ghost" onClick={() => patch({ ac: d.baseAc })}>CA base ({d.baseAc})</button>
          )}
          <button className="btn ghost" onClick={() => unlinkToken(item.id)}>Quitar</button>
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
