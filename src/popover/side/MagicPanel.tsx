import { fmtMod, type SpellCaster } from "../../pathbuilder";
import type { Resources } from "../../live";
import { checkAdjust, modsText } from "../../rules";
import type { RollRequest } from "../App";
import { EditableName, IconPips, PanelHead } from "./common";
import { IconFlame, IconSpark } from "./icons";
import { setIn, type SideProps } from "./types";

const TYPE_LABEL: Record<string, string> = { prepared: "Preparado", spontaneous: "Espontáneo", focus: "Foco" };
const TRADITION: Record<string, string> = { arcane: "arcana", divine: "divina", occult: "ocultista", primal: "primigenia" };

const isPrepared = (k: SpellCaster) => k.type.toLowerCase() === "prepared";
const namesAt = (list: { rank: number; names: string[] }[] | undefined, rank: number) => list?.find((s) => s.rank === rank)?.names ?? [];

export function MagicPanel(props: SideProps & { onRoll: (r: RollRequest) => void }) {
  const { character: c, state, extras, canEdit, canEditExtras, updateExtras, patch, onRoll } = props;
  const res: Resources = state?.res ?? {};
  const patchRes = (fn: (r: Resources) => Resources) => patch((s) => ({ ...s, res: fn(s.res ?? {}) }));
  // Trucos y conjuros de foco usan rango = mitad del nivel redondeado hacia arriba
  const autoRank = Math.ceil(c.level / 2);
  const casters = c.casters.filter((k) => k.type !== "focus");
  const focusCasters = c.casters.filter((k) => k.type === "focus");
  const focusCantrips = focusCasters.flatMap((f) => namesAt(f.spells, 0));
  const focusSpells = focusCasters.flatMap((f) => namesAt(f.spells, -1));
  const focusMax = c.focusMax ?? Math.min(3, focusSpells.length);
  const focusNow = Math.min(focusMax, res.focus ?? focusMax);

  const rename = (key: string, original: string) => (v: string) =>
    updateExtras((x) => ({ ...x, names: setIn(x.names, key, v && v !== original ? v : undefined) }));
  const nameOf = (key: string, original: string) => extras.names?.[key] ?? original;

  const attackOf = (k: SpellCaster) => {
    const a = checkAdjust(state?.cond, { kind: "spell-attack" });
    const d = checkAdjust(state?.cond, { kind: "spell-dc" });
    return { attack: k.attack + a.total, dc: k.dc + d.total, notes: modsText(a.applied) || undefined };
  };

  // Trucos de todos los lanzadores (preparados o del repertorio) + trucos de foco marcados
  const cantrips = casters.flatMap((k) => {
    const list = isPrepared(k) && namesAt(k.prepared, 0).length ? namesAt(k.prepared, 0) : namesAt(k.spells, 0);
    return list.map((name, i) => ({ key: `ct:${k.name}:${i}`, name, focus: false }));
  });
  cantrips.push(...focusCantrips.map((name, i) => ({ key: `fct:${i}`, name, focus: true })));

  if (!c.casters.length) {
    return (
      <div className="side-panel">
        <PanelHead title="Magia" />
        <p className="muted">Este personaje no lanza conjuros.</p>
      </div>
    );
  }

  return (
    <div className="side-panel">
      <PanelHead title="Libro de conjuros">
        <button
          className="btn ghost small-btn"
          disabled={!canEdit}
          title="Recupera todos los espacios de conjuro y los puntos de foco"
          onClick={() => patchRes((r) => ({ ...r, used: undefined, focus: undefined }))}
        >
          ↻ Restaurar
        </button>
      </PanelHead>

      {[...casters, ...focusCasters].map((k) => {
        const a = attackOf(k);
        return (
          <div key={k.name} className="book-stat">
            <b>{k.name}</b>
            <span className="muted small">
              {TRADITION[k.tradition] ?? k.tradition} · {k.innate ? "Innato" : (TYPE_LABEL[k.type.toLowerCase()] ?? k.type)}
            </span>
            <button className="btn small-btn" title={a.notes} onClick={() => onRoll({ label: `${k.name}: Ataque de conjuro`, formula: `1d20${fmtMod(a.attack)}`, kind: "check", notes: a.notes, fx: { kind: "spell" } })}>
              Ataque {fmtMod(a.attack)}
            </button>
            <span className="dc">CD {a.dc}</span>
          </div>
        );
      })}

      {cantrips.length > 0 && (
        <section className="spell-group">
          <h3>
            Trucos <span className="rank-tag">Rango {autoRank}</span>
          </h3>
          {cantrips.map((s) => (
            <div key={s.key} className={`spell-row ${s.focus ? "focus-cantrip" : ""}`} title={s.focus ? "Truco de foco" : undefined}>
              {s.focus && <span className="focus-mark">✦</span>}
              <EditableName value={nameOf(s.key, s.name)} canEdit={canEditExtras} onChange={rename(s.key, s.name)} />
            </div>
          ))}
        </section>
      )}

      {casters.map((k) =>
        (k.perDay ?? []).map((slots, rank) => {
          if (rank === 0) return null;
          const prepared = isPrepared(k);
          const listed = prepared ? namesAt(k.prepared, rank) : namesAt(k.spells, rank);
          const total = prepared ? Math.max(slots, listed.length) : slots;
          if (!total && !listed.length) return null;
          const usedKey = `${k.name}:${rank}`;
          const used = res.used?.[usedKey] ?? 0;
          return (
            <section key={`${k.name}-${rank}`} className="spell-group">
              <h3>
                Rango {rank}
                {casters.length > 1 && <span className="muted small"> · {k.name}</span>}
                {!prepared && total > 0 && (
                  <IconPips
                    value={Math.max(0, total - used)}
                    max={total}
                    icon={<IconSpark size={15} />}
                    label="Espacios disponibles"
                    canEdit={canEdit}
                    onChange={(v) => patchRes((r) => ({ ...r, used: setIn(r.used, usedKey, total - v || undefined) }))}
                  />
                )}
              </h3>
              {prepared
                ? Array.from({ length: total }, (_, i) => {
                    const key = `sp:${k.name}:${rank}:${i}`;
                    const isUsed = (used & (1 << i)) !== 0;
                    return (
                      <div key={key} className={`spell-row ${isUsed ? "used" : ""}`}>
                        <button
                          className={`cast ${isUsed ? "on" : ""}`}
                          disabled={!canEdit}
                          title={isUsed ? "Usado (clic para recuperar)" : "Marcar como lanzado"}
                          onClick={() => patchRes((r) => ({ ...r, used: setIn(r.used, usedKey, (used ^ (1 << i)) || undefined) }))}
                        >
                          {isUsed ? "✓" : ""}
                        </button>
                        <EditableName value={nameOf(key, listed[i] ?? "")} placeholder="Espacio vacío" canEdit={canEditExtras} onChange={rename(key, listed[i] ?? "")} />
                      </div>
                    );
                  })
                : listed.map((name, i) => {
                    const key = `rep:${k.name}:${rank}:${i}`;
                    return (
                      <div key={key} className="spell-row">
                        <EditableName value={nameOf(key, name)} canEdit={canEditExtras} onChange={rename(key, name)} />
                      </div>
                    );
                  })}
            </section>
          );
        }),
      )}

      {(focusSpells.length > 0 || focusMax > 0) && (
        <section className="spell-group focus">
          <h3>
            Conjuros de foco <span className="rank-tag">Rango {autoRank}</span>
            <IconPips
              value={focusNow}
              max={Math.max(1, focusMax)}
              icon={<IconFlame size={16} />}
              label="Puntos de foco"
              canEdit={canEdit}
              onChange={(v) => patchRes((r) => ({ ...r, focus: v === focusMax ? undefined : v }))}
            />
          </h3>
          {focusSpells.map((name, i) => {
            const key = `foc:${i}`;
            return (
              <div key={key} className="spell-row">
                <EditableName value={nameOf(key, name)} canEdit={canEditExtras} onChange={rename(key, name)} />
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
