import type DiceBoxType from "@3d-dice/dice-box";

export interface DiceTerm {
  sign: 1 | -1;
  count: number;
  sides: number;
}

export interface Formula {
  dice: DiceTerm[];
  flat: number;
}

export interface RollOutcome {
  total: number;
  detail: string;
  nat?: 1 | 20;
}

// "2d10+4+1d6-1" → dados y constante
export function parseFormula(input: string): Formula {
  const clean = input.replace(/\s+/g, "").toLowerCase();
  if (!clean || !/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(clean)) {
    throw new Error(`Fórmula no válida: "${input}"`);
  }
  const out: Formula = { dice: [], flat: 0 };
  for (const m of clean.matchAll(/([+-]?)(\d*d\d+|\d+)/g)) {
    const sign = m[1] === "-" ? -1 : 1;
    const t = m[2];
    if (t.includes("d")) {
      const [c, s] = t.split("d");
      const count = c ? parseInt(c, 10) : 1;
      const sides = parseInt(s, 10);
      if (count < 1 || count > 50 || sides < 2 || sides > 1000) throw new Error(`Dado no válido: ${t}`);
      out.dice.push({ sign, count, sides });
    } else {
      out.flat += sign * parseInt(t, 10);
    }
  }
  return out;
}

export function randomDie(sides: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % sides) + 1;
}

export function randomValues(f: Formula): number[][] {
  return f.dice.map((d) => Array.from({ length: d.count }, () => randomDie(d.sides)));
}

// Dados que tienen todos los temas instalados
const DICE_3D = new Set([4, 6, 8, 10, 12, 20]);

export interface DiceStyle {
  theme: string;
  color: string;
}

// Debe coincidir con EXTRA_THEMES en scripts/copy-dice-assets.mjs.
// Los temas "colorable" toman el color elegido; el resto trae sus propios colores.
export const DICE_THEMES: { id: string; label: string; colorable: boolean }[] = [
  { id: "default", label: "Clásico", colorable: true },
  { id: "smooth", label: "Liso", colorable: true },
  { id: "gemstone", label: "Gema", colorable: true },
  { id: "rock", label: "Piedra", colorable: true },
  { id: "rust", label: "Óxido", colorable: true },
  { id: "wooden", label: "Madera", colorable: false },
  { id: "gemstoneMarble", label: "Mármol", colorable: false },
  { id: "blueGreenMetal", label: "Metal", colorable: false },
  { id: "diceOfRolling", label: "Rolling", colorable: false },
];

export const DICE_COLORS = [
  "#d4a72c", "#e8622c", "#c0392b", "#7b1e3a", "#7d3cbe",
  "#2f6fd1", "#138a8a", "#2e8b57", "#e9e9e9", "#1d1d1f",
];

export const DEFAULT_DICE_STYLE: DiceStyle = { theme: "default", color: DICE_COLORS[0] };

export function evaluate(f: Formula, values: number[][], opts: { crit?: boolean; check?: boolean }): RollOutcome {
  let sum = f.flat;
  const parts: string[] = [];
  f.dice.forEach((d, i) => {
    const vals = values[i] ?? [];
    const s = vals.reduce((a, b) => a + b, 0);
    sum += d.sign * s;
    const text = vals.length > 1 ? `(${vals.join("+")})` : `${vals[0] ?? 0}`;
    parts.push(parts.length || d.sign < 0 ? `${d.sign < 0 ? "-" : "+"}${text}` : text);
  });
  if (f.flat) parts.push(f.flat > 0 ? `+${f.flat}` : `${f.flat}`);
  let detail = parts.join("");
  let total = sum;
  if (opts.crit) {
    total = sum * 2;
    detail = `2×(${detail})`;
  }
  let nat: 1 | 20 | undefined;
  if (opts.check && f.dice.length && f.dice[0].sides === 20 && f.dice[0].count === 1) {
    const v = values[0][0];
    if (v === 20) nat = 20;
    if (v === 1) nat = 1;
  }
  return { total, detail, nat };
}

// Envoltorio de @3d-dice/dice-box con respaldo aleatorio si WebGL o los assets fallan.
export class Dice3D {
  private box: DiceBoxType | null = null;
  private ready: Promise<boolean> | null = null;
  private style: DiceStyle = DEFAULT_DICE_STYLE;

  setStyle(style: DiceStyle) {
    this.style = style;
  }

  init(containerSelector: string): Promise<boolean> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      try {
        const { default: DiceBox } = await import("@3d-dice/dice-box");
        // Ruta absoluta a /dice-box/ junto a la página (sirve para GitHub Pages en subcarpeta)
        const assetPath = new URL("dice-box/", window.location.href).pathname;
        this.box = new DiceBox({
          container: containerSelector,
          assetPath,
          theme: "default",
          themeColor: DEFAULT_DICE_STYLE.color,
          scale: 6,
          gravity: 2,
          throwForce: 6,
          spinForce: 5,
          startingHeight: 8,
          settleTimeout: 2500,
          offscreen: true,
        });
        await this.box.init();
        return true;
      } catch (err) {
        console.warn("[PF2e] Dados 3D no disponibles, se usará tirada simple.", err);
        this.box = null;
        return false;
      }
    })();
    return this.ready;
  }

  // El tema se carga la primera vez que se usa; si falla, se tira con el clásico
  private async themeFor(style: DiceStyle): Promise<string> {
    if (style.theme === "default") return "default";
    const loaded = await this.box!.loadTheme(style.theme).catch(() => undefined);
    return loaded ? style.theme : "default";
  }

  async roll(f: Formula): Promise<number[][]> {
    const ok = this.ready ? await this.ready : false;
    const usable = ok && this.box && f.dice.every((d) => DICE_3D.has(d.sides)) && f.dice.length > 0;
    if (!usable) return randomValues(f);
    try {
      const groups = f.dice.map((d) => ({ qty: d.count, sides: d.sides }));
      const theme = await this.themeFor(this.style);
      const results = await Promise.race([
        this.box!.roll(groups, { theme, themeColor: this.style.color }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 9000)),
      ]);
      const values: number[][] = f.dice.map(() => []);
      for (const r of results) values[r.groupId]?.push(r.value);
      // Si algo no cuadra, no confiamos en la física
      if (values.some((v, i) => v.length !== f.dice[i].count)) return randomValues(f);
      return values;
    } catch {
      return randomValues(f);
    }
  }

  clear() {
    this.box?.clear();
  }
}
