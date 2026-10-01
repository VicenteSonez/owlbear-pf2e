// Efectos visuales sobre el mapa. Cada efecto es un sombreador SkSL que Owlbear dibuja en la GPU.
// El progreso (p, de 0 a 1) lo avanza el script de fondo: el uniform "time" de Owlbear son
// segundos Unix y en un float de GPU no tiene precisión para animar.
import type { Weapon } from "./pathbuilder";

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
  | "lob";

export type AttackFx = Extract<FxKind, "slash" | "thrust" | "impact" | "arrow" | "spin" | "gun" | "lob">;

// Efecto que viaja con una tirada (ataque con arma o de conjuro)
export interface RollFx {
  kind: FxKind;
  // Índice en DIRS (solo ataques con arma)
  dir?: number;
}

export const ATTACK_FX: { id: AttackFx; label: string; ranged: boolean }[] = [
  { id: "slash", label: "Cortes", ranged: false },
  { id: "thrust", label: "Estocada", ranged: false },
  { id: "impact", label: "Impacto", ranged: false },
  { id: "arrow", label: "Flecha", ranged: true },
  { id: "spin", label: "Cortes giratorios", ranged: true },
  { id: "gun", label: "Disparo", ranged: true },
  { id: "lob", label: "Proyectil curvo", ranged: true },
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
export const FX_TIMING: Record<FxKind, number> = {
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
};

export const RANGED_CELLS = 5;

const HEADER = `
uniform vec2 size;
uniform float p;
uniform float cells;
uniform vec2 dir;
uniform float r;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
vec2 local(vec2 coord) { return (coord / size - 0.5) * cells; }
float segDist(vec2 q, vec2 a, vec2 b) {
  vec2 pa = q - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h);
}
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
  return col4(vec3(0.35, 1.0, 0.45), a);
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
  return col4(c, a);
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
  return col4(vec3(0.78, 0.9, 1.0), a);
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
  return col4(c, max(a, sparks));
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
  return col4(vec3(1.0, 0.86, 0.25), a * show);
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
  return col4(vec3(1.0), a);
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
  return col4(vec3(1.0), a);
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
  return col4(vec3(1.0), a);
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
  return col4(vec3(1.0), max(max(streak, chev), glow) * fade);
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
  return col4(vec3(1.0), max(ring * arcMask, trail) * fade);
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
  return col4(vec3(1.0), max(fl, tracer));
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
  return col4(vec3(1.0), a);
}`;

export const FX_SKSL: Record<FxKind, string> = {
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
};
