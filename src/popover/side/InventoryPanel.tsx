import { useState } from "react";
import { itemKeys } from "../../extras";
import { Counter, EditableName, PanelHead } from "./common";
import { setIn, type SideProps } from "./types";

const COINS = [
  ["pp", "Platino", "#c9d6e3"],
  ["gp", "Oro", "#e3b341"],
  ["sp", "Plata", "#b8bec8"],
  ["cp", "Cobre", "#c27a45"],
] as const;

const EQUIPPED = "Equipado";
const LOOSE = "Llevado";
const MAX_INVESTED = 10;

export function InventoryPanel({ character: c, extras, canEditExtras, updateExtras }: SideProps) {
  const [newName, setNewName] = useState("");
  const [newWhere, setNewWhere] = useState(LOOSE);
  const base = c.items ?? [];
  const keys = itemKeys(base);
  const rows = [
    ...base.map((it, i) => ({ key: keys[i], name: it.name, qty: it.qty, container: it.container ?? LOOSE, added: false })),
    ...(extras.added ?? [])
      .filter((a) => a.list === "inv")
      .map((a) => ({ key: a.key, name: a.name, qty: 1, container: a.container ?? LOOSE, added: true })),
  ];
  // Grupos con objetos; "Llevado" siempre se ofrece al agregar
  const allContainers = [...new Set([EQUIPPED, LOOSE, ...rows.map((r) => r.container)])];
  const containers = allContainers.filter((ct) => rows.some((r) => r.container === ct));
  const money = extras.money ?? c.money ?? { cp: 0, sp: 0, gp: 0, pp: 0 };
  const investedCount = rows.filter((r) => extras.invested?.[r.key]).length;
  const qtyOf = (r: (typeof rows)[number]) => extras.qty?.[r.key] ?? r.qty;

  return (
    <div className="side-panel">
      <PanelHead title="Inventario">
        <span className={`muted small ${investedCount > MAX_INVESTED ? "over" : ""}`} title="Objetos investidos (máximo 10)">
          ✦ Investidos {investedCount}/{MAX_INVESTED}
        </span>
      </PanelHead>

      <section className="money">
        {COINS.map(([k, label, color]) => (
          <div key={k} className="coin" title={label}>
            <span className="coin-dot" style={{ background: color }} />
            <b>{k}</b>
            <Counter
              value={money[k]}
              canEdit={canEditExtras}
              onChange={(v) => updateExtras((x) => ({ ...x, money: { ...money, [k]: v } }))}
            />
          </div>
        ))}
      </section>

      {containers.map((ct) => (
        <section key={ct} className="inv-group">
          <h3>{ct}</h3>
          {rows
            .filter((r) => r.container === ct)
            .map((r) => {
              const invested = !!extras.invested?.[r.key];
              return (
                <div key={r.key} className={`inv-row ${qtyOf(r) === 0 ? "empty" : ""}`}>
                  <EditableName
                    value={extras.names?.[r.key] ?? r.name}
                    canEdit={canEditExtras}
                    onChange={(v) => updateExtras((x) => ({ ...x, names: setIn(x.names, r.key, v && v !== r.name ? v : undefined) }))}
                  />
                  <button
                    className={`invest ${invested ? "on" : ""}`}
                    disabled={!canEditExtras}
                    title={invested ? "Investido (clic para quitar)" : "Marcar como investido"}
                    onClick={() => updateExtras((x) => ({ ...x, invested: setIn(x.invested, r.key, invested ? undefined : true) }))}
                  >
                    ✦
                  </button>
                  <Counter
                    value={qtyOf(r)}
                    canEdit={canEditExtras}
                    onChange={(v) => updateExtras((x) => ({ ...x, qty: setIn(x.qty, r.key, v === r.qty && !r.added ? undefined : v) }))}
                  />
                  {r.added && canEditExtras && (
                    <button
                      className="row-x"
                      title="Quitar"
                      onClick={() =>
                        updateExtras((x) => ({
                          ...x,
                          added: (x.added ?? []).filter((a) => a.key !== r.key),
                          qty: setIn(x.qty, r.key, undefined),
                          invested: setIn(x.invested, r.key, undefined),
                        }))
                      }
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
        </section>
      ))}

      {canEditExtras && (
        <form
          className="add-row"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name) return;
            const key = `inv+${Date.now().toString(36)}`;
            updateExtras((x) => ({
              ...x,
              added: [...(x.added ?? []), { key, list: "inv", name, container: newWhere === LOOSE ? undefined : newWhere }],
            }));
            setNewName("");
          }}
        >
          <input placeholder="Nuevo objeto" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <select value={newWhere} onChange={(e) => setNewWhere(e.target.value)} title="Dónde va">
            {allContainers.map((ct) => (
              <option key={ct}>{ct}</option>
            ))}
          </select>
          <button className="btn" disabled={!newName.trim()}>
            +
          </button>
        </form>
      )}
    </div>
  );
}
