// Efectos visuales sobre el mapa. Cada efecto es un sombreador SkSL que Owlbear dibuja en la GPU.
// El progreso (p, de 0 a 1) lo avanza el script de fondo: el uniform "time" de Owlbear son
// segundos Unix y en un float de GPU no tiene precisión para animar.
import type { Weapon } from "./pathbuilder";

// Diseños de magia (el jugador elige uno y su color)
export type MagicDesign =
  | "arcane"
  | "occult"
  | "primal"
  | "divine"
  | "void"
  | "vital"
  | "infernal"
  | "monk"
  | "bardic"
  | "spirit"
  | "fire"
  | "water"
  | "air"
  | "earth"
  | "metal"
  | "wood";

// Efectos de rasgos de clase
export type ClassFx = "rage" | "prey" | "rogue" | "panache" | "finisher" | "lens" | "taunt" | "overdrive" | "explode" | "banner";

export type FxKind =
  | "heal"
  | "damage"
  | "shield"
  | "spell"
  | "stars"
  | "slash"
  | "thrust"
  | "impact"
  | "arrow"
  | "spin"
  | "gun"
  | "lob"
  | "flurry"
  | MagicDesign
  | ClassFx;

export type AttackFx = Extract<FxKind, "slash" | "thrust" | "impact" | "arrow" | "spin" | "gun" | "lob" | "flurry">;

// Efecto que viaja con una tirada (ataque con arma o de conjuro) o por el canal de efectos
export interface RollFx {
  kind: FxKind;
  // Índice en DIRS (ataques con arma sin objetivo)
  dir?: number;
  // Token de origen (si no, el del personaje que tiró) y token objetivo
  from?: string;
  to?: string;
  // Color "#rrggbb" para los efectos que se pueden teñir
  color?: string;
}

export const MAGIC_DESIGNS: { id: MagicDesign; label: string; color: string }[] = [
  { id: "arcane", label: "Arcana", color: "#ad73ff" },
  { id: "occult", label: "Oculta", color: "#c06bff" },
  { id: "primal", label: "Primigenia", color: "#7ddc5a" },
  { id: "divine", label: "Divina", color: "#ffe28a" },
  { id: "void", label: "Vacío", color: "#7a5cff" },
  { id: "vital", label: "Vitalidad", color: "#fff1a8" },
  { id: "infernal", label: "Infernal", color: "#ff4a22" },
  { id: "monk", label: "Monástica", color: "#f2f2f2" },
  { id: "bardic", label: "Bárdica", color: "#ffb84d" },
  { id: "spirit", label: "Espiritual", color: "#9fe8ff" },
  { id: "fire", label: "Fuego", color: "#ff7a1a" },
  { id: "water", label: "Agua", color: "#3fa9ff" },
  { id: "air", label: "Aire", color: "#d9f3ff" },
  { id: "earth", label: "Tierra", color: "#b38a5a" },
  { id: "metal", label: "Metal", color: "#cfd8e3" },
  { id: "wood", label: "Madera", color: "#4fc25a" },
];

export const CLASS_FX: { id: ClassFx; label: string; color: string }[] = [
  { id: "rage", label: "Furia", color: "#ff3b2f" },
  { id: "prey", label: "Presa", color: "#ff5a36" },
  { id: "rogue", label: "Ataque furtivo", color: "#2a2a35" },
  { id: "panache", label: "Panache", color: "#ff5d8f" },
  { id: "finisher", label: "Golpe de gracia", color: "#ff8fb1" },
  { id: "lens", label: "Estratagema", color: "#e8d9a8" },
  { id: "taunt", label: "Provocar", color: "#ff3030" },
  { id: "overdrive", label: "Sobrecarga", color: "#ff9a3c" },
  { id: "explode", label: "Explosión", color: "#ff6a00" },
  { id: "banner", label: "Estandarte", color: "#d4a72c" },
];

export const defaultColor = (k: FxKind) =>
  MAGIC_DESIGNS.find((d) => d.id === k)?.color ?? CLASS_FX.find((d) => d.id === k)?.color ?? "#ffffff";

// Diseño predeterminado según la tradición del lanzador
export function traditionDesign(tradition: string): MagicDesign {
  const t = tradition.toLowerCase();
  if (t.startsWith("div")) return "divine";
  if (t.startsWith("occ")) return "occult";
  if (t.startsWith("pri")) return "primal";
  return "arcane";
}

export function hexToVec(hex: string): { x: number; y: number; z: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return { x: ((n >> 16) & 255) / 255, y: ((n >> 8) & 255) / 255, z: (n & 255) / 255 };
}

export const ATTACK_FX: { id: AttackFx; label: string; ranged: boolean }[] = [
  { id: "slash", label: "Cortes", ranged: false },
  { id: "thrust", label: "Estocada", ranged: false },
  { id: "impact", label: "Impacto", ranged: false },
  { id: "arrow", label: "Flecha", ranged: true },
  { id: "spin", label: "Cortes giratorios", ranged: true },
  { id: "gun", label: "Disparo", ranged: true },
  { id: "lob", label: "Proyectil curvo", ranged: true },
  { id: "flurry", label: "Ráfaga de puñetazos", ranged: false },
];

// Direcciones como los movimientos del rey: N, NE, E, SE, S, SO, O, NO (y hacia abajo es sur)
export const DIRS: { x: number; y: number; label: string; arrow: string }[] = [
  { x: 0, y: -1, label: "Norte", arrow: "↑" },
  { x: 1, y: -1, label: "Noreste", arrow: "↗" },
  { x: 1, y: 0, label: "Este", arrow: "→" },
  { x: 1, y: 1, label: "Sureste", arrow: "↘" },
  { x: 0, y: 1, label: "Sur", arrow: "↓" },
  { x: -1, y: 1, label: "Suroeste", arrow: "↙" },
  { x: -1, y: 0, label: "Oeste", arrow: "←" },
  { x: -1, y: -1, label: "Noroeste", arrow: "↖" },
];

// Efecto predeterminado según el arma: tipo de daño para cuerpo a cuerpo, nombre para distancia
export function defaultWeaponFx(w: Weapon): AttackFx {
  const n = w.key || w.name.toLowerCase();
  if (w.ranged) {
    if (/pistol|musket|arquebus|blunderbuss|pepperbox|cannon|jezail|harmona|scattergun|gun\b/.test(n)) return "gun";
    if (/sling|bomb|flask|fire|bottled|acid|grenade/.test(n)) return "lob";
    if (/dagger|knife|shuriken|chakri|chakram|starknife|boomerang|axe|hatchet/.test(n)) return "spin";
    return "arrow";
  }
  if (w.damageType === "Perforante") return "thrust";
  if (w.damageType === "Contundente") return "impact";
  return "slash";
}

// Duración (ms) y tamaño de la zona dibujada, en casillas
const FX_TIMING: Partial<Record<FxKind, number>> = {
  heal: 1700,
  damage: 950,
  shield: 950,
  spell: 1500,
  stars: 2800,
  slash: 600,
  thrust: 550,
  impact: 650,
  arrow: 750,
  spin: 900,
  gun: 550,
  lob: 950,
  flurry: 1100,
  arcane: 1600,
  occult: 2000,
  primal: 2000,
  divine: 2000,
  void: 2100,
  vital: 2000,
  infernal: 2200,
  monk: 1900,
  bardic: 2000,
  spirit: 2200,
  fire: 1800,
  water: 1900,
  air: 1800,
  earth: 1700,
  metal: 1800,
  wood: 2000,
  rage: 1600,
  prey: 1400,
  rogue: 1600,
  panache: 2600,
  finisher: 1500,
  lens: 1500,
  taunt: 1600,
  overdrive: 1900,
  explode: 1900,
  banner: 1800,
};

export const RANGED_CELLS = 5;

const HEADER = `
uniform vec2 size;
uniform float p;
uniform float cells;
uniform vec2 dir;
uniform float r;
uniform vec3 col;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float hash2(vec2 v) { return hash(dot(v, vec2(12.9898, 78.233))); }
float vnoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec2 rot(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
float glow(vec2 q, float s) { return exp(-length(q) / s); }
// Destello de cuatro puntas
float sparkle(vec2 q, float s) {
  vec2 a = abs(q);
  return exp(-length(q) / (s * 0.35)) + exp(-a.x / (s * 0.06)) * exp(-a.y / s) + exp(-a.y / (s * 0.06)) * exp(-a.x / s);
}
float lineMask(float d, float w) { return 1.0 - smoothstep(w * 0.5, w, d); }
// Aparece entre a y b, desaparece entre c y d (según el progreso p)
float show(float a, float b, float c, float d) { return smoothstep(a, b, p) * (1.0 - smoothstep(c, d, p)); }
vec2 local(vec2 coord) { return (coord / size - 0.5) * cells; }
float segDist(vec2 q, vec2 a, vec2 b) {
  vec2 pa = q - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h);
}
// Se apaga cerca del borde de la zona dibujada, para que no se note el cuadrado
float edgeFade(vec2 q) { return 1.0 - smoothstep(cells * 0.4, cells * 0.5, max(abs(q.x), abs(q.y))); }
half4 col4(vec3 c, float a) {
  a = clamp(a, 0.0, 1.0);
  return half4(c * a, a);
}
`;

// Cruces verdes que suben, líneas de brillo y un halo suave
const HEAL = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float a = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float delay = hash(fi + 0.5) * 0.35;
    float t = clamp((p - delay) / 0.65, 0.0, 1.0);
    vec2 c = vec2((hash(fi + 3.1) - 0.5) * r * 2.4, r * 0.7 - t * r * 2.2);
    float s = r * (0.22 + 0.12 * hash(fi + 7.7));
    vec2 d = abs(q - c);
    float cr = min(max(d.x - s * 0.33, d.y - s), max(d.x - s, d.y - s * 0.33));
    float shape = 1.0 - smoothstep(0.0, r * 0.04, cr);
    a = max(a, shape * sin(t * 3.14159) * step(0.001, t));
  }
  for (int i = 0; i < 12; i++) {
    float fi = float(i) + 20.0;
    float x = (hash(fi) - 0.5) * r * 2.6;
    float t = fract(p * 1.4 + hash(fi + 1.0));
    float y = r * 1.1 - t * r * 2.6;
    float dy = q.y - y;
    float line = (1.0 - smoothstep(0.0, r * 0.035, abs(q.x - x))) * (1.0 - smoothstep(0.0, r * 0.5, dy)) * step(0.0, dy);
    a = max(a, line * 0.7 * sin(p * 3.14159));
  }
  float glow = exp(-length(q) / (r * 1.1)) * 0.35 * sin(p * 3.14159);
  a = max(a, glow);
  return col4(vec3(0.35, 1.0, 0.45), a * edgeFade(q));
}`;

// Cortes rojos que se dibujan rápido y gotas de sangre que salpican
const DAMAGE = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float a = 0.0;
  float core = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float t = clamp((p - fi * 0.1) / 0.45, 0.0, 1.0);
    float ang = 0.75 + (hash(fi + 2.0) - 0.5) * 0.7 + (fi - 1.0) * 0.3;
    vec2 d = vec2(cos(ang), sin(ang));
    vec2 off = vec2(-d.y, d.x) * (fi - 1.0) * r * 0.42;
    float L = r * 1.5;
    vec2 a0 = off - d * L;
    vec2 b1 = a0 + d * 2.0 * L * min(1.0, t * 3.0);
    float w = r * 0.12 * (1.0 - t * 0.7);
    float sd = segDist(q, a0, b1);
    float on = step(0.001, t) * (1.0 - smoothstep(0.55, 1.0, t));
    a = max(a, (1.0 - smoothstep(w * 0.4, w, sd)) * on);
    core = max(core, (1.0 - smoothstep(0.0, w * 0.35, sd)) * on);
  }
  for (int i = 0; i < 14; i++) {
    float fi = float(i) + 10.0;
    float ang = hash(fi) * 6.2832;
    float sp = r * (0.7 + hash(fi + 1.0) * 1.1);
    float t = clamp((p - 0.12) / 0.88, 0.0, 1.0);
    vec2 pos = vec2(cos(ang), sin(ang)) * sp * t + vec2(0.0, 0.8 * t * t * r);
    float rad = r * 0.13 * (0.5 + hash(fi + 2.0)) * (1.0 - t * 0.5);
    float drop = 1.0 - smoothstep(rad * 0.6, rad, length(q - pos));
    a = max(a, drop * (1.0 - t) * step(0.001, t));
  }
  vec3 c = mix(vec3(0.8, 0.03, 0.06), vec3(1.0, 0.75, 0.7), core);
  return col4(c, (a) * edgeFade(q));
}`;

// Un escudo que aparece de golpe, crece un poco y se desvanece
const SHIELD = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float s = 1.0 + 0.35 * (1.0 - pow(1.0 - p, 3.0));
  vec2 n = q / (r * s);
  float d = 0.0;
  if (n.y < 0.0) {
    d = max(abs(n.x) - 0.7, -n.y - 0.75);
  } else {
    d = (abs(n.x) - 0.7 * (1.0 - n.y)) * 0.8;
  }
  float fill = (1.0 - smoothstep(0.0, 0.03, d)) * 0.28;
  float edge = 1.0 - smoothstep(0.03, 0.08, abs(d));
  float boss = 1.0 - smoothstep(0.06, 0.1, length(n - vec2(0.0, -0.15)));
  float fade = 1.0 - smoothstep(0.45, 1.0, p);
  float flash = 1.0 - smoothstep(0.0, 0.2, p);
  float a = (max(max(fill, edge), boss * 0.8) + flash * fill * 2.0) * fade;
  return col4(vec3(0.78, 0.9, 1.0), a * edgeFade(q));
}`;

// Círculo rúnico que gira y chispas en espiral
const SPELL = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float rad = length(q);
  float ang = atan(q.y, q.x);
  float R = r * (1.05 + 0.15 * p);
  float rot = p * 2.4;
  float w = r * 0.025;
  float ring = (1.0 - smoothstep(w, w * 2.0, abs(rad - R))) + (1.0 - smoothstep(w * 0.6, w * 1.4, abs(rad - R * 0.8)));
  float k = (ang + rot) / 6.2832 * 14.0;
  float cellPos = fract(k) - 0.5;
  float h = hash(floor(k) + 1.0);
  float band = step(R * 0.82, rad) * step(rad, R * 0.98);
  float tick = 1.0 - smoothstep(0.04, 0.09, abs(cellPos + (h - 0.5) * 0.4));
  float bar = (1.0 - smoothstep(w * 0.5, w * 1.2, abs(rad - R * (0.85 + h * 0.1)))) * step(abs(cellPos), 0.28);
  float runes = band * max(tick * step(0.3, h), bar);
  float show = smoothstep(0.0, 0.15, p) * (1.0 - smoothstep(0.7, 1.0, p));
  float a = min(1.0, ring + runes) * show;
  float sparks = 0.0;
  for (int i = 0; i < 18; i++) {
    float fi = float(i);
    float t = clamp((p - hash(fi + 4.0) * 0.3) / 0.7, 0.0, 1.0);
    float sa = hash(fi) * 6.2832 + t * 3.0;
    float sr = r * (0.3 + t * (1.0 + hash(fi + 9.0)));
    vec2 sp = vec2(cos(sa), sin(sa)) * sr;
    float g = exp(-length(q - sp) / (r * 0.07));
    sparks = max(sparks, g * sin(t * 3.14159) * step(0.001, t));
  }
  vec3 c = mix(vec3(0.68, 0.45, 1.0), vec3(0.6, 1.0, 1.0), sparks);
  return col4(c, (max(a, sparks)) * edgeFade(q));
}`;

// Estrellas dando vueltas sobre la cabeza, como al quedar noqueado
const STARS = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 c0 = vec2(0.0, -r * 0.85);
  float a = 0.0;
  float show = smoothstep(0.0, 0.1, p) * (1.0 - smoothstep(0.85, 1.0, p));
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float ang = p * 6.2832 * 2.2 + fi * 1.2566;
    float depth = sin(ang);
    vec2 pos = c0 + vec2(cos(ang) * r * 0.95, depth * r * 0.28);
    float s = r * (0.26 + 0.07 * depth);
    vec2 d = q - pos;
    float th = atan(d.y, d.x) + p * 8.0;
    float k = abs(cos(th * 2.5));
    float shape = s * (0.42 + 0.58 * pow(k, 5.0));
    float star = 1.0 - smoothstep(shape * 0.85, shape, length(d));
    a = max(a, star * (0.65 + 0.35 * depth));
  }
  return col4(vec3(1.0, 0.86, 0.25), a * show * edgeFade(q));
}`;

// ---------- Ataques: blancos, minimalistas ----------

// Cortes fugaces: dos medialunas que barren la casilla de al lado
const SLASH = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 pr = vec2(-dir.y, dir.x);
  float a = 0.0;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float t = clamp((p - fi * 0.22) / 0.6, 0.0, 1.0);
    float side = fi * 2.0 - 1.0;
    vec2 c = -dir * 0.35 + pr * side * 0.08;
    vec2 v = q - c;
    float u = dot(v, dir);
    float w = dot(v, pr) * side;
    float rel = atan(w, u);
    float head = mix(-1.3, 1.3, t);
    float span = clamp((rel - (head - 1.1)) / 1.1, 0.0, 1.0) * step(rel, head);
    float R = 0.6;
    float thick = 0.1 * span;
    float arc = 1.0 - smoothstep(thick * 0.5, thick, abs(length(v) - R));
    float on = step(0.001, t) * (1.0 - smoothstep(0.75, 1.0, t));
    a = max(a, arc * span * on);
  }
  return col4(vec3(1.0), (a) * edgeFade(q));
}`;

// Estocada: una punta fina que sale hacia la casilla y vuelve
const THRUST = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 pr = vec2(-dir.y, dir.x);
  float ext = sin(clamp(p / 0.75, 0.0, 1.0) * 3.14159);
  vec2 s0 = -dir * 0.7;
  float L = 1.25 * ext;
  vec2 v = q - s0;
  float u = dot(v, dir);
  float w = abs(dot(v, pr));
  float h = clamp(u / max(L, 0.001), 0.0, 1.0);
  float width = 0.06 * (1.0 - h);
  float spike = (1.0 - smoothstep(width * 0.6, width + 0.004, w)) * step(0.0, u) * step(u, L);
  vec2 tip = s0 + dir * L;
  float flash = exp(-length(q - tip) / 0.07) * smoothstep(0.3, 0.5, p) * (1.0 - smoothstep(0.5, 0.8, p));
  float lines = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i) - 1.0;
    vec2 a0 = s0 + pr * fi * 0.18 + dir * 0.1;
    float sd = segDist(q, a0, a0 + dir * 0.6 * ext);
    lines = max(lines, (1.0 - smoothstep(0.004, 0.012, sd)) * 0.45 * ext);
  }
  float a = max(max(spike, flash), lines) * (1.0 - smoothstep(0.85, 1.0, p));
  return col4(vec3(1.0), (a) * edgeFade(q));
}`;

// Impacto sólido: onda que se expande, rayos y destello en el centro
const IMPACT = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float t = p;
  float R = mix(0.12, 0.62, 1.0 - pow(1.0 - t, 2.0));
  float thick = 0.09 * (1.0 - t) + 0.01;
  float ring = 1.0 - smoothstep(thick * 0.5, thick, abs(length(q) - R));
  float ang = atan(q.y, q.x);
  float rays = pow(abs(cos(ang * 4.0)), 24.0) * step(R * 0.5, length(q)) * step(length(q), R * 1.25) * (1.0 - smoothstep(0.2, 0.6, t));
  float flash = exp(-length(q) / 0.12) * (1.0 - smoothstep(0.0, 0.35, t));
  float a = max(max(ring * (1.0 - smoothstep(0.6, 1.0, t)), rays), flash);
  return col4(vec3(1.0), (a) * edgeFade(q));
}`;

// Flecha destellante: un trazo con estela que viaja en línea recta
const ARROW = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 pr = vec2(-dir.y, dir.x);
  float L = cells - 1.0;
  float t = clamp(p / 0.85, 0.0, 1.0);
  vec2 head = -dir * (L * 0.5) + dir * L * (1.0 - pow(1.0 - t, 1.6));
  vec2 v = q - head;
  float u = dot(v, dir);
  float w = abs(dot(v, pr));
  float tail = 1.4;
  float along = clamp(-u / tail, 0.0, 1.0);
  float streak = (1.0 - smoothstep(0.03, 0.06 * (1.0 - along) + 0.03, w)) * step(u, 0.0) * step(-tail, u) * (1.0 - along);
  float chev = 0.0;
  for (int i = 0; i < 2; i++) {
    float side = float(i) * 2.0 - 1.0;
    vec2 b = head - dir * 0.28 + pr * side * 0.16;
    chev = max(chev, 1.0 - smoothstep(0.02, 0.04, segDist(q, head, b)));
  }
  float glow = exp(-length(v) / 0.14) * 0.9;
  float fade = 1.0 - smoothstep(0.85, 1.0, p);
  return col4(vec3(1.0), (max(max(streak, chev), glow) * fade) * edgeFade(q));
}`;

// Cortes circulares que giran mientras viajan (dagas y arrojadizas cortantes)
const SPIN = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float L = cells - 1.0;
  float t = clamp(p / 0.85, 0.0, 1.0);
  vec2 c = -dir * (L * 0.5) + dir * L * t;
  vec2 v = q - c;
  float ang = atan(v.y, v.x) + p * 30.0;
  float seg = fract(ang / 6.2832 * 3.0);
  float arcMask = smoothstep(0.0, 0.08, seg) * (1.0 - smoothstep(0.3, 0.42, seg));
  float ring = 1.0 - smoothstep(0.03, 0.06, abs(length(v) - 0.32));
  float trail = exp(-abs(dot(q - c, vec2(-dir.y, dir.x))) / 0.04) * step(dot(q - c, dir), 0.0) * exp(dot(q - c, dir) / 0.6) * 0.35;
  float fade = 1.0 - smoothstep(0.85, 1.0, p);
  return col4(vec3(1.0), (max(ring * arcMask, trail) * fade) * edgeFade(q));
}`;

// Disparo: fogonazo en la boca y un proyectil veloz
const GUN = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 pr = vec2(-dir.y, dir.x);
  float L = cells - 1.0;
  vec2 s0 = -dir * (L * 0.5);
  vec2 v0 = q - s0;
  float ang = atan(dot(v0, pr), dot(v0, dir));
  float burst = pow(abs(cos(ang * 3.0)), 10.0) * exp(-length(v0) / 0.32) * 1.6;
  float disk = exp(-length(v0) / 0.14);
  float fl = (burst + disk) * (1.0 - smoothstep(0.05, 0.3, p));
  float t = clamp((p - 0.05) / 0.35, 0.0, 1.0);
  vec2 head = s0 + dir * L * t;
  float sd = segDist(q, head - dir * 1.1 * step(0.001, t), head);
  float along = clamp(dot(head - q, dir) / 1.1, 0.0, 1.0);
  float tracer = (1.0 - smoothstep(0.02, 0.045, sd)) * (1.0 - along) * step(0.001, t) * (1.0 - smoothstep(0.85, 1.0, t));
  return col4(vec3(1.0), (max(fl, tracer)) * edgeFade(q));
}`;

// Proyectil redondo que viaja ligeramente curvado (bombas, hondas)
const LOB = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 pr = vec2(-dir.y, dir.x);
  float L = cells - 1.0;
  float t = clamp(p / 0.85, 0.0, 1.0);
  vec2 s0 = -dir * (L * 0.5);
  vec2 c = s0 + dir * L * t - pr * sin(t * 3.14159) * 0.7;
  float ball = 1.0 - smoothstep(0.13, 0.17, length(q - c));
  float trail = 0.0;
  for (int i = 1; i < 6; i++) {
    float tt = t - float(i) * 0.035;
    vec2 ci = s0 + dir * L * tt - pr * sin(tt * 3.14159) * 0.7;
    float rr = 0.1 * (1.0 - float(i) / 6.0);
    trail = max(trail, (1.0 - smoothstep(rr * 0.6, rr, length(q - ci))) * (1.0 - float(i) / 6.0) * step(0.0, tt));
  }
  vec2 e = s0 + dir * L;
  float pt = clamp((p - 0.82) / 0.18, 0.0, 1.0);
  float pop = (1.0 - smoothstep(0.02, 0.05, abs(length(q - e) - pt * 0.45))) * step(0.001, pt) * (1.0 - pt);
  float a = max(max(ball * (1.0 - step(0.999, t)), trail * 0.7), pop);
  return col4(vec3(1.0), (a) * edgeFade(q));
}`;


// ---------- Diseños de magia (se tiñen con el color elegido) ----------

// Arcana: el círculo rúnico, en el color elegido
const ARCANE = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float rad = length(q);
  float ang = atan(q.y, q.x);
  float R = r * (1.05 + 0.15 * p);
  float rot0 = p * 2.4;
  float w = r * 0.025;
  float ring = (1.0 - smoothstep(w, w * 2.0, abs(rad - R))) + (1.0 - smoothstep(w * 0.6, w * 1.4, abs(rad - R * 0.8)));
  float k = (ang + rot0) / 6.2832 * 14.0;
  float cellPos = fract(k) - 0.5;
  float h = hash(floor(k) + 1.0);
  float band = step(R * 0.82, rad) * step(rad, R * 0.98);
  float tick = 1.0 - smoothstep(0.04, 0.09, abs(cellPos + (h - 0.5) * 0.4));
  float bar = (1.0 - smoothstep(w * 0.5, w * 1.2, abs(rad - R * (0.85 + h * 0.1)))) * step(abs(cellPos), 0.28);
  float runes = band * max(tick * step(0.3, h), bar);
  float a = min(1.0, ring + runes) * show(0.0, 0.15, 0.7, 1.0);
  float sparks = 0.0;
  for (int i = 0; i < 18; i++) {
    float fi = float(i);
    float t = clamp((p - hash(fi + 4.0) * 0.3) / 0.7, 0.0, 1.0);
    float sa = hash(fi) * 6.2832 + t * 3.0;
    float sr = r * (0.3 + t * (1.0 + hash(fi + 9.0)));
    vec2 sp = vec2(cos(sa), sin(sa)) * sr;
    sparks = max(sparks, glow(q - sp, r * 0.07) * sin(t * 3.14159) * step(0.001, t));
  }
  vec3 c = mix(col, vec3(1.0), sparks * 0.6);
  return col4(c, max(a, sparks) * edgeFade(q));
}`;

// Oculta: hexagrama de vértices estrellados que gira y un ojo astral que parpadea
const OCCULT = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float a = 0.0;
  float R = r * 1.0;
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    vec2 v = rot(q, (fk * 2.0 - 1.0) * p * 1.6 + fk * 3.14159);
    float d = -1.0;
    for (int i = 0; i < 3; i++) {
      float th = float(i) * 2.0944 + 1.5708;
      d = max(d, dot(v, vec2(cos(th), sin(th))));
    }
    a = max(a, lineMask(abs(d - R * 0.5), r * 0.05));
    for (int i = 0; i < 3; i++) {
      float th = float(i) * 2.0944 - 1.5708;
      a = max(a, sparkle(v - vec2(cos(th), sin(th)) * R, r * 0.18));
    }
  }
  a = max(a, lineMask(abs(length(q) - R * 1.08), r * 0.03) * 0.7);
  float eo = show(0.3, 0.42, 0.7, 0.82);
  float blink = 1.0 - 0.9 * smoothstep(0.53, 0.55, p) * (1.0 - smoothstep(0.57, 0.6, p));
  vec2 e = q / r;
  float lid = 0.34 * blink * max(0.0, 1.0 - e.x * e.x / 0.49);
  float almond = step(abs(e.x), 0.7) * (1.0 - smoothstep(lid - 0.02, lid + 0.02, abs(e.y)));
  float outline = step(abs(e.x), 0.72) * lineMask(abs(abs(e.y) - lid), 0.06);
  float iris = 1.0 - smoothstep(0.16, 0.19, length(e));
  float pupil = 1.0 - smoothstep(0.06, 0.09, length(e));
  float eye = max(outline, almond * (0.3 + 0.7 * iris) * (1.0 - pupil * 0.85)) * eo;
  float aa = max(a * (1.0 - almond * eo), eye);
  vec3 c = mix(col, vec3(1.0), max(iris * almond * 0.5, outline * 0.4) * eo);
  return col4(c, aa * show(0.0, 0.15, 0.8, 1.0) * edgeFade(q));
}`;

// Primigenia: espiral de hojas y brisa con luciérnagas que suben del suelo
const PRIMAL = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float a = 0.0;
  float vein = 0.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float t = clamp((p - hash(fi + 1.3) * 0.3) / 0.7, 0.0, 1.0);
    float ang = fi * 0.698 + t * 7.0;
    float rad = r * (1.1 - 0.6 * t);
    vec2 c = vec2(cos(ang) * rad, r * 0.9 - t * r * 2.4 + sin(ang) * rad * 0.25);
    vec2 v = rot(q - c, ang * 1.3);
    float s = r * 0.16;
    float leaf = 1.0 - smoothstep(0.85, 1.0, length(vec2(v.x / s, v.y / (s * 0.55))));
    float on = sin(t * 3.14159) * step(0.001, t);
    a = max(a, leaf * on);
    vein = max(vein, lineMask(abs(v.y), r * 0.02) * leaf * on);
  }
  float th = atan(q.y, q.x);
  float rr = length(q);
  float vis = show(0.0, 0.1, 0.8, 1.0);
  float breeze = lineMask(abs(fract(th / 6.2832 * 2.0 + rr / r * 0.6 - p * 1.5) - 0.5), 0.06) * smoothstep(r * 0.3, r * 0.8, rr) * (1.0 - smoothstep(r * 1.2, r * 1.5, rr)) * 0.35 * vis;
  float ff = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i) + 30.0;
    float t = fract(p * 0.9 + hash(fi));
    vec2 c = vec2((hash(fi + 2.0) - 0.5) * r * 2.6 + sin(t * 6.0 + fi) * r * 0.15, r * 1.2 - t * r * 2.6);
    float fl = 0.5 + 0.5 * sin(p * 40.0 + fi * 3.0);
    ff = max(ff, glow(q - c, r * 0.05) * fl * sin(t * 3.14159) * vis);
  }
  float aura = glow(q, r * 0.7) * 0.2 * vis;
  vec3 c = mix(col * (0.75 + 0.25 * vein), vec3(1.0, 1.0, 0.65), max(ff, vein * 0.5));
  return col4(c, max(max(a, breeze), max(ff, aura)) * edgeFade(q));
}`;

// Divina: pilar de luz que baja sobre el token, halo y aura
const DIVINE = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float top = -cells * 0.5;
  float head = mix(top, r * 0.7, smoothstep(0.0, 0.3, p));
  float w = r * (0.45 + 0.08 * sin(p * 12.0));
  float inBeam = step(q.y, head) * smoothstep(top, top + r * 1.0, q.y);
  float beam = (1.0 - smoothstep(w * 0.6, w, abs(q.x))) * inBeam;
  float core = (1.0 - smoothstep(0.0, w * 0.35, abs(q.x))) * inBeam;
  float vis = show(0.0, 0.08, 0.7, 1.0);
  vec2 h = q - vec2(0.0, -r * 0.95);
  float halo = lineMask(abs(length(vec2(h.x, h.y * 3.2)) - r * 0.42), r * 0.07) * show(0.25, 0.4, 0.8, 1.0);
  float aura = glow(q, r * 0.9) * 0.5 * show(0.2, 0.45, 0.7, 1.0);
  float rr = length(q);
  float rays = pow(abs(cos(atan(q.y, q.x) * 6.0 + p * 2.0)), 16.0) * smoothstep(r * 0.5, r * 0.9, rr) * (1.0 - smoothstep(r * 1.1, r * 1.5, rr)) * show(0.3, 0.5, 0.75, 1.0) * 0.6;
  float a = max(max(beam * 0.55, core), max(halo, max(aura, rays)));
  vec3 c = mix(col, vec3(1.0), max(core, halo * 0.5));
  return col4(c, a * vis * edgeFade(q));
}`;

// Vacío: calaveras que suben goteando y luz ondulante
const VOID = `${HEADER}
float skull(vec2 v, float s) {
  vec2 u = v / s;
  float cran = 1.0 - smoothstep(0.95, 1.05, length(u - vec2(0.0, -0.15)));
  float jaw = (1.0 - smoothstep(0.5, 0.58, abs(u.x))) * step(0.3, u.y) * (1.0 - smoothstep(0.85, 0.95, u.y));
  float eyes = 1.0 - smoothstep(0.22, 0.28, length(vec2(abs(u.x) - 0.38, u.y + 0.05)));
  float nose = 1.0 - smoothstep(0.08, 0.12, length(vec2(u.x, (u.y - 0.32) * 0.7)));
  return clamp(max(cran, jaw) - max(eyes, nose), 0.0, 1.0);
}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float a = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float t = clamp((p - fi * 0.12) / 0.7, 0.0, 1.0);
    float s = r * (0.26 + 0.06 * hash(fi + 4.0));
    vec2 c = vec2((fi - 1.5) * r * 0.6 + sin(t * 5.0 + fi) * r * 0.1, r * 0.8 - t * r * 2.2);
    float on = sin(t * 3.14159) * step(0.001, t);
    a = max(a, skull(q - c, s) * on);
    for (int j = 0; j < 3; j++) {
      float fj = float(j);
      float fall = fract(t * 1.6 + hash(fi * 3.0 + fj));
      vec2 d = q - (c + vec2((fj - 1.0) * s * 0.45, s * (0.9 + fall * 1.4)));
      a = max(a, (1.0 - smoothstep(s * 0.06, s * 0.1, length(vec2(d.x, d.y * 0.6)))) * on * (1.0 - fall));
    }
  }
  float rr = length(q);
  float wave = 0.5 + 0.5 * sin(rr / r * 9.0 - p * 18.0 + sin(atan(q.y, q.x) * 3.0 + p * 6.0) * 0.8);
  float glowA = wave * glow(q, r * 0.6) * 0.55 * show(0.0, 0.15, 0.75, 1.0);
  vec3 c = mix(col, vec3(0.88, 0.85, 1.0), a * 0.6);
  return col4(c, max(a, glowA) * edgeFade(q));
}`;

// Vitalidad: torrente de luz en espiral que se concentra en un orbe
const VITAL = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float rr = length(q) / r;
  float th = atan(q.y, q.x);
  float conv = smoothstep(0.0, 0.55, p);
  float k = th * 3.0 / 6.2832 + log(max(rr, 0.02)) * 1.6 + p * 4.0;
  float outer = mix(1.6, 0.25, conv);
  float arms = lineMask(abs(fract(k) - 0.5), 0.14) * step(rr, outer) * smoothstep(0.1, 0.35, rr);
  float stream = arms * show(0.0, 0.1, 0.55, 0.7);
  float orbR = 0.45 * smoothstep(0.35, 0.7, p) * (1.0 + 0.1 * sin(p * 30.0));
  float orb = ((1.0 - smoothstep(orbR * 0.7, orbR, rr)) + exp(-rr / max(orbR, 0.01) * 1.5) * 0.6) * show(0.35, 0.55, 0.85, 1.0);
  float flash = exp(-rr * 2.5) * smoothstep(0.8, 0.9, p) * (1.0 - smoothstep(0.9, 1.0, p));
  float a = max(stream, max(orb, flash));
  vec3 c = mix(col, vec3(1.0), clamp(orb * 0.6 + flash, 0.0, 1.0));
  return col4(c, a * edgeFade(q));
}`;

// Infernal: círculo que gira con brasas y un pentagrama que se va dibujando
const INFERNAL = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float rr = length(q);
  float R = r * 1.1;
  float ring = lineMask(abs(rr - R), r * 0.06) + lineMask(abs(rr - R * 0.88), r * 0.035);
  float th = atan(q.y, q.x) + p * 3.0;
  float ticks = step(R * 0.9, rr) * step(rr, R) * step(0.7, fract(th / 6.2832 * 24.0));
  float a = max(min(ring, 1.0), ticks * 0.8);
  float pent = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float a0 = -1.5708 + fi * 2.5133;
    vec2 v0 = vec2(cos(a0), sin(a0)) * R * 0.86;
    vec2 v1 = vec2(cos(a0 + 2.5133), sin(a0 + 2.5133)) * R * 0.86;
    float prog = clamp(p * 7.0 - 0.5 - fi, 0.0, 1.0);
    pent = max(pent, lineMask(segDist(q, v0, mix(v0, v1, prog)), r * 0.05) * step(0.001, prog));
  }
  a = max(a, pent);
  float emb = 0.0;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float t = fract(p * 1.3 + hash(fi + 7.0));
    float ang = hash(fi) * 6.2832 + p * 3.0;
    vec2 c = vec2(cos(ang), sin(ang)) * R + vec2(sin(t * 9.0 + fi) * r * 0.08, -t * r * 0.9);
    emb = max(emb, glow(q - c, r * 0.05) * (1.0 - t));
  }
  vec3 c = mix(col, vec3(1.0, 0.85, 0.3), max(emb, pent * 0.35));
  return col4(c, max(a, emb) * show(0.0, 0.12, 0.8, 1.0) * edgeFade(q));
}`;

// Monástica: trazos de tinta y luego una palma abierta
const MONK = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float t = clamp((p - fi * 0.08) / 0.25, 0.0, 1.0);
    float ang = -0.5 + fi * 0.9 + (hash(fi) - 0.5) * 0.4;
    vec2 d = vec2(cos(ang), sin(ang));
    vec2 n = vec2(-d.y, d.x);
    vec2 a0 = -d * r * 1.1 + n * (fi - 1.0) * r * 0.35;
    float L = r * 2.2 * t;
    vec2 v = q - a0;
    float u = dot(v, d);
    float h = clamp(u / max(L, 0.001), 0.0, 1.0);
    float width = r * 0.13 * sin(h * 2.83 + 0.15) * (0.75 + 0.5 * vnoise(vec2(u / r * 6.0, fi * 4.0)));
    float side = abs(dot(v, n) + sin(u / r * 3.0 + fi) * r * 0.05);
    float rough = vnoise(q / r * 14.0 + fi) * 0.35;
    float stroke = (1.0 - smoothstep(width * (0.75 + rough), width * (1.0 + rough), side)) * step(0.0, u) * step(u, L);
    a = max(a, stroke * (1.0 - smoothstep(0.45, 0.6, p)) * step(0.001, t));
  }
  float pv = show(0.4, 0.5, 0.82, 0.95);
  vec2 v = q / (r * (0.9 + 0.15 * smoothstep(0.4, 0.6, p)));
  float palm = 1.0 - smoothstep(0.0, 0.04, length(max(abs(v - vec2(0.0, 0.25)) - vec2(0.33, 0.3), 0.0)) - 0.12);
  float fingers = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float x = -0.3 + fi * 0.2;
    float len = 0.42 + 0.1 * (1.0 - abs(fi - 1.5) / 1.5);
    fingers = max(fingers, 1.0 - smoothstep(0.075, 0.095, segDist(v, vec2(x, -0.05), vec2(x * 1.1, -0.05 - len))));
  }
  float thumb = 1.0 - smoothstep(0.075, 0.095, segDist(v, vec2(-0.38, 0.3), vec2(-0.62, 0.05)));
  a = max(a, max(max(palm, fingers), thumb) * pv * 0.85);
  return col4(col, a * edgeFade(q));
}`;

// Bárdica: líneas onduladas con destellos y notas musicales que revolotean
const BARDIC = `${HEADER}
float note(vec2 v, float s) {
  vec2 u = v / s;
  float head = 1.0 - smoothstep(0.9, 1.05, length(rot(u, 0.5) * vec2(1.0, 1.5)));
  float stem = lineMask(segDist(u, vec2(0.85, -0.1), vec2(0.85, -2.6)), 0.3);
  float flag = lineMask(segDist(u, vec2(0.85, -2.6), vec2(1.7, -1.6)), 0.3);
  return max(head, max(stem, flag));
}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float a = 0.0;
  float spark = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float y0 = (fi - 1.5) * r * 0.32;
    float y = y0 + sin(q.x / r * 3.0 + p * 10.0 + fi * 1.3) * r * 0.12;
    a = max(a, lineMask(abs(q.y - y), r * 0.03) * (1.0 - smoothstep(r * 1.0, r * 1.5, abs(q.x))) * 0.8);
    float sx = fract(p * 0.8 + hash(fi * 2.1)) * 3.0 - 1.5;
    vec2 sp = vec2(sx * r, y0 + sin(sx * 3.0 + p * 10.0 + fi * 1.3) * r * 0.12);
    spark = max(spark, sparkle(q - sp, r * 0.12));
  }
  float notes = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float t = clamp((p - fi * 0.1) / 0.75, 0.0, 1.0);
    vec2 c = vec2((hash(fi + 3.0) - 0.5) * r * 2.2 + sin(t * 8.0 + fi) * r * 0.25, r * 0.6 - t * r * 1.9);
    notes = max(notes, note(q - c, r * 0.09) * sin(t * 3.14159) * step(0.001, t));
  }
  vec3 c = mix(col, vec3(1.0), max(min(spark, 1.0), notes * 0.3));
  return col4(c, max(max(a, notes), spark) * show(0.0, 0.12, 0.75, 1.0) * edgeFade(q));
}`;

// Espiritual: fantasmas y motas que suben en espiral desde el suelo
const SPIRIT = `${HEADER}
float ghost(vec2 v, float s, float t) {
  vec2 u = v / s;
  float head = 1.0 - smoothstep(0.95, 1.05, length(u));
  float body = (1.0 - smoothstep(0.92, 1.0, abs(u.x))) * step(0.0, u.y) * step(u.y, 1.4 + 0.25 * sin(u.x * 6.0 + t * 12.0));
  float eyes = 1.0 - smoothstep(0.14, 0.2, length(vec2(abs(u.x) - 0.35, u.y + 0.1)));
  return clamp(max(head, body) - eyes, 0.0, 1.0);
}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float t = clamp((p - fi * 0.15) / 0.7, 0.0, 1.0);
    float ang = fi * 2.094 + t * 5.0;
    vec2 c = vec2(cos(ang) * r * 0.8 * (1.0 - t * 0.4), r * 0.9 - t * r * 2.3);
    a = max(a, ghost(q - c, r * 0.22, t) * 0.55 * sin(t * 3.14159) * step(0.001, t));
  }
  float motes = 0.0;
  for (int i = 0; i < 18; i++) {
    float fi = float(i) + 50.0;
    float t = fract(p * 0.8 + hash(fi));
    float ang = hash(fi + 1.0) * 6.2832 + t * 6.0;
    vec2 c = vec2(cos(ang) * r * (1.1 - 0.5 * t), r * 1.1 - t * r * 2.5);
    motes = max(motes, glow(q - c, r * 0.045) * sin(t * 3.14159) * 0.8);
  }
  vec3 c = mix(col, vec3(1.0), motes * 0.5);
  return col4(c, max(a, motes) * show(0.0, 0.1, 0.8, 1.0) * edgeFade(q));
}`;

// Fuego: llamas que suben, ondas de calor y chispas
const FIRE = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float n = vnoise(vec2(u.x * 3.0, u.y * 2.5 + p * 9.0)) * 0.6 + vnoise(vec2(u.x * 6.0, u.y * 5.0 + p * 15.0)) * 0.4;
  float s = (0.9 - u.y) / (2.2 * (0.6 + 0.4 * smoothstep(0.0, 0.3, p)));
  float wid = 1.0 - s * 0.7;
  float env = smoothstep(-0.08, 0.06, s) * (1.0 - smoothstep(0.75, 1.0, s)) * (1.0 - smoothstep(0.85 * wid, wid, abs(u.x)));
  float f = smoothstep(s * 0.8 + 0.15, s * 0.8 + 0.35, n) * env;
  float core = smoothstep(s * 0.8 + 0.4, s * 0.8 + 0.6, n) * env;
  float heat = lineMask(abs(fract(u.y * 2.0 + p * 3.0 + sin(u.x * 4.0 + p * 8.0) * 0.15) - 0.5), 0.08) * glow(q, r * 0.9) * 0.25 * show(0.0, 0.15, 0.5, 0.7);
  float emb = 0.0;
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float t = fract(p * 1.4 + hash(fi + 9.0));
    vec2 c = vec2((hash(fi) - 0.5) * r * 1.6 + sin(t * 7.0 + fi) * r * 0.1, r * 0.6 - t * r * 2.4);
    emb = max(emb, glow(q - c, r * 0.04) * (1.0 - t));
  }
  vec3 c = mix(col, vec3(1.0, 0.95, 0.6), core);
  return col4(c, max(max(f, heat), emb) * show(0.0, 0.12, 0.7, 1.0) * edgeFade(q));
}`;

// Agua: corrientes que giran en espiral hacia arriba y gotas
const WATER = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float a = 0.0;
  float hi = 0.0;
  float top = mix(1.0, -1.5, smoothstep(0.0, 0.55, p));
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ph = u.y * 2.6 + fi * 2.094 + p * 9.0;
    float x = (0.9 - (1.0 - u.y) * 0.15) * sin(ph);
    float depth = cos(ph);
    float w = 0.09 + 0.05 * depth;
    float on = step(top, u.y) * (1.0 - smoothstep(0.7, 1.05, u.y));
    a = max(a, lineMask(abs(u.x - x), w) * on * (0.6 + 0.4 * depth));
    hi = max(hi, lineMask(abs(u.x - x + w * 0.3), w * 0.35) * on * step(0.0, depth));
  }
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float t = fract(p * 1.2 + hash(fi + 2.0));
    vec2 c = vec2((hash(fi) - 0.5) * 2.2, 0.8 - t * 2.4);
    a = max(a, (1.0 - smoothstep(0.05, 0.07, length(vec2(u.x - c.x, (u.y - c.y) * 0.7)))) * (1.0 - t) * 0.8);
  }
  vec3 c = mix(col, vec3(1.0), hi * 0.7);
  return col4(c, a * show(0.0, 0.12, 0.75, 1.0) * edgeFade(q));
}`;

// Aire: torbellino con ondas de movimiento que se desvanece
const AIR = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float h = clamp((1.0 - u.y) / 2.4, 0.0, 1.0);
  float width = 0.25 + h * 0.95;
  float inside = (1.0 - smoothstep(width * 0.85, width, abs(u.x))) * step(-1.4, u.y) * step(u.y, 1.0);
  float stripes = lineMask(abs(fract(u.x / width * 1.5 + h * 3.0 + p * 6.0) - 0.5), 0.12);
  float swirl = stripes * inside * (0.5 + 0.5 * sin(h * 10.0 - p * 20.0));
  float wind = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float y = -1.0 + fi * 0.55;
    float xo = fract(p * 1.5 + hash(fi)) * 4.0 - 2.0;
    wind = max(wind, lineMask(abs(u.y - y - sin((u.x - xo) * 2.0) * 0.12), 0.05) * (1.0 - smoothstep(0.0, 0.8, abs(u.x - xo))) * 0.6);
  }
  return col4(col, max(swirl * 0.85, wind) * show(0.0, 0.12, 0.7, 1.0) * edgeFade(q));
}`;

// Tierra: rocas y guijarros que se elevan rápido y se desvanecen
const EARTH = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float a = 0.0;
  float shade = 0.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float t = clamp((p - hash(fi + 1.0) * 0.25) / 0.6, 0.0, 1.0);
    float rise = 1.0 - pow(1.0 - t, 3.0);
    vec2 c = vec2((hash(fi + 3.0) - 0.5) * 2.2, 1.0 - rise * (0.9 + hash(fi + 5.0) * 1.2));
    float s = 0.1 + 0.14 * hash(fi + 7.0);
    vec2 v = rot(u - c, t * 3.0 * (hash(fi) - 0.5) + fi);
    float d = max(abs(v.x) * (1.0 + 0.3 * hash(fi + 8.0)), abs(v.y)) + (abs(v.x) + abs(v.y)) * 0.35;
    float rock = (1.0 - smoothstep(s, s + 0.02, d)) * smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.75, 1.0, p));
    a = max(a, rock);
    shade = max(shade, rock * step(0.0, v.x - v.y));
  }
  float dust = vnoise(u * 3.0 + vec2(0.0, p * 3.0)) * glow(q - vec2(0.0, r * 0.7), r * 0.7) * show(0.0, 0.2, 0.5, 0.9) * 0.5;
  return col4(col * (0.75 + 0.35 * shade), max(a, dust) * edgeFade(q));
}`;

// Metal: espinas de mineral que emergen y se afilan en cuchillas
const METAL = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float a = 0.0;
  float hi = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float t = clamp((p - fi * 0.04) / 0.5, 0.0, 1.0);
    float x0 = (fi - 3.0) * 0.32 + (hash(fi) - 0.5) * 0.1;
    float H = (0.9 + hash(fi + 2.0) * 0.8) * (1.0 - pow(1.0 - t, 2.0));
    float h = (0.95 - u.y) / max(H, 0.001);
    float cx = x0 + (fi - 3.0) * 0.08 * h * H;
    float hw = mix(0.16, 0.06, t) * (1.0 - h);
    float spike = step(0.0, h) * step(h, 1.0) * (1.0 - smoothstep(hw * 0.9, hw + 0.001, abs(u.x - cx)));
    a = max(a, spike);
    hi = max(hi, spike * lineMask(abs(u.x - cx - hw * 0.3), hw * 0.35 + 0.001) * step(0.4, t));
  }
  float glint = lineMask(abs(u.x + u.y * 0.4 - (p * 4.0 - 2.0)), 0.12) * a;
  vec3 c = mix(col * 0.75, vec3(1.0), max(hi * 0.8, glint));
  return col4(c, a * show(0.0, 0.05, 0.75, 1.0) * edgeFade(q));
}`;

// Madera: raíces que brillan y se estiran en enredaderas espinosas
const WOOD = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float a = 0.0;
  float g = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float prog = clamp(p * 1.8 - fi * 0.08, 0.0, 1.0);
    float side = fi - 2.0;
    float yTop = 1.0 - prog * (1.6 + hash(fi) * 0.6);
    float y = clamp(u.y, yTop, 1.0);
    float x = side * 0.25 + side * 0.125 * (1.0 - y) * (1.0 - y) + sin((1.0 - y) * 5.0 + fi) * 0.12;
    float wv = 0.07 * (0.3 + 0.7 * (y - yTop) / max(1.0 - yTop, 0.01));
    float vine = lineMask(abs(u.x - x), wv) * step(yTop, u.y) * step(u.y, 1.0);
    float th = fract((1.0 - u.y) * 6.0 + fi * 0.37);
    float sideSign = step(0.5, fract((1.0 - u.y) * 3.0 + fi * 0.2)) * 2.0 - 1.0;
    float dx = (u.x - x) * sideSign;
    float thorn = step(0.0, dx) * (1.0 - smoothstep(0.0, 0.12 * (1.0 - th), dx - wv * 0.3)) * step(th, 0.35) * step(yTop + 0.05, u.y) * step(u.y, 0.9) * step(0.5, prog);
    a = max(a, max(vine, thorn * 0.9));
    g = max(g, vine);
  }
  float vis = show(0.0, 0.05, 0.75, 1.0);
  float pulse = 0.5 + 0.5 * sin(p * 25.0);
  vec3 c = mix(col * 0.6, mix(col, vec3(1.0, 1.0, 0.7), 0.4), g * pulse);
  float glowA = glow(q - vec2(0.0, r * 0.6), r * 0.6) * 0.3 * vis;
  return col4(c, max(a * vis, glowA) * edgeFade(q));
}`;

// ---------- Rasgos de clase ----------

// Furia: rostro animal minimalista que sube y se difumina
const RAGE = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = (q - vec2(0.0, -p * r * 0.9)) / (r * (0.9 + p * 0.4));
  vec2 m = vec2(abs(u.x), u.y);
  float ear = max(lineMask(segDist(m, vec2(0.35, -0.55), vec2(0.6, -0.95)), 0.07), lineMask(segDist(m, vec2(0.6, -0.95), vec2(0.7, -0.4)), 0.07));
  float brow = lineMask(segDist(m, vec2(0.08, -0.32), vec2(0.42, -0.45)), 0.08);
  float eye = lineMask(segDist(m, vec2(0.15, -0.2), vec2(0.38, -0.27)), 0.07);
  float snout = lineMask(segDist(m, vec2(0.0, 0.06), vec2(0.13, 0.0)), 0.07);
  float mouth = lineMask(abs(length(vec2(u.x, (u.y - 0.25) * 1.6)) - 0.32), 0.07) * step(0.2, u.y);
  float fang = lineMask(segDist(m, vec2(0.16, 0.3), vec2(0.11, 0.48)), 0.07);
  float head = lineMask(abs(length(vec2(u.x * 0.95, u.y * 1.05)) - 0.72), 0.06) * step(-0.6, u.y) * 0.6;
  float face = max(max(max(ear, brow), max(eye, snout)), max(max(mouth, fang), head));
  float burst = glow(q, r * 0.5) * 0.35 * show(0.0, 0.1, 0.3, 0.5);
  vec3 c = mix(col, vec3(1.0, 0.92, 0.8), eye);
  return col4(c, max(face * show(0.0, 0.15, 0.6, 1.0), burst) * edgeFade(q));
}`;

// Presa: una diana se cierra sobre el objetivo
const PREY = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  float shrink = mix(1.8, 1.0, 1.0 - pow(1.0 - min(p / 0.4, 1.0), 3.0));
  vec2 u = q / (r * shrink);
  float rr = length(u);
  float rings = min(1.0, lineMask(abs(rr - 1.0), 0.06) + lineMask(abs(rr - 0.62), 0.05) + (1.0 - smoothstep(0.12, 0.17, rr)));
  float xhair = (lineMask(abs(u.x), 0.035) * step(0.75, abs(u.y)) + lineMask(abs(u.y), 0.035) * step(0.75, abs(u.x))) * step(max(abs(u.x), abs(u.y)), 1.3);
  float flash = glow(q, r * 0.4) * show(0.35, 0.42, 0.45, 0.6);
  return col4(mix(col, vec3(1.0), flash), max(max(rings, xhair) * show(0.0, 0.1, 0.75, 1.0), flash) * edgeFade(q));
}`;

// Ataque furtivo: sombra sobre el token y un antifaz de ladrón
const ROGUE = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float shadowA = (1.0 - smoothstep(0.85, 1.15, length(u))) * 0.65 * show(0.0, 0.15, 0.7, 1.0);
  float mv = show(0.15, 0.3, 0.65, 0.85);
  vec2 m = vec2(abs(u.x), u.y + 0.15 + (1.0 - mv) * 0.2) * 0.75;
  float ell = length(vec2((m.x - 0.33) / 0.33, m.y / 0.2));
  float lobe = 1.0 - smoothstep(0.97, 1.03, ell);
  float bridge = step(m.x, 0.1) * step(abs(m.y + 0.03), 0.06);
  float hole = 1.0 - smoothstep(0.97, 1.03, length(vec2((m.x - 0.34) / 0.13, (m.y + 0.01) / 0.07)));
  float tie = lineMask(segDist(m, vec2(0.62, -0.02), vec2(0.85, 0.12)), 0.05);
  float maskA = clamp(max(max(lobe, bridge), tie) - hole, 0.0, 1.0) * mv;
  float rim = lineMask(abs(ell - 1.0), 0.12) * mv;
  vec3 dark = vec3(0.02, 0.02, 0.04);
  vec3 c = mix(dark, mix(col, vec3(0.92), rim * 0.7), max(maskA, rim));
  return col4(c, max(shadowA, max(maskA, rim)) * edgeFade(q));
}`;

// Panache: foco de escenario, un listón que gira y pétalos que caen
const PANACHE = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float hgt = clamp((u.y + 1.6) / 2.6, 0.0, 1.0);
  float coneW = 0.25 + hgt * 0.9;
  float cone = (1.0 - smoothstep(coneW * 0.7, coneW, abs(u.x))) * step(-1.6, u.y) * (1.0 - smoothstep(0.9, 1.2, u.y)) * 0.35;
  float pool = exp(-length(vec2(u.x, (u.y - 0.85) * 3.0)) * 2.0) * 0.4;
  float lightA = (cone + pool) * show(0.0, 0.2, 0.75, 1.0);
  float ph = u.y * 3.0 + p * 9.0;
  float depth = cos(ph);
  float rib = lineMask(abs(u.x - sin(ph) * 0.85), 0.06 + 0.05 * abs(depth)) * step(-1.0, u.y) * step(u.y, 0.8) * (0.55 + 0.45 * depth) * show(0.05, 0.2, 0.7, 0.9);
  float pet = 0.0;
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float t = fract(p * 0.7 + hash(fi + 1.0));
    vec2 c = vec2((hash(fi) - 0.5) * 2.4 + sin(t * 6.0 + fi) * 0.2, -1.4 + t * 2.6);
    vec2 v = rot(u - c, t * 8.0 + fi);
    pet = max(pet, (1.0 - smoothstep(0.9, 1.0, length(vec2(v.x / 0.09, v.y / 0.05)))) * sin(t * 3.14159));
  }
  pet *= show(0.0, 0.1, 0.85, 1.0);
  vec3 c = mix(vec3(1.0, 0.97, 0.85), col, max(rib, pet));
  return col4(c, max(lightA, max(rib, pet)) * edgeFade(q));
}`;

// Golpe de gracia: pétalos y luces que suben
const FINISHER = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float a = 0.0;
  float sp = 0.0;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float t = clamp((p - hash(fi + 2.0) * 0.3) / 0.7, 0.0, 1.0);
    vec2 c = vec2((hash(fi) - 0.5) * 2.2 + sin(t * 5.0 + fi) * 0.25, 0.9 - t * 2.6);
    vec2 v = rot(u - c, t * 9.0 + fi);
    float on = sin(t * 3.14159) * step(0.001, t);
    a = max(a, (1.0 - smoothstep(0.9, 1.0, length(vec2(v.x / 0.1, v.y / 0.055)))) * on);
    sp = max(sp, sparkle(u - c - vec2(0.3, 0.2), 0.12) * on * step(0.5, hash(fi + 9.0)));
  }
  float flash = glow(q, r * 0.45) * show(0.0, 0.05, 0.15, 0.4) * 0.6;
  vec3 c = mix(col, vec3(1.0), max(min(sp, 1.0), flash));
  return col4(c, max(max(a, sp), flash) * edgeFade(q));
}`;

// Estratagema: una lupa minimalista sobre el objetivo
const LENS = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float pop = smoothstep(0.0, 0.2, p);
  float sc = mix(0.6, 1.0, 1.0 - pow(1.0 - pop, 3.0));
  vec2 v = (u - vec2(-0.15, -0.15)) / sc;
  float ring = lineMask(abs(length(v) - 0.55), 0.09);
  float glass = (1.0 - smoothstep(0.5, 0.55, length(v))) * 0.15;
  float handle = lineMask(segDist(v, vec2(0.42, 0.42), vec2(0.95, 0.95)), 0.16);
  float glint = lineMask(abs(length(v - vec2(-0.1, -0.1)) - 0.3), 0.06) * step(v.x + v.y, -0.25) * 0.8;
  float a = max(max(ring, handle), max(glass, glint)) * show(0.0, 0.12, 0.7, 1.0);
  return col4(mix(col, vec3(1.0), glint), a * edgeFade(q));
}`;

// Provocar: la vena de enojo de las caricaturas sobre la cabeza
const TAUNT = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float beat = 1.0 + 0.18 * abs(sin(p * 18.0));
  vec2 v = (u - vec2(0.42, -0.72)) / (0.42 * beat * max(smoothstep(0.0, 0.15, p), 0.05));
  float a = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 sgn = vec2((i == 0 || i == 3) ? 1.0 : -1.0, (i < 2) ? 1.0 : -1.0);
    vec2 w = v * sgn;
    float inQuad = step(0.16, w.x) * step(0.16, w.y) * step(length(v), 0.85);
    a = max(a, lineMask(abs(length(w - vec2(0.95, 0.95)) - 0.9), 0.22) * inQuad);
  }
  return col4(col, a * show(0.0, 0.08, 0.75, 1.0) * edgeFade(q));
}`;

// Sobrecarga: humo, llamitas y un engranaje que gira
const OVERDRIVE = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float vis = show(0.0, 0.12, 0.7, 1.0);
  vec2 g = u - vec2(0.0, -0.2);
  float th = atan(g.y, g.x) + p * 6.0;
  float rr = length(g);
  float teeth = 0.42 + 0.08 * step(0.5, fract(th / 6.2832 * 8.0));
  float gear = (1.0 - smoothstep(teeth - 0.03, teeth, rr)) * smoothstep(0.14, 0.17, rr) * vis;
  float smoke = vnoise(vec2(u.x * 2.5, u.y * 2.0 + p * 4.0)) * glow(q - vec2(0.0, -r * p * 0.8), r * 0.55) * show(0.1, 0.35, 0.75, 1.0);
  float fl = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float t = fract(p * 1.6 + hash(fi + 1.0));
    vec2 c = vec2((hash(fi) - 0.5) * 1.4, 0.7 - t * 1.6);
    fl = max(fl, glow(u - c, 0.06) * (1.0 - t) * vis);
  }
  vec3 c = mix(col, vec3(0.55), smoothstep(0.2, 0.6, smoke) * (1.0 - gear));
  c = mix(c, vec3(1.0, 0.85, 0.4), fl);
  return col4(c, max(max(gear, smoke * 0.7), fl) * edgeFade(q));
}`;

// Explosión: bola de fuego, onda expansiva y humo que queda
const EXPLODE = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float rr = length(u);
  float R = mix(0.2, 1.3, 1.0 - pow(1.0 - min(p / 0.35, 1.0), 2.0));
  float n = vnoise(u * 4.0 + p * 3.0);
  float ball = (1.0 - smoothstep(R * (0.7 + 0.3 * n), R * (0.9 + 0.3 * n), rr)) * (1.0 - smoothstep(0.25, 0.5, p));
  float core = (1.0 - smoothstep(0.0, R * 0.6, rr)) * (1.0 - smoothstep(0.1, 0.35, p));
  float shock = lineMask(abs(rr - mix(0.3, 1.5, min(p / 0.4, 1.0))), 0.08) * (1.0 - smoothstep(0.2, 0.45, p));
  float sm = vnoise(vec2(u.x * 2.0, u.y * 2.0 + p * 2.0)) * (1.0 - smoothstep(0.4, 1.3, rr + (u.y + 0.5) * 0.3)) * show(0.25, 0.45, 0.8, 1.0);
  vec3 fire = mix(col, vec3(1.0, 0.95, 0.6), core);
  vec3 c = mix(vec3(0.35), fire, max(ball, shock));
  return col4(c, max(max(ball, shock), smoothstep(0.25, 0.6, sm) * 0.8) * edgeFade(q));
}`;

// Táctica: un estandarte que sube y ondea
const BANNER = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 u = q / r;
  float rise = 1.0 - pow(1.0 - smoothstep(0.0, 0.35, p), 3.0);
  vec2 v = u - vec2(-0.25, 0.65 - rise * 0.85);
  float pole = lineMask(segDist(v, vec2(0.0, 0.6), vec2(0.0, -1.0)), 0.07);
  float knob = 1.0 - smoothstep(0.06, 0.09, length(v - vec2(0.0, -1.05)));
  float fx = clamp(v.x / 0.9, 0.0, 1.0);
  float wave = sin(v.x * 6.0 - p * 18.0) * 0.06 * fx;
  float flag = step(0.0, v.x) * step(v.x, 0.9) * step(-0.95 + wave, v.y) * step(v.y, -0.4 + wave - fx * 0.05);
  float stripe = flag * lineMask(abs(v.y - (-0.68 + wave - fx * 0.02)), 0.05);
  vec3 c = mix(col, vec3(1.0), max(stripe * 0.6, pole * 0.5 + knob));
  return col4(c, max(max(pole, knob), flag) * show(0.0, 0.1, 0.75, 1.0) * edgeFade(q));
}`;

// Ráfaga de puñetazos: golpes rápidos en la dirección del ataque con impactos
const FLURRY = `${HEADER}
half4 main(float2 coord) {
  vec2 q = local(coord);
  vec2 pr = vec2(-dir.y, dir.x);
  float a = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float t = clamp((p - fi * 0.11) / 0.3, 0.0, 1.0);
    vec2 s0 = -dir * 0.85 + pr * (hash(fi + 2.0) - 0.5) * 0.5;
    float L = 0.75 * min(t * 2.0, 1.0);
    vec2 tip = s0 + dir * L;
    vec2 v = q - s0;
    float along = dot(v, dir);
    float streak = lineMask(abs(dot(v, pr)), 0.05 * clamp(along / max(L, 0.01), 0.2, 1.0)) * step(0.0, along) * step(along, L) * (1.0 - smoothstep(0.5, 1.0, t));
    float fist = (1.0 - smoothstep(0.07, 0.1, length(q - tip))) * step(0.001, t) * (1.0 - smoothstep(0.55, 0.8, t));
    float it = clamp((t - 0.5) / 0.5, 0.0, 1.0);
    float ring = lineMask(abs(length(q - tip) - it * 0.25), 0.03) * step(0.001, it) * (1.0 - it);
    float ang = atan(dot(q - tip, pr), dot(q - tip, dir));
    float rays = pow(abs(cos(ang * 4.0)), 20.0) * exp(-length(q - tip) / 0.12) * step(0.001, it) * (1.0 - it) * 2.0;
    a = max(a, max(max(streak * 0.8, fist), max(ring, rays)));
  }
  return col4(col, a * edgeFade(q));
}`;

const FX_SKSL: Partial<Record<FxKind, string>> = {
  heal: HEAL,
  damage: DAMAGE,
  shield: SHIELD,
  spell: SPELL,
  stars: STARS,
  slash: SLASH,
  thrust: THRUST,
  impact: IMPACT,
  arrow: ARROW,
  spin: SPIN,
  gun: GUN,
  lob: LOB,
  flurry: FLURRY,
  arcane: ARCANE,
  occult: OCCULT,
  primal: PRIMAL,
  divine: DIVINE,
  void: VOID,
  vital: VITAL,
  infernal: INFERNAL,
  monk: MONK,
  bardic: BARDIC,
  spirit: SPIRIT,
  fire: FIRE,
  water: WATER,
  air: AIR,
  earth: EARTH,
  metal: METAL,
  wood: WOOD,
  rage: RAGE,
  prey: PREY,
  rogue: ROGUE,
  panache: PANACHE,
  finisher: FINISHER,
  lens: LENS,
  taunt: TAUNT,
  overdrive: OVERDRIVE,
  explode: EXPLODE,
  banner: BANNER,
};

// Para probar los sombreadores fuera de Owlbear (scripts/check-fx.mjs)
export const ALL_SKSL = FX_SKSL;

// Los efectos sin sombreador propio usan el círculo rúnico
export const fxSksl = (k: FxKind) => FX_SKSL[k] ?? SPELL;
export const fxTiming = (k: FxKind) => FX_TIMING[k] ?? 1500;
