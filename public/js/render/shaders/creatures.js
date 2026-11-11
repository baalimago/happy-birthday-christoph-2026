// The sea's creatures, as GLSL: dolphins, whales, gulls, turtles, flying fish, splashes and
// spouts, and the kraken. Each is a small distance field in its own frame (facing +z, y up),
// traced only inside its bounding sphere, so a pixel that sees none of them pays almost nothing.
//
// Two GLSL parts. CREATURES goes after the scene: call beasts(ro, rd, t, id) in main() after
// props(); a hit sets id to BEAST_ID + kind (or KRAKEN_ID) and leaves its world normal in gBeastN
// and its point in the creature's own frame in gBeastQ. beastWater(w) tells a view's sea where to
// put foam round the creatures and their shapes under the surface. BEAST_SHADE goes after the
// views, since shade_beast(id, p, n, rd, q, t, fc, k) lights the creatures with each view's own
// helpers (p_sun and p_fog, termBeam, gdLit, burin and plate); the view's post pass runs after it.
//
// Uniforms (renderer.js fills them from frame.beasts and frame.kraken):
//   uBeast[2*i]     x, y, z, heading          (heading 0 north, positive clockwise)
//   uBeast[2*i + 1] kind (-1 none), size, pitch (nose up positive), anim
//   uKraken[0]      x, z, heading, rise (0 none .. 1 fully up)
//   uKraken[1]      reach (0..1, arms lunging), 0, 0, 0

/** Creatures the shader has room for. */
export const BEASTS = 14;
/** Kinds, in shader order: a beast's kind is its index here. */
export const KINDS = /** @type {const} */ ([
  'dolphin',
  'whale',
  'gull',
  'turtle',
  'flyingfish',
  'splash',
  'spout',
]);
/** The first creature id: hits are BEAST_ID + kind, and the kraken is KRAKEN_ID. */
export const BEAST_ID = 20;
export const KRAKEN_ID = 30;

export const CREATURES = /* glsl */ `
uniform vec4 uBeast[${BEASTS * 2}];
uniform vec4 uKraken[2];

vec3 gBeastN = vec3(0.0, 1.0, 0.0);   // world normal of the creature hit
vec3 gBeastQ = vec3(0.0);             // the hit in the creature's own frame, model units
float gBeastPart = 0.0;               // kraken: 0 mantle, 1 arm, 2 eye
float gBeastAnim = 0.0;
vec3 gArm[80];                        // the kraken's arms, 8 of 10 joints, in its frame

float bEll(vec3 p, vec3 r){
  float k0 = length(p/r), k1 = length(p/(r*r));
  return k0*(k0 - 1.0)/max(k1, 1e-5);
}
float bCap(vec3 p, vec3 a, vec3 b, float ra, float rb){
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0);
  return length(pa - ba*h) - mix(ra, rb, h);
}
float bMin(float a, float b, float k){
  float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0);
  return mix(b, a, h) - k*h*(1.0 - h);
}
float bTri(vec2 p, vec2 p0, vec2 p1, vec2 p2){
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2, v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0*clamp(dot(v0, e0)/dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1*clamp(dot(v1, e1)/dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2*clamp(dot(v2, e2)/dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x*e2.y - e0.y*e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s*(v0.x*e0.y - v0.y*e0.x)),
                   vec2(dot(pq1, pq1), s*(v1.x*e1.y - v1.y*e1.x))),
               vec2(dot(pq2, pq2), s*(v2.x*e2.y - v2.y*e2.x)));
  return -sqrt(d.x)*sign(d.y);
}
mat2 bRot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// ---- the animals, about life size in their own units
float dolphinD(vec3 p, float a){
  // the tail stock beats up and down
  float aft = max(0.0, 0.1 - p.z);
  p.y -= 0.16*sin(a)*aft*aft;
  float taper = mix(0.3, 1.0, smoothstep(-1.25, 0.15, p.z))*mix(1.0, 0.75, smoothstep(0.5, 1.1, p.z));
  float d = bEll(p - vec3(0.0, 0.0, 0.0), vec3(0.3*taper, 0.31*taper, 1.12));
  d = bMin(d, bEll(p - vec3(0.0, -0.07, 1.12), vec3(0.075, 0.06, 0.24)), 0.1);
  vec3 f = p - vec3(0.0, 0.2, -0.05);
  d = bMin(d, max(bTri(f.zy, vec2(0.28, 0.0), vec2(-0.28, 0.0), vec2(-0.38, 0.34)), abs(f.x) - 0.025), 0.06);
  vec3 q = vec3(abs(p.x), p.y, p.z) - vec3(0.26, -0.16, 0.45);
  q.xy = bRot(0.5)*q.xy; q.z += q.x*0.5;
  d = bMin(d, bEll(q, vec3(0.2, 0.025, 0.09)), 0.05);
  vec3 t = p - vec3(0.0, 0.0, -1.18);
  t.z += abs(t.x)*0.5;
  d = bMin(d, bEll(t, vec3(0.42, 0.03, 0.12)), 0.06);
  return d;
}
float whaleD(vec3 p, float a){
  float aft = max(0.0, -p.z);
  p.y -= 0.012*sin(a)*aft*aft;
  float taper = mix(0.22, 1.0, smoothstep(-6.2, 0.0, p.z))*mix(1.0, 0.7, smoothstep(2.5, 6.0, p.z));
  float d = bEll(p - vec3(0.0, 0.0, 0.3), vec3(1.55*taper, 1.35*taper, 6.3));
  d = bMin(d, bEll(p - vec3(0.0, 0.95, -3.2), vec3(0.2, 0.35, 0.6)), 0.4);
  // long pale flippers
  vec3 q = vec3(abs(p.x), p.y, p.z);
  d = bMin(d, bCap(q, vec3(1.1, -0.6, 2.6), vec3(3.4, -1.2, 0.4), 0.32, 0.12), 0.3);
  vec3 t = p - vec3(0.0, 0.0, -6.4);
  t.z += abs(t.x)*0.45;
  d = bMin(d, bEll(t, vec3(2.3, 0.12, 0.75)), 0.3);
  return d;
}
float gullD(vec3 p, float wing){
  float d = bEll(p, vec3(0.085, 0.085, 0.24));
  d = bMin(d, length(p - vec3(0.0, 0.05, 0.22)) - 0.07, 0.04);
  d = min(d, bEll(p - vec3(0.0, 0.035, 0.32), vec3(0.018, 0.02, 0.065)));
  d = bMin(d, bEll(p - vec3(0.0, 0.0, -0.27), vec3(0.075, 0.012, 0.1)), 0.03);
  vec3 w = vec3(abs(p.x), p.y, p.z) - vec3(0.05, 0.02, 0.0);
  w.xy = bRot(-wing)*w.xy;
  float inner = bEll(w - vec3(0.27, 0.0, 0.02), vec3(0.27, 0.016, 0.1));
  vec3 o = w - vec3(0.52, 0.0, 0.0);
  o.xy = bRot(wing*0.7)*o.xy;
  o.z += max(o.x, 0.0)*0.35;
  float outer = bEll(o - vec3(0.24, 0.0, 0.0), vec3(0.26, 0.012, 0.075));
  return bMin(d, min(inner, outer), 0.03);
}
float turtleD(vec3 p, float a){
  float d = bEll(p - vec3(0.0, 0.0, 0.0), vec3(0.42, 0.15, 0.52));
  d = bMin(d, bEll(p - vec3(0.0, 0.0, 0.63), vec3(0.1, 0.08, 0.14)), 0.05);
  vec3 q = vec3(abs(p.x), p.y, p.z);
  vec3 f = q - vec3(0.42, -0.04, 0.28);
  f.xz = bRot(-0.6 + 0.45*sin(a))*f.xz;
  d = bMin(d, bEll(f - vec3(0.2, 0.0, 0.0), vec3(0.26, 0.025, 0.08)), 0.04);
  vec3 h = q - vec3(0.25, -0.04, -0.45);
  d = bMin(d, bEll(h, vec3(0.1, 0.02, 0.09)), 0.04);
  return d;
}
float flyingfishD(vec3 p, float a){
  float d = bEll(p, vec3(0.045, 0.045, 0.18));
  vec3 w = vec3(abs(p.x), p.y, p.z) - vec3(0.15, 0.015, 0.05);
  w.z += w.x*0.4;
  d = min(d, bEll(w, vec3(0.16, 0.006, 0.06)));
  vec3 t = p - vec3(0.0, 0.0, -0.2);
  t.x += 0.03*sin(a);
  d = min(d, bEll(vec3(t.x, abs(t.y) - 0.04, t.z + abs(t.y)*0.5), vec3(0.01, 0.05, 0.05)));
  return d;
}
// a crown of drops round a column, rising and falling with age a (0..1)
float splashD(vec3 p, float a){
  float up = 3.2*a*(1.0 - a);
  float d = bEll(p - vec3(0.0, up*0.45, 0.0), vec3(0.14 + 0.2*a, 0.05 + 0.75*up, 0.14 + 0.2*a));
  float ang = atan(p.x, p.z), sector = 6.2832/7.0;
  float s = mod(ang + sector*0.5, sector) - sector*0.5;
  float rr = length(p.xz);
  vec2 local = vec2(rr*cos(s), rr*sin(s));
  vec3 c = vec3(local.x - (0.3 + 0.9*a), p.y - up*0.6, local.y);
  d = min(d, length(c) - (0.11*(1.0 - a) + 0.03));
  return d;
}
// the blow of a whale: a tall plume of mist that spreads and thins
float spoutD(vec3 p, float a){
  float grow = min(1.0, a*4.0), fade = 1.0 - smoothstep(0.55, 1.0, a);
  float y = 1.6*grow;
  float wobble = 0.08*sin(p.y*5.0 + a*20.0) + 0.06*sin(p.x*7.0 + p.z*5.0);
  return bEll(p - vec3(0.0, y + 0.2*a, 0.0), vec3(0.25 + 0.7*a, 1.6*grow, 0.25 + 0.7*a)*fade + 0.01)
       + wobble*fade;
}
float beastD(int kind, vec3 p, float a){
  if (kind == 0) return dolphinD(p, a);
  if (kind == 1) return whaleD(p, a);
  if (kind == 2) return gullD(p, a);
  if (kind == 3) return turtleD(p, a);
  if (kind == 4) return flyingfishD(p, a);
  if (kind == 5) return splashD(p, a);
  return spoutD(p, a);
}
float beastR(int kind){
  return kind == 0 ? 1.55 : kind == 1 ? 8.5 : kind == 2 ? 0.95 : kind == 3 ? 0.95
       : kind == 4 ? 0.4 : kind == 5 ? 1.5 : 3.6;
}

// world direction into a creature's frame (heading h, pitch q as cos and sin), and back
vec3 bIn(vec3 v, vec2 h, vec2 q){
  vec3 l = vec3(v.x*h.x - v.z*h.y, v.y, v.x*h.y + v.z*h.x);
  return vec3(l.x, l.y*q.x - l.z*q.y, l.z*q.x + l.y*q.y);
}
vec3 bOut(vec3 l, vec2 h, vec2 q){
  vec3 m = vec3(l.x, l.y*q.x + l.z*q.y, l.z*q.x - l.y*q.y);
  return vec3(m.x*h.x + m.z*h.y, m.y, -m.x*h.y + m.z*h.x);
}

// ---- the kraken, in its own frame: origin on the sea, +z towards its prey
const int JOINTS = 10;
vec3 krakenMantle(){ return vec3(0.0, -4.6 + 6.6*uKraken[0].w, -1.4); }
vec3 krakenEye(){ return vec3(1.7, -0.45, 2.85); }   // from the mantle's centre, either side
// The arms' joints, worked out once per pixel. Each arm leaves the sea round the mantle, rears up,
// arches over and curls its tip down and in; the ones in front straighten at the boat to strike.
void krakenArms(){
  float rise = uKraken[0].w, reach = uKraken[1].x;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float ang = (fi + 0.5)/8.0*6.2832 + 0.15*sin(fi*5.1);
    vec2 dir = vec2(sin(ang), cos(ang));
    float front = smoothstep(0.1, 0.9, dir.y)*reach;
    vec2 aim = normalize(mix(dir, vec2(dir.x*0.3, 1.0), front));
    float len = (10.0 + 2.0*sin(fi*3.7))*rise*(1.0 + 0.7*front);
    vec3 p = vec3(dir.x*(2.4 + 0.6*cos(fi*2.9)), -2.2, dir.y*(2.4 + 0.6*cos(fi*2.9)) - 0.4);
    gArm[i*JOINTS] = p;
    float sway = uT*1.4 + fi*1.7;
    for (int j = 1; j < JOINTS; j++) {
      float s = float(j)/float(JOINTS - 1);
      // elevation of this stretch of arm: up, over, and curled back under at the tip
      float e = 1.5 - (3.4 + 0.6*sin(fi*1.9))*s*s + 0.35*sin(sway + s*3.0);
      e = mix(e, 0.35 - 0.5*s, front);
      vec2 side = vec2(aim.y, -aim.x)*0.45*sin(sway*0.8 + s*4.0)*s;
      vec2 run = aim*cos(e) + side;
      p += (len/float(JOINTS - 1))*vec3(run.x, sin(e), run.y);
      gArm[i*JOINTS + j] = p;
    }
  }
}
// x: distance, y: part (0 mantle, 1 arm, 2 eye)
vec2 krakenD(vec3 p){
  vec3 c = krakenMantle();
  vec3 h = p - c;
  h.yz = bRot(0.5)*h.yz;
  // a tall, folded mantle over a broad head
  float mantle = bEll(h - vec3(0.0, 1.0, 0.0), vec3(2.3, 3.9, 2.5));
  mantle = bMin(mantle, bEll(p - c - vec3(0.0, -1.6, 1.4), vec3(2.9, 1.9, 2.4)), 1.0);
  mantle += 0.08*sin(h.y*3.0 + h.x*2.0)*smoothstep(0.0, 2.0, h.y);
  vec3 e = vec3(abs(p.x), p.y, p.z) - c - krakenEye();
  float eye = length(e) - 0.62;
  float arms = 1e9;
  for (int i = 0; i < 8; i++) {
    for (int j = 0; j < JOINTS - 1; j++) {
      float s = float(j)/float(JOINTS - 1), s2 = float(j + 1)/float(JOINTS - 1);
      arms = min(arms, bCap(p, gArm[i*JOINTS + j], gArm[i*JOINTS + j + 1],
                            0.75*(1.0 - s) + 0.07, 0.75*(1.0 - s2) + 0.07));
    }
  }
  float body = bMin(mantle, arms, 0.9);
  if (eye < body) return vec2(eye, 2.0);
  return vec2(body, arms < mantle ? 1.0 : 0.0);
}

// trace one creature; keeps the nearest hit
void beast(int i, vec3 o, vec3 d, inout float best, inout float id){
  vec4 A = uBeast[i*2], B = uBeast[i*2 + 1];
  if (B.x < -0.5) return;
  int kind = int(B.x + 0.5);
  float size = B.y;
  vec3 c = A.xyz + (kind == 6 ? vec3(0.0, 1.6*size, 0.0) : vec3(0.0));
  float r = beastR(kind)*size;
  vec3 oc = o - c;
  float b = dot(oc, d), disc = b*b - dot(oc, oc) + r*r;
  if (disc < 0.0) return;
  float s = sqrt(disc), t = max(-b - s, 0.0), end = min(-b + s, best);
  if (t > end) return;
  vec2 h = vec2(cos(A.w), sin(A.w)), q = vec2(cos(B.z), sin(B.z));
  vec3 lo = bIn(o - A.xyz, h, q)/size, ld = bIn(d, h, q);
  for (int j = 0; j < 44; j++) {
    if (t > end) return;
    float dd = beastD(kind, lo + ld*(t/size), B.w)*size;
    if (dd < 0.0008*t + 0.004*size) {
      best = t; id = ${BEAST_ID}.0 + float(kind);
      vec3 pl = lo + ld*(t/size);
      vec2 e = vec2(0.004, -0.004);
      vec3 nl = normalize(e.xyy*beastD(kind, pl + e.xyy, B.w) + e.yyx*beastD(kind, pl + e.yyx, B.w) +
                          e.yxy*beastD(kind, pl + e.yxy, B.w) + e.xxx*beastD(kind, pl + e.xxx, B.w));
      gBeastN = bOut(nl, h, q);
      gBeastQ = pl;
      gBeastAnim = B.w;
      return;
    }
    t += max(dd*0.8, 0.002*size);
  }
}
void kraken(vec3 o, vec3 d, inout float best, inout float id){
  vec4 K = uKraken[0];
  if (K.w < 0.01) return;
  vec3 c = vec3(K.x, 1.5, K.y);
  float r = 14.0 + 6.0*uKraken[1].x;
  vec3 oc = o - c;
  float b = dot(oc, d), disc = b*b - dot(oc, oc) + r*r;
  if (disc < 0.0) return;
  float s = sqrt(disc), t = max(-b - s, 0.0), end = min(-b + s, best);
  if (t > end) return;
  krakenArms();
  vec2 h = vec2(cos(K.z), sin(K.z)), q = vec2(1.0, 0.0);
  vec3 lo = bIn(o - vec3(K.x, 0.0, K.y), h, q), ld = bIn(d, h, q);
  for (int j = 0; j < 72; j++) {
    if (t > end) return;
    vec2 m = krakenD(lo + ld*t);
    if (m.x < 0.0008*t + 0.01) {
      best = t; id = ${KRAKEN_ID}.0;
      vec3 pl = lo + ld*t;
      vec2 e = vec2(0.01, -0.01);
      vec3 nl = normalize(e.xyy*krakenD(pl + e.xyy).x + e.yyx*krakenD(pl + e.yyx).x +
                          e.yxy*krakenD(pl + e.yxy).x + e.xxx*krakenD(pl + e.xxx).x);
      gBeastN = bOut(nl, h, q);
      gBeastQ = pl;
      gBeastPart = m.y;
      return;
    }
    t += max(m.x*0.75, 0.01);
  }
}
void beasts(vec3 o, vec3 d, inout float best, inout float id){
  for (int i = 0; i < ${BEASTS}; i++) beast(i, o, d, best, id);
  kraken(o, d, best, id);
}

// ---- what the creatures do to the sea round them: x = foam where a body breaks the surface or a
// splash lands, y = shade where one swims just under it (0..1 each). For the views' sea.
vec2 beastWater(vec2 w){
  vec2 r = vec2(0.0);
  for (int i = 0; i < ${BEASTS}; i++) {
    vec4 A = uBeast[i*2], B = uBeast[i*2 + 1];
    if (B.x < -0.5 || B.x > 6.5) continue;
    int kind = int(B.x + 0.5);
    vec2 d = w - A.xz;
    float size = B.y, reach = kind == 1 ? 9.0 : 2.5;
    if (dot(d, d) > reach*reach*size*size || kind == 2 || kind == 4) continue;
    if (kind >= 5) {
      // a splash rings out; a spout drizzles where it stands
      float a = B.w, rad = (0.3 + 1.3*a)*size*(kind == 6 ? 0.6 : 1.0);
      float l = length(d);
      r.x = max(r.x, (1.0 - smoothstep(0.0, 0.35*size, abs(l - rad)))*(1.0 - a)*(0.6 + 0.4*noise(w*6.0)));
      r.x = max(r.x, (1.0 - smoothstep(0.0, rad*0.8, l))*(1.0 - a)*0.8);
      continue;
    }
    vec2 l = vec2(d.x*cos(A.w) - d.y*sin(A.w), d.x*sin(A.w) + d.y*cos(A.w))/size;
    vec2 half_ = kind == 1 ? vec2(1.5, 6.4) : kind == 3 ? vec2(0.45, 0.6) : vec2(0.32, 1.15);
    float e = length(l/half_);
    float body = kind == 1 ? 1.3 : kind == 3 ? 0.15 : 0.31;   // half its height
    float y = A.y/size;
    // breaking the surface: foam hugs the waterline
    float breaks = 1.0 - smoothstep(0.0, body*0.6, abs(y) - body*0.4);
    float lap = (1.0 - smoothstep(0.0, 0.35, abs(e - 1.05)))*breaks;
    r.x = max(r.x, lap*(0.45 + 0.55*noise(w*5.0 + uT*0.8)));
    // under it: a darker shape
    r.y = max(r.y, (1.0 - smoothstep(0.55, 1.1, e))*smoothstep(-0.05, -0.5, y)*exp(min(y, 0.0)*0.45)*0.75);
  }
  // the kraken churns the sea round its mantle and where its arms go in
  vec4 K = uKraken[0];
  if (K.w > 0.01) {
    vec2 d = w - K.xy;
    float l = length(d);
    if (l < 16.0) {
      float n1 = noise(w*3.0 + uT*1.1), n2 = noise(w*7.0 - uT*1.7);
      float churn = (1.0 - smoothstep(2.5, 7.5, l + 2.0*n1))*K.w;
      r.x = max(r.x, churn*smoothstep(0.35, 0.75, 0.6*n1 + 0.4*n2 + 0.3*churn));
      r.y = max(r.y, (1.0 - smoothstep(3.0, 9.0, l))*K.w*0.8);
    }
  }
  return r;
}

`;

/** Colour: after the views, since it lights the creatures with their helpers. */
export const BEAST_SHADE = /* glsl */ `
// ---- colour, after the views: each view lights the creatures with its own helpers.
float bHash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719)))*43758.5453); }
// what a creature is made of, as albedo in display colour; w: 0 skin, 1 eye, 2 foam or mist
vec4 beastPaint(float id, vec3 q, vec3 n){
  if (id > ${KRAKEN_ID - 0.5}) {
    if (gBeastPart > 1.5) {
      // a great amber eye with a slit pupil
      vec3 e = vec3(abs(q.x), q.y, q.z) - krakenMantle() - krakenEye();
      vec3 out_ = normalize(krakenEye()*vec3(1.0, 0.0, 1.0));
      float across = dot(e, normalize(cross(out_, vec3(0.0, 1.0, 0.0))));
      return vec4(abs(across) < 0.1 && dot(e, out_) > 0.3 ? vec3(0.03, 0.02, 0.02) : vec3(1.0, 0.7, 0.16), 1.0);
    }
    float mottle = smoothstep(0.2, 0.6, (0.5 + 0.5*sin(q.x*2.1 + sin(q.y*1.7)))*(0.5 + 0.5*sin(q.y*1.9 + q.z*1.3)));
    vec3 c = mix(vec3(0.56, 0.16, 0.11), vec3(0.30, 0.06, 0.07), mottle);
    c = mix(c, vec3(0.70, 0.36, 0.24), 0.5*smoothstep(0.72, 0.8, noise(q.xy*3.1 + q.z*1.7)));
    if (gBeastPart > 0.5 && n.y < -0.25) {
      // the underside of the arms: pale, with rows of suckers
      c = fract(length(q)*2.2) < 0.28 ? vec3(0.66, 0.36, 0.32) : vec3(0.90, 0.68, 0.60);
    }
    return vec4(c, 0.0);
  }
  int kind = int(id - ${BEAST_ID - 0.5});
  if (kind == 0) {
    // grey above, a pale cape sweeping back along the flank, white beneath
    float cape = -0.06 - 0.08*q.z + 0.05*sin(q.z*4.0);
    return vec4(q.y < cape ? vec3(0.88, 0.88, 0.86) : mix(vec3(0.36, 0.44, 0.52), vec3(0.24, 0.30, 0.38), smoothstep(0.0, 0.25, q.y)), 0.0);
  }
  if (kind == 1) {
    if (abs(q.x) > 1.6 || q.y < -0.75) return vec4(0.80, 0.82, 0.82, 0.0);
    return vec4(bHash(floor(q*2.0)) > 0.93 ? vec3(0.62, 0.62, 0.58) : vec3(0.13, 0.15, 0.19), 0.0);
  }
  if (kind == 2) {
    if (q.z > 0.3) return vec4(0.98, 0.78, 0.15, 0.0);
    if (abs(q.x) > 0.62) return vec4(0.08, 0.08, 0.09, 0.0);
    return vec4(abs(q.x) > 0.1 && n.y > -0.1 ? vec3(0.64, 0.68, 0.72) : vec3(0.97, 0.97, 0.95), 0.0);
  }
  if (kind == 3) {
    if (q.y > 0.05 && abs(q.x) < 0.4 && q.z < 0.5) {
      vec2 g = q.xz*5.0;
      float edge = min(abs(fract(g.x) - 0.5), abs(fract(g.y + 0.5*floor(g.x)) - 0.5));
      return vec4(edge < 0.08 ? vec3(0.22, 0.17, 0.08) : vec3(0.46, 0.36, 0.16), 0.0);
    }
    return vec4(0.52, 0.50, 0.36, 0.0);
  }
  if (kind == 4) {
    if (abs(q.x) > 0.06) return vec4(0.58, 0.70, 0.84, 0.0);
    return vec4(q.y > 0.0 ? vec3(0.12, 0.28, 0.60) : vec3(0.86, 0.89, 0.92), 0.0);
  }
  return vec4(0.96, 0.97, 1.0, 2.0);
}
// how much of the body is wet: the waterline band, and the sheen of a creature just out of the sea
float beastWet(float id, vec3 p){
  if (id > ${BEAST_ID + 4.5} && id < ${KRAKEN_ID - 0.5}) return 0.0;
  if (id > ${BEAST_ID + 1.5} && id < ${BEAST_ID + 2.5}) return 0.0;
  return 1.0 - smoothstep(0.0, 0.5, p.y);
}
float beastFoamLine(float id, vec3 p){
  if (id > ${BEAST_ID + 1.5} && id < ${BEAST_ID + 2.5}) return 0.0;
  if (id > ${BEAST_ID + 4.5} && id < ${KRAKEN_ID - 0.5}) return 0.0;
  float line = p.y - 0.07*sin(p.x*3.1 + uT*2.3)*sin(p.z*2.7 - uT*1.9);
  return (1.0 - smoothstep(0.0, 0.16, abs(line - 0.03)))*smoothstep(0.35, 0.65, noise(p.xz*5.0 + uT));
}

vec3 shade_beast(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k){
  vec4 paint = beastPaint(id, q, n);
  bool kraken_ = id > ${KRAKEN_ID - 0.5};
  bool eye = paint.w > 0.5 && paint.w < 1.5, mist = paint.w > 1.5;
  float wet = beastWet(id, p), foam = beastFoamLine(id, p);
  float df = dot(n, uSun), ndv = abs(dot(n, rd));
  if (uMode == 0) {
    // the Riviera: linear light, the low sun with the land's shadow, the sky, the sea below
    vec3 alb = paint.rgb*paint.rgb, sc = p_sun(), ac = p_amb();
    float sh = t < 900.0 ? sunOverSea(vec3(p.x, max(p.y, 0.0) + 0.05, p.z)) : 1.0;
    vec3 amb = ac*(0.55 + 0.45*n.y);
    vec3 bounce = P_DEEP*0.5*(ac + sc*0.4*sh)*(0.5 - 0.5*n.y);
    vec3 c;
    if (mist) {
      // spray and blow: lit through, bright on the side to the sun
      c = alb*(sc*sh*(0.45 + 0.55*max(df, 0.0)) + ac*1.3);
    } else if (eye) {
      c = alb*(sc*0.6 + ac*1.6) + P_LAMP*0.25;
    } else {
      // skin is a little translucent: the sun wraps round it
      float wrap = clamp((df + 0.3)/1.3, 0.0, 1.0);
      c = alb*(sc*sh*wrap + amb + bounce);
      // wet skin and its sheen: a sharp highlight, the sky in the flanks
      vec3 r = reflect(rd, n);
      float gloss = mix(0.25, 1.0, wet)*(kraken_ ? 0.6 : 0.8);
      c += sc*sh*gloss*0.7*pow(max(dot(r, uSun), 0.0), mix(18.0, 70.0, wet));
      float fres = 0.03 + 0.55*pow(max(1.0 - ndv, 0.0), 5.0);
      c = mix(c, r.y > 0.0 ? p_air(r) : P_DEEP*0.4*(ac + sc*0.4), gloss*fres);
      c *= mix(1.0, 0.72, wet*smoothstep(0.3, 0.0, p.y));
    }
    c = mix(c, P_CREAM*(ac + sc*sh*0.5)*0.9, foam);
    return p_fog(c, rd, t);
  }
  if (uMode == 1) {
    // the terminal: a wireframe of rings round the body, edges bright, the kraken in amber
    float w = max(1.0, 1.25*k);
    float edge = termEdge(id, t, n, rd);
    float lit = clamp(0.5 + 0.5*df, 0.0, 1.0), shade = 0.35 + 0.9*lit;
    float sc_ = kraken_ ? 2.0 : id > ${BEAST_ID + 0.5} && id < ${BEAST_ID + 1.5} ? 3.0 : 12.0;
    float l = max(termLine(q.z*sc_*0.5, w), 0.7*termLine(q.y*sc_, w));
    if (mist) return termBeam(0.04 + 0.5*l*lit + 0.6*edge, 0.0, 0.25*lit);
    if (eye) return termBeam(0.0, 0.9, 0.6);
    float g = 0.03 + 0.10*lit*lit + l*shade + edge;
    float fog = exp(-t*0.0009);
    vec3 c = kraken_ ? termBeam(0.0, g, 0.0) : termBeam(g, 0.0, 0.0);
    c = mix(c, termBeam(0.6, 0.0, 0.3), foam*0.8);
    return T_BG + (c - T_BG)*fog;
  }
  if (uMode == 2) {
    // Secession gold: a dolphin of bronze, a whale of onyx and gold, an ivory gull, the kraken
    // in red enamel with gold suckers and pale gold eyes
    vec4 m;
    float rough = 0.3;
    int kind = int(id - ${BEAST_ID - 0.5});
    if (kraken_) {
      m = eye ? G_PALE : (gBeastPart > 0.5 && n.y < -0.25) ? G_GOLD : G_RED;
      rough = eye ? 0.1 : 0.22;
    } else if (mist) { m = G_IVORY; rough = 0.6; }
    else if (kind == 0) { m = q.y < -0.08 - 0.08*q.z ? G_PALE : G_BRONZE; rough = 0.25; }
    else if (kind == 1) { m = abs(q.x) > 1.6 || q.y < -0.75 ? G_GOLD : G_ONYX; rough = 0.15; }
    else if (kind == 2) { m = abs(q.x) > 0.62 ? G_DARK : G_IVORY; }
    else if (kind == 3) { m = q.y > 0.05 ? G_PATINA : G_BRONZE; }
    else { m = abs(q.x) > 0.06 ? G_LAPIS : G_PALE; rough = 0.2; }
    vec3 c = gdLit(m, rough, n, rd, 1.0);
    c = mix(c, gdLit(G_IVORY, 0.5, n, rd, 1.0), foam*0.8);
    return gdHaze(c, rd, t);
  }
  // the engraved chart: lines round the body and along it, deeper in the shade, an outline;
  // the kraken in red ink with a red wash
  vec3 qx = dFdx(q), qy = dFdy(q);
  float sp = 5.0*k;
  float tone = clamp(0.30 + 0.75*max(df, 0.0) - 0.25*max(-df, 0.0) + 0.25*n.y, 0.0, 1.0);
  float D = 1.0 - tone;
  float ring = kraken_ ? 2.0 : id > ${BEAST_ID + 0.5} && id < ${BEAST_ID + 1.5} ? 2.5 : 10.0;
  float ink = burin(q.z*ring, perPx(vec3(0.0, 0.0, ring), qx, qy), sp*0.8, k*(0.4 + 1.4*D));
  ink = max(ink, burin(q.y*ring*1.6 + q.z*ring*0.4, perPx(vec3(0.0, ring*1.6, ring*0.4), qx, qy), sp, k*1.4*smoothstep(0.45, 0.95, D)));
  ink = max(ink, max(contour(t, ndv, fc), rim(ndv, k)));
  vec3 wash = mix(vec3(1.0), paint.rgb*0.5 + 0.5, 0.6);
  vec3 tint = C_INK;
  if (kraken_) { wash = vec3(0.96, 0.62, 0.52); tint = C_RED; }
  if (eye) { wash = vec3(1.0, 0.82, 0.45); ink = rim(ndv, k); }
  if (mist) { wash = vec3(1.0); ink = rim(ndv, k)*0.6; }
  ink = mix(ink, 0.0, foam);
  return plate(wash, ink, tint, t);
}
`;
