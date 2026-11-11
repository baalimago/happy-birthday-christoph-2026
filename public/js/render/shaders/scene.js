// The scene every view shares, as GLSL: the sea, the land read from the height texture (with its
// woods, the volcano and the sea cave carved into it), the lighthouses and cave lights on the
// ports, the smoke plume and the boat, plus the marks they carry in every view.
//
// Everything is in world coordinates (x east, y up, z north) except the boat, which is a distance
// field in its own frame: it sits at the origin facing +z. W() and L() go between the two.

/** Ports the shader has room for. */
export const PORTS = 8;
/** Wave trains beyond the first three (whose phases are uWave): see TRAINS in renderer.js. */
export const RUNS = 7;
/** Puffs of smoke in the volcano's plume. */
const PUFFS = 10;

export const SCENE = /* glsl */ `
uniform vec2 uRes, uShift, uPos, uHead;
uniform vec3 uSun;                       // world
uniform float uT, uYaw, uPitch, uDist, uEnd, uSpeed, uLean, uBoom;
uniform int uMode;
uniform sampler2D uLand;                 // r: height above the sea, g: forest 0..1
uniform sampler2D uTop;                  // highest ground in a 25 unit cell (r), a 100 unit cell (g)
uniform float uExtent, uMaxLand, uCell;   // uCell: side of a cell of uTop
uniform vec4 uPort[${PORTS}];            // x, z, base, kind (0 lighthouse, 1 cave, -1 none)
uniform float uFound[${PORTS}];
uniform vec4 uCave;                      // tunnel from a (xy) to the chamber b (zw), world x, z
uniform vec4 uCaveShape;                 // tunnel radius, chamber radius, roof, where the cliff starts
uniform vec3 uCaveLamp;                  // the light at the back of the chamber
uniform vec3 uBrazier[2];                // either side of the mouth: x, top of the post, z
uniform vec4 uVolcano;                   // x, z, height of the rim, radius of the crater
uniform float uVolcanoR;
uniform vec4 uWind;                      // xy: the way the wind blows; zw: the second wave train
uniform float uWindSpeed;
uniform vec3 uWave;                      // phases of the wave trains under the boat
uniform vec2 uPennant;                   // the way the pennant streams, in the boat's frame
uniform float uRocket;                   // 1 while the rocket on the stern burns, else 0
uniform float uSea, uGust;               // sea state 0 calm .. 1 a steep running sea; the gust on the boat 0..1
uniform float uPhase[${RUNS}];           // phases under the boat of the swell (0), two more wind waves
uniform vec2 uRun[${RUNS}];              //   (1, 2) and the four trains of ripples (3..6), and the way each runs
uniform vec2 uLee;                       // where the boat is in the wind's own drifting frame (see leeAt)

vec3 gRide = vec3(0.0);          // the boat on the waves: x heave, y pitch (set by rideWaves)
float gHit = 0.0;                // what this pixel shows (an id, 0 for sky), for the post passes
float gT = 0.0;                  // how far off it is (FAR for sky)
vec3 gRo = vec3(0.0);            // where the camera is, world

const float FAR = 1800.0;       // nothing is drawn beyond this but the flat sea
const float CUTAWAY = 45.0;     // a camera inside rock sees out through this much of it
const float LIGHT_TOP = 8.6;    // lighthouse gallery above its base; the lamp room sits on it

float hash(vec2 p){
  ivec2 i = ivec2(floor(p));
  uint h = uint(i.x)*0x27d4eb2du + uint(i.y)*0x165667b1u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return float(h >> 8)*(1.0/16777216.0);
}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

// boat frame to world (x, z), and a world (x, z) direction back into the boat frame
vec2 W(vec3 p){ return uPos + p.x*vec2(uHead.y, -uHead.x) + p.z*uHead; }
vec2 L(vec2 d){ return vec2(dot(d, vec2(uHead.y, -uHead.x)), dot(d, uHead)); }
vec3 toWorld(vec3 d){ vec2 w = d.x*vec2(uHead.y, -uHead.x) + d.z*uHead; return vec3(w.x, d.y, w.y); }
vec3 toBoat(vec3 d){ vec2 l = L(d.xz); return vec3(l.x, d.y, l.y); }

// ---- the sea: a long swell that keeps its own heading, wind waves that run with the wind and
// either side of it, a short cross chop. Their phases are kept under the boat (uWave, uPhase), so
// the water stays put as she moves and turns with the wind when it veers.
float crest(float x){ float v = sin(x); return v + 0.3*v*v - 0.15; }   // a wave with a sharper top
float sea(vec2 w){
  vec2 d = w - uPos;
  float high = 0.3 + 1.5*uSea;
  float h = 0.10*crest(dot(d, uWind.xy)*0.85 + uWave.x)
          * (0.7 + 0.3*sin(dot(d, vec2(-uWind.y, uWind.x))*0.3 + uWave.z));
  h += 0.045*sin(dot(d, uWind.zw)*1.9 + uWave.y);
  h += 0.05*crest(dot(d, uRun[1])*1.31 + uPhase[1]);
  h += 0.02*sin(dot(d, uRun[2])*3.4 + uPhase[2]);
  return h*high + (0.07 + 0.08*uSea)*sin(dot(d, uRun[0])*0.21 + uPhase[0]) + 0.03*noise(w*2.5 + uT*0.5);
}
// A point in the wind's own frame, which drifts downwind with the weather: x down the wind,
// y across it. For patterns that lie along the wind (gusts, streaks of foam).
vec2 leeAt(vec2 w){
  vec2 d = w - uPos;
  return vec2(dot(d, uWind.xy), dot(d, vec2(-uWind.y, uWind.x))) + uLee;
}
// Gusts: cat's paws that drift over the water, and the one the game says is on the boat. 0..1
float gustAt(vec2 w){
  vec2 u = leeAt(w)*vec2(0.008, 0.017);
  float g = smoothstep(0.50, 0.74, 0.7*noise(u) + 0.3*noise(u*2.9 + 5.0))*clamp(uWindSpeed*0.8, 0.0, 1.0);
  vec2 d = w - uPos;
  return max(g, uGust*exp(-dot(d, d)/8000.0));
}
// Breaking crests and streaks of foam down the wind, 0..1: none in a calm, many in a squall.
// h is sea(w).
float seaFoam(vec2 w, float h){
  float wild = uSea*1.1 + 0.45*(uWindSpeed - 1.0) + 0.3*gustAt(w);
  if (wild < 0.35) return 0.0;
  vec2 u = leeAt(w);
  float n = 0.6*noise(u*1.9) + 0.4*noise(u*5.3 + 2.0), fine = noise(u*13.0);
  float top = smoothstep(0.25, 0.9, h/(0.2*(0.3 + 1.5*uSea)));
  float cap = top*smoothstep(1.75 - 0.75*wild, 1.95 - 0.75*wild, n + 0.75*top);
  float streak = smoothstep(1.0 - 0.3*wild, 1.2 - 0.3*wild, noise(u*vec2(0.3, 3.1)) + 0.45*n)*0.45;
  return clamp(max(cap, streak*smoothstep(0.6, 1.1, wild))*(0.35 + 1.1*fine), 0.0, 1.0);
}
// The boat rides the waves: call once before anything looks at her.
void rideWaves(){
  float calm = clamp(2.0 - uSpeed/9.0, 0.12, 1.0);    // at speed she skims the swell
  float bow = sea(uPos + uHead*0.9), stern = sea(uPos - uHead*0.9);
  gRide = vec3(0.35*(bow + stern)*calm, 0.55*atan(bow - stern, 1.8)*calm, 0.0);
}
vec3 seaN(vec2 w, float e){
  return normalize(vec3(sea(w - vec2(e,0)) - sea(w + vec2(e,0)), 2.0*e,
                        sea(w - vec2(0,e)) - sea(w + vec2(0,e))));
}

// ---- the land
vec2 landAt(vec2 w){ return textureLod(uLand, w/uExtent + 0.5, 0.0).rg; }

// one fir on a jittered grid: how high its cone stands over the ground at w
float fir(vec2 w, float cell, float f){
  vec2 g = w/cell, c = floor(g);
  float r1 = hash(c), r2 = hash(c + 71.0);
  vec2 o = (g - c - 0.5 - (vec2(r1, r2) - 0.5)*0.3)*cell;
  float thin = 0.18 + 0.5*fract(r1*7.31);            // thin woods have gaps
  float rad = (0.95 + 0.25*r2)*cell/3.4;
  float tall = 2.6 + 1.5*fract(r2*5.7);
  return smoothstep(thin, thin + 0.15, f)*tall*max(0.0, 1.0 - length(o)/rad);
}
// the wood over the ground: firs close by, an even canopy far off (lod 0 near .. 1 far)
float wood(vec2 w, float f, float lod){
  float canopy = 1.7*smoothstep(0.25, 0.6, f);
  if (lod >= 1.0) return canopy;
  float firs = max(fir(w, 3.4, f), fir(mat2(0.8, -0.6, 0.6, 0.8)*w + 9.7, 4.3, f));
  return mix(firs, canopy, lod);
}
float lodAt(float t){ return smoothstep(220.0, 330.0, t); }
// height of the land with its relief and its woods. The shore stays where the grid has it:
// nothing is added to ground lower than one unit.
float landH(vec2 w, float lod){
  vec2 s = landAt(w);
  float h = s.r;
  if (h > 1.0) {
    float rough = (noise(w*0.19) - 0.5)*2.0;
    if (lod < 1.0) rough += (noise(w*0.6) - 0.5)*0.6*(1.0 - lod);
    h += smoothstep(1.0, 6.0, h)*rough;
    if (s.g > 0.1) h += wood(w, s.g, lod);
    vec2 v = w - uVolcano.xy;
    if (dot(v, v) < uVolcano.w*uVolcano.w) h = max(h, uVolcano.z - 5.0);   // the lava lake
  }
  return h;
}
vec3 landN(vec2 w, float e, float lod){
  return normalize(vec3(landH(w - vec2(e,0), lod) - landH(w + vec2(e,0), lod), 2.0*e,
                        landH(w - vec2(0,e), lod) - landH(w + vec2(0,e), lod)));
}

// ---- the sea cave: negative inside the tunnel and the chamber (a lower bound on the distance)
float caveD(vec3 p){
  vec2 a = uCave.xy, b = uCave.zw, e = b - a;
  vec2 m = p.xz - 0.5*(a + b);
  float reach = 0.5*length(e) + uCaveShape.y + 4.0;
  if (dot(m, m) > reach*reach) return length(m) - reach + 4.0;
  vec2 v = p.xz - a;
  float s = clamp(dot(v, e)/dot(e, e), 0.0, 1.0), y = max(p.y, 0.0);
  float vault = min(uCaveShape.z, uCaveShape.x);
  float tunnel = (length(vec2(length(v - e*s)/uCaveShape.x, y/vault)) - 1.0)*vault;
  float hall = (length(vec2(length(p.xz - b)/uCaveShape.y, y/uCaveShape.z)) - 1.0)
             * min(uCaveShape.y, uCaveShape.z);
  return min(tunnel, hall);
}
vec3 caveN(vec3 p){
  vec2 e = vec2(0.05, -0.05);
  return -normalize(e.xyy*caveD(p + e.xyy) + e.yyx*caveD(p + e.yyx) +
                    e.yxy*caveD(p + e.yxy) + e.xxx*caveD(p + e.xxx));
}
// x: daylight from the mouth, y: the warm glow of the lamp in the chamber, both 0..1
vec2 caveLight(vec3 p, vec3 n){
  vec2 e = normalize(uCave.zw - uCave.xy);
  float into = dot(p.xz - uCave.xy, e) - uCaveShape.w;
  vec3 l = uCaveLamp - p;
  float glow = (0.35 + 0.65*clamp(dot(n, normalize(l)), 0.0, 1.0))/(1.0 + dot(l, l)/110.0);
  return vec2(exp(-max(into, 0.0)/16.0), glow);
}
// free space is positive (a safe step), solid rock negative (a safe step back out)
float field(vec3 p, float lod){
  float dh = (p.y - landH(p.xz, lod))*mix(0.32, 0.42, lod);   // firs are steep, far hills are not
  if (dh > 0.0 && p.y > uCaveShape.z) return dh;
  float c = caveD(p);
  if (dh > 0.0) return max(dh, -c);
  return c < 0.0 ? -c : -min(-dh, c);
}

// March the land. Returns the distance of the hit, or -1. kind: 2 ground, 8 the cave's wall.
// A ray that starts inside rock (the camera behind a cliff, or in the cave's wall) runs on to
// the first free space and is marched from there: a cutaway.
float marchLand(vec3 o, vec3 d, float tMax, out float kind){
  kind = 2.0;
  float t = 0.0, prev = 0.0;
  if (o.y > uMaxLand) {
    if (d.y >= 0.0) return -1.0;
    t = (uMaxLand - o.y)/d.y;
  }
  bool inside = t == 0.0 && field(o, 0.0) < 0.0;
  vec2 dx = d.xz + step(abs(d.xz), vec2(1e-6))*2e-6;
  for (int i = 0; i < STEPS; i++) {
    if (t > tMax) break;
    vec3 p = o + d*t;
    if (!inside) {
      if (d.y > 0.0 && p.y > uMaxLand) return -1.0;
      vec2 top = textureLod(uTop, p.xz/uExtent + 0.5, 0.0).rg;
      float cell = p.y > top.g ? 4.0*uCell : p.y > top.r ? uCell : 0.0;
      if (cell > 0.0) {
        // nothing in this cell reaches the ray: on to where it leaves, or dips under the top
        vec2 w = p.xz + 0.5*uExtent;
        vec2 edge = (floor(w/cell) + step(0.0, dx))*cell;
        vec2 tt = (edge - w)/dx;
        float dt = min(tt.x, tt.y);
        if (d.y < 0.0) dt = min(dt, ((cell > uCell ? top.g : top.r) - p.y)/d.y);
        prev = t;
        t += dt + 0.02;
        continue;
      }
    }
    float f = field(p, lodAt(t));
    if (inside) {
      if (f < 0.0) {
        if (t > CUTAWAY) break;
        t += max(-f, 0.25 + 0.06*t);
        continue;
      }
      inside = false;
    } else if (f < 0.0) {
      float a = prev, b = t;
      for (int j = 0; j < 7; j++) {
        float m = 0.5*(a + b);
        if (field(o + d*m, lodAt(m)) < 0.0) b = m; else a = m;
      }
      p = o + d*b;
      if (p.y < landH(p.xz, lodAt(b)) - 0.4 && caveD(p) < 0.4) kind = 8.0;
      return b;
    }
    prev = t;
    t += max(f, 0.03 + 0.006*t);
  }
  if (inside) { kind = 8.0; return 0.02; }   // the camera is in rock and looks deeper into it
  return -1.0;
}

// ---- lighthouses and the lights of the cave
float lightD(vec3 p, vec4 port){
  float r = length(p.xz - port.xy), y = p.y - port.z;
  float body = max(max(r - (0.82 + 0.055*clamp(LIGHT_TOP - y, 0.0, 12.0)), y - LIGHT_TOP), -y - 2.5);
  float gallery = max(r - 1.35, abs(y - LIGHT_TOP + 0.15) - 0.17);
  float lamp = length(vec2(r, y - LIGHT_TOP - 0.7)) - 0.95;
  float cap = max(r - (LIGHT_TOP + 2.15 - y)*0.9, LIGHT_TOP + 1.25 - y);
  return min(min(body, gallery), min(lamp, cap));
}
float flameSize(int port){ return 0.55 + 0.25*uFound[port]; }
// the two braziers by the mouth and the lamp in the chamber; y: 1 on a flame
vec2 caveLights(vec3 p, int port){
  float post = 1e9, flame = length(p - uCaveLamp) - 0.8;
  for (int i = 0; i < 2; i++) {
    vec3 b = uBrazier[i];
    float r = length(p.xz - b.xz);
    post = min(post, max(max(r - 0.3 - 0.35*smoothstep(-0.7, 0.0, p.y - b.y), p.y - b.y), -p.y - 2.0));
    flame = min(flame, length(p - b - vec3(0.0, 0.45, 0.0)) - flameSize(port));
  }
  return flame < post ? vec2(flame, 1.0) : vec2(post, 0.0);
}
float propD(int port, vec3 p){
  return uPort[port].w > 0.5 ? caveLights(p, port).x : lightD(p, uPort[port]);
}
vec3 propN(float id, vec3 p){
  int port = int(id - 9.5);
  vec2 e = vec2(0.01, -0.01);
  return normalize(e.xyy*propD(port, p + e.xyy) + e.yyx*propD(port, p + e.yyx) +
                   e.yxy*propD(port, p + e.yxy) + e.xxx*propD(port, p + e.xxx));
}
// trace one port's fittings inside a bounding sphere; keeps the nearest hit in best and id
void prop(int port, vec3 c, float r, vec3 o, vec3 d, inout float best, inout float id){
  vec3 oc = o - c;
  float b = dot(oc, d), disc = b*b - dot(oc, oc) + r*r;
  if (disc < 0.0) return;
  float s = sqrt(disc), t = max(-b - s, 0.0), end = min(-b + s, best);
  for (int j = 0; j < 32; j++) {
    if (t > end) return;
    float dd = propD(port, o + d*t);
    if (dd < 0.0007*t + 0.002) { best = t; id = 10.0 + float(port); return; }
    t += dd;
  }
}
void props(vec3 o, vec3 d, inout float best, inout float id){
  for (int i = 0; i < ${PORTS}; i++) {
    vec4 port = uPort[i];
    if (port.w < -0.5) continue;
    if (port.w < 0.5) prop(i, vec3(port.x, port.z + 4.2, port.y), 7.0, o, d, best, id);
    else {
      prop(i, uCaveLamp, 1.0, o, d, best, id);
      prop(i, uBrazier[0] - vec3(0.0, 1.2, 0.0), 2.8, o, d, best, id);
      prop(i, uBrazier[1] - vec3(0.0, 1.2, 0.0), 2.8, o, d, best, id);
    }
  }
}
// lighthouse or cave light: x = stripe (0 or 1), y = lamp lit (0 or 1), z = found,
// w = in the lamp room (or on a flame)
vec4 lightMarks(float id, vec3 p){
  int port = int(id - 9.5);
  float found = uFound[port];
  if (uPort[port].w > 0.5) {
    float flicker = step(0.3, noise(vec2(uT*7.0, float(port)*3.0 + floor(p.x*0.2))));
    return vec4(0.0, max(flicker, found), found, caveLights(p, port).y);
  }
  float y = p.y - uPort[port].z;
  float blink = step(fract(uT*0.9 + float(port)*0.37), 0.6);
  return vec4(step(mod(floor(y/1.72), 2.0), 0.5), max(blink, found), found,
              step(LIGHT_TOP + 0.05, y)*step(y, LIGHT_TOP + 1.6));
}
// A lit lamp shows as a dot however far off it is. One lamp: its centre c and its size r.
void lamp(int port, vec3 c, float r, vec3 o, vec3 d, inout float best, inout float id, inout vec3 at){
  vec3 v = c - o;
  float t = dot(v, d);
  if (t < 0.0 || t > best) return;
  if (length(v - d*t) < max(r, 0.0019*t)) { best = t; id = 10.0 + float(port); at = c; }
}
void lamps(vec3 o, vec3 d, inout float best, inout float id, inout vec3 at){
  for (int i = 0; i < ${PORTS}; i++) {
    vec4 port = uPort[i];
    if (port.w < -0.5) continue;
    vec3 c = port.w > 0.5 ? uCaveLamp : vec3(port.x, port.z + LIGHT_TOP + 0.7, port.y);
    if (lightMarks(10.0 + float(i), c).y < 0.5) continue;
    if (port.w < 0.5) lamp(i, c, 0.9, o, d, best, id, at);
    else {
      lamp(i, c, 0.75, o, d, best, id, at);
      lamp(i, uBrazier[0] + vec3(0.0, 0.45, 0.0), 0.5, o, d, best, id, at);
      lamp(i, uBrazier[1] + vec3(0.0, 0.45, 0.0), 0.5, o, d, best, id, at);
    }
  }
}

// ---- the volcano's plume: puffs that rise from the crater, swell and drift off downwind.
// Returns the distance to the nearest puff or -1; n its normal, age 0 (new) .. 1.
float plume(vec3 o, vec3 d, float tMax, out vec3 n, out float age){
  float best = -1.0;
  n = vec3(0.0, 1.0, 0.0); age = 0.0;
  for (int i = 0; i < ${PUFFS}; i++) {
    float fi = float(i);
    float s = fract((fi + uT*0.05)/${PUFFS}.0);
    vec3 c = vec3(uVolcano.x, uVolcano.z + 100.0*pow(s, 0.85), uVolcano.y);
    c.xz += uWind.xy*(14.0*s + 190.0*s*s*uWindSpeed) + 7.0*s*vec2(sin(fi*2.4), cos(fi*1.7));
    float r = (8.0 + 27.0*s)*smoothstep(0.0, 0.05, s)*smoothstep(1.0, 0.82, s);
    vec3 oc = o - c;
    float b = dot(oc, d), disc = b*b - dot(oc, oc) + r*r;
    if (disc < 0.0) continue;
    float t = -b - sqrt(disc);
    if (t < 0.0 || t > tMax || (best > 0.0 && t > best)) continue;
    best = t; n = (oc + d*t)/r; age = s;
  }
  return best;
}

// ---- the boat
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2){
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
// the boat's own coordinates: it bobs, heels and pitches on the swell
vec3 boatLocal(vec3 p){
  vec3 q = p - vec3(0.0, gRide.x + 0.03 + 0.05*uRocket, 0.0);
  float a = 0.07*sin(uT*1.3) - uLean, c = cos(a), s = sin(a);   // uLean > 0 heels to starboard
  q.xy = mat2(c, -s, s, c)*q.xy;
  a = 0.03*sin(uT*0.9 + 1.0) - gRide.y - 0.07*uRocket; c = cos(a); s = sin(a);   // the rocket lifts her bow
  q.yz = mat2(c, -s, s, c)*q.yz;
  return q;
}
// the mainsail's own coordinates: it swings about the mast with the boom
vec3 sailLocal(vec3 q){
  float c = cos(uBoom), s = sin(uBoom);
  vec2 m = vec2(q.x, q.z - 0.12);
  return vec3(m.x*c + m.y*s, q.y, m.y*c - m.x*s + 0.12);
}
// The rocket strapped over the stern (while uRocket is 1), in the boat's own coordinates q: it
// lies along the keel, nose forward, on a bracket behind the transom, and its flame streams astern.
const vec3 ROCKET = vec3(0.0, 0.46, -1.55);      // the middle of its body
// x: distance to the body, the fins and the bracket; y: distance to the flame
vec2 rocketD(vec3 q){
  vec3 r = q - ROCKET;
  float rad = length(r.xy);
  float body = max(rad - 0.13, abs(r.z) - 0.42);
  // the nose: a cone from the body's front to a tip
  float nose = max(rad - 0.13*clamp((0.80 - r.z)/0.38, 0.0, 1.0), max(r.z - 0.80, 0.42 - r.z))*0.9;
  float nozzle = max(rad - 0.075 - 0.25*max(-r.z - 0.42, 0.0), abs(r.z + 0.47) - 0.06);
  // four fins at the tail, swept back
  vec2 f = abs(r.xy);
  f = f.x > f.y ? f : f.yx;
  float fin = max(max(f.y - 0.014, f.x - 0.13 - clamp((-0.12 - r.z)*0.75, 0.0, 0.17)), abs(r.z + 0.27) - 0.15);
  float strut = max(max(abs(r.x) - 0.035, abs(r.z + 0.02) - 0.22), max(r.y + 0.05, -r.y - 0.26 - 0.3*(r.z + 0.02)));
  // the flame: a tongue that swells out of the nozzle and flickers to a point
  float len = 1.05 + 0.2*sin(uT*31.0) + 0.12*sin(uT*47.0 + 1.7);
  float s = (-r.z - 0.50)/len;
  float wide = 0.19*sqrt(clamp(s*5.0, 0.0, 1.0))*(1.0 - clamp(s, 0.0, 1.0))
             * (1.0 + 0.22*sin(s*23.0 - uT*40.0)) + 0.03*step(0.0, s)*step(s, 1.0);
  vec2 sway = 0.06*s*vec2(sin(uT*23.0 + s*9.0), cos(uT*19.0 + s*7.0));
  float flame = max(length(r.xy - sway) - wide, max(-s, s - 1.0)*len)*0.6;
  return vec2(min(min(body, nose), min(min(nozzle, fin), strut)), flame);
}
// What a point of the boat (hit id, q in her own coordinates) is of the rocket.
// x: 0 not the rocket, 1 its body, 2 its flame; y: the paint of the body (0 white, 1 red,
// 2 dark metal); z: how far down the flame, 0 at the nozzle .. 1 at the tip.
vec3 rocketMark(float id, vec3 q){
  if (uRocket < 0.5 || q.z > -0.7 || q.y > 1.0) return vec3(0.0);
  vec3 r = q - ROCKET;
  if (id > 6.5) return vec3(2.0, 0.0, clamp((-r.z - 0.50)/1.1, 0.0, 1.0));
  if (id > 3.5 || q.y < 0.19 - 0.3*(r.z + 0.02) || (q.y < 0.285 && q.z > -1.3)) return vec3(0.0);
  float rad = length(r.xy);
  float paint = r.z > 0.42 || rad > 0.145 || abs(r.z + 0.05) < 0.07 ? 1.0 : 0.0;
  if (r.z < -0.415 || (rad < 0.14 && abs(abs(r.z - 0.08) - 0.25) < 0.02 && r.y < -0.02)) paint = 2.0;
  if (abs(r.x) < 0.04 && r.y < -0.135) paint = 2.0;
  return vec3(1.0, paint, 0.0);
}

// ids: 3 hull (and the rocket), 4 mainsail, 5 mast and boom, 6 jib, 7 pennant (and the rocket's
// flame); rocketMark tells the rocket from the boat
vec2 boat(vec3 p){
  vec3 q = boatLocal(p);
  vec3 r = vec3(0.50, 0.44, 1.40), h = q - vec3(0.0, 0.12, 0.0);
  h.x *= 1.0 + 0.5*smoothstep(0.2, 1.4, q.z);
  float hull = max((length(h/r) - 1.0)*0.40, q.y - 0.27);
  vec3 m = q - vec3(0.0, 0.0, 0.15);
  float mast = length(m - vec3(0.0, clamp(m.y, 0.2, 2.75), 0.0)) - 0.035;
  // both sails belly to leeward, the side the boom lies on
  float lee = clamp(uBoom*5.0, -1.0, 1.0), belly = 0.11*lee*sin(clamp((q.y - 0.4)*1.45, 0.0, 3.14));
  vec3 qs = sailLocal(q);
  float s1 = max(sdTri(qs.zy, vec2(0.08,0.5), vec2(0.08,2.45), vec2(-1.2,0.5)),
                 abs(qs.x - belly*clamp(0.3 - qs.z, 0.0, 1.0)*1.6) - 0.02);
  float boom = length(vec3(qs.x, qs.y - 0.47, qs.z - clamp(qs.z, -1.25, 0.1))) - 0.03;
  mast = min(mast, boom);
  // the jib is hinged on the forestay and swings a share of the boom's angle
  float off = max(dot(q.zy - vec2(1.32, 0.42), vec2(-0.832, -0.555)), 0.0);
  float swing = clamp(uBoom, -1.2, 1.2)*0.7;
  float jx = (q.x - tan(swing)*off)*cos(swing) - belly*0.6;
  float s2 = max(sdTri(q.zy, vec2(0.24,0.42), vec2(0.2,2.1), vec2(1.32,0.42)), abs(jx) - 0.02);
  // the pennant streams downwind from the masthead
  float along = dot(m.xz, uPennant), across = dot(m.xz, vec2(uPennant.y, -uPennant.x));
  across -= 0.05*sin(along*9.0 - uT*6.0)*clamp(along, 0.0, 1.0)*3.0;
  float flag = max(sdTri(vec2(along, q.y), vec2(0.0,2.72), vec2(0.0,2.52), vec2(0.57,2.62)),
                   abs(across) - 0.015);
  vec2 res = vec2(hull, 3.0);
  if (mast < res.x) res = vec2(mast, 5.0);
  if (s1 < res.x) res = vec2(s1, 4.0);
  if (s2 < res.x) res = vec2(s2, 6.0);
  if (flag < res.x) res = vec2(flag, 7.0);
  if (uRocket > 0.5 && q.z < -0.5 && q.y < 1.2) {
    vec2 rk = rocketD(q);
    if (rk.x < res.x) res = vec2(rk.x, 3.0);
    if (rk.y < res.x) res = vec2(rk.y, 7.0);
  }
  return res;
}
vec3 boatN(vec3 p){
  vec2 e = vec2(0.003, -0.003);
  return normalize(e.xyy*boat(p + e.xyy).x + e.yyx*boat(p + e.yyx).x +
                   e.yxy*boat(p + e.yxy).x + e.xxx*boat(p + e.xxx).x);
}
// o and d in the boat's frame; returns the distance or -1, and the part hit
float marchBoat(vec3 o, vec3 d, float tMax, out float id){
  vec3 oc = o - vec3(0.0, 1.3, 0.0);
  float reach = 2.9 + 0.6*uRocket;             // the flame trails out astern
  float b = dot(oc, d), disc = b*b - dot(oc, oc) + reach*reach;
  if (disc < 0.0) return -1.0;
  float s = sqrt(disc), t = max(-b - s, 0.0), end = min(-b + s, tMax);
  for (int i = 0; i < 48; i++) {
    if (t > end) break;
    vec2 m = boat(o + d*t);
    if (m.x < 0.0012*t + 0.0008) { id = m.y; return t; }
    t += m.x*0.8;
  }
  return -1.0;
}

// ---- marks, shared by every view
// an antialiased line wherever v crosses an integer; fw = fwidth(v)
float lineAt(float v, float fw){
  float d = abs(fract(v - 0.5) - 0.5);
  return (1.0 - smoothstep(0.0, 1.5*fw, d)) * clamp(0.4/max(fw, 1e-4), 0.0, 1.0);
}
// how far a thing has sunk into the haze of distance, 0..1
float haze(float t){ return smoothstep(280.0, FAR, t); }
// what the sea carries: x = shoal (0 deep .. 1 awash), y = wake,
// z = height of the shore over the water (negative off it), w = 1 inside the cave
vec4 seaMarks(vec3 p, float t){
  vec4 m = vec4(0.0);
  float h = landAt(p.xz).r;
  float c = h > 0.5 ? caveD(vec3(p.x, 0.0, p.z)) : 1.0;
  if (c < 0.5) {
    // under the rock: the cave. Its walls are the shore.
    m.z = min(c, 0.0)*0.5; m.w = 1.0;
  } else {
    m.z = h - p.y;
    m.x = smoothstep(-2.4, -0.5, h);
  }
  vec2 b = L(p.xz - uPos);
  float way = min(uSpeed, 14.0);                // the arms are no longer for a rocket's speed
  if (uSpeed > 0.8 && b.y < -1.25 && b.y > -1.5 - way*0.9) {
    float arm = abs(abs(b.x) - (-b.y - 1.2)*0.32);
    if (arm < 0.05 + 0.012*(-b.y)) m.y = 1.0;
  }
  // under the rocket she leaves a rooster tail: a band of foam as long as she is fast
  if (uRocket > 0.5 && b.y < -1.3 && b.y > -3.0 - uSpeed*0.8 &&
      abs(b.x) < (0.3 + 0.035*(-b.y))*(0.75 + 0.5*noise(p.xz*0.9))) m.y = 1.0;
  return m;
}
// what the ground carries: x = wood (0 bare, else 0.5 at a tree's foot .. 1 at its top),
// y = lava (0 or 1), z = low ground (1 beach, 2 a rock awash, else 0),
// w = a coordinate that runs down the lava as it flows
vec4 landMarks(vec3 p, float t){
  vec4 m = vec4(0.0);
  vec2 s = landAt(p.xz);
  float lod = lodAt(t);
  if (s.r > 1.0 && s.g > 0.1) {
    float w = wood(p.xz, s.g, lod);
    if (w > mix(0.12, 0.7, lod)) m.x = 0.5 + 0.5*clamp(w/4.1, 0.0, 1.0);
  }
  if (s.r < 1.25) {
    // low ground with nothing higher behind it is a rock awash, not a beach
    float back = max(max(landAt(p.xz + vec2(14.0, 0.0)).r, landAt(p.xz - vec2(14.0, 0.0)).r),
                     max(landAt(p.xz + vec2(0.0, 14.0)).r, landAt(p.xz - vec2(0.0, 14.0)).r));
    m.z = back > 1.0 ? 1.0 : 2.0;
  }
  vec2 v = p.xz - uVolcano.xy;
  float r = length(v);
  if (r < uVolcanoR*0.62) {
    m.w = r*0.11 - uT*0.3 + 0.6*noise(p.xz*0.25);
    if (r < uVolcano.w*0.97 && p.y < uVolcano.z - 4.7) { m.y = 1.0; m.w = r*0.3 - uT*0.2; }
    float bearing = atan(v.x, v.y);
    for (int i = 0; i < 3; i++) {
      float a = 3.3 + 2.0*float(i);
      float da = bearing - a - 0.3*sin(r*0.07 + a*3.0);
      da = abs(da - 6.2832*floor(da/6.2832 + 0.5));
      float wide = 5.5 - 3.5*r/(uVolcanoR*0.62);
      if (r > uVolcano.w*0.9 && da*r < wide) m.y = 1.0;
    }
    if (m.y > 0.5) m.x = 0.0;
  }
  return m;
}
// ---- light and weather, for the views that want them (nothing above depends on these)

// The fine waves on top of the swell: the slope (dh/dx, dh/dz) of a few trains running with and
// across the wind, and a little chop. They flatten with distance t, so they never glitter falsely.
vec2 rippleSlope(vec2 w, float t){
  vec2 d = w - uPos, g = vec2(0.0);
  float warp = noise(w*0.33 + uT*0.07)*5.0, tt = t*t;
  g += uRun[3]*0.10*cos(dot(d, uRun[3])*2.7 + uPhase[3] + warp)/(1.0 + tt*0.0002);
  g += uRun[4]*0.11*cos(dot(d, uRun[4])*4.6 + uPhase[4] - warp*1.3)/(1.0 + tt*0.0006);
  g += uRun[5]*0.10*cos(dot(d, uRun[5])*7.9 + uPhase[5] + warp*2.1)/(1.0 + tt*0.002);
  g += uRun[6]*0.09*cos(dot(d, uRun[6])*13.1 + uPhase[6] - warp*2.6)/(1.0 + tt*0.006);
  // chop: the slope of a patch of noise that drifts downwind
  float fade = 1.0/(1.0 + tt*0.003);
  if (fade > 0.03) {
    vec2 u = leeAt(w)*4.3 - vec2(uT*1.2, 0.0);
    float n0 = noise(u);
    vec2 c = vec2(noise(u + vec2(0.4, 0.0)) - n0, noise(u + vec2(0.0, 0.4)) - n0);
    g += 0.30*fade*(c.x*uWind.xy + c.y*vec2(-uWind.y, uWind.x));
  }
  // glassy in a lull, ruffled in a gust
  return g*clamp(0.1 + 0.75*uWindSpeed + 0.4*uSea, 0.0, 1.3)*(0.75 + 0.6*gustAt(w));
}

// How much of the sun reaches p past the land: 0 in its shadow .. 1 in the open. A short march
// up the sunbeam over the height field (about 140 units), soft at the edges. lod as for landH.
float sunOverLand(vec3 p, float lod){
  float res = 1.0, s = 0.5;
  for (int i = 0; i < 13; i++) {
    vec3 at = p + uSun*s;
    if (at.y > uMaxLand) break;
    res = min(res, 9.0*(at.y - landH(at.xz, lod))/s + 0.12);
    if (res < 0.02) break;
    s = s*1.45 + 0.25;
  }
  return smoothstep(0.0, 1.0, res);
}
// The same for a point on the sea: only marched where there is land up-sun to cast a shadow.
float sunOverSea(vec3 p){
  vec2 to = normalize(uSun.xz + vec2(1e-5, 0.0));
  float top = max(textureLod(uTop, p.xz/uExtent + 0.5, 0.0).g,
              max(textureLod(uTop, (p.xz + to*60.0)/uExtent + 0.5, 0.0).g,
                  textureLod(uTop, (p.xz + to*125.0)/uExtent + 0.5, 0.0).g));
  if (top < 1.0) return 1.0;
  return sunOverLand(vec3(p.x, max(p.y, 0.0) + 0.05, p.z), 1.0);
}
// How much of the sun the boat leaves a point o (in the boat's frame): 0 in her shadow .. 1.
float sunPastBoat(vec3 o){
  vec3 d = toBoat(uSun);
  vec3 oc = o - vec3(0.0, 1.3, 0.0);
  float reach = 2.9 + 0.6*uRocket;
  float b = dot(oc, d), disc = b*b - dot(oc, oc) + reach*reach;
  if (disc < 0.0) return 1.0;
  float s = sqrt(disc), t = max(-b - s, 0.0), end = -b + s, res = 1.0;
  for (int i = 0; i < 26; i++) {
    if (t > end) break;
    float m = boat(o + d*t).x;
    if (m < 0.002) return 0.0;
    res = min(res, 16.0*m/max(t, 0.05));
    t += max(m*0.8, 0.02);
  }
  return clamp(res, 0.0, 1.0);
}

// The wake: x = foam (0..1) from the bow wave, the two arms astern and the churned water
// between them, y = how smooth the water lies in her track (0..1).
vec2 wakeFoam(vec2 w){
  vec2 b = L(w - uPos);
  float fast = min(uSpeed, 12.0);                     // the arms are no longer for a rocket's speed
  float way = clamp(fast/5.0, 0.0, 1.4);
  float tail = uRocket > 0.5 ? 4.0 + uSpeed*0.9 : 0.0;
  if (way < 0.05 || abs(b.x) > 5.0 + fast + 0.06*tail || b.y > 2.5 || b.y < -6.0 - fast*3.0 - tail)
    return vec2(0.0);
  float n1 = noise(w*4.7 + uT*0.6), n2 = noise(w*11.3 - uT*0.9);
  float s = -b.y - 1.0;                               // astern of the stern
  float len = 3.0 + fast*2.4;
  float foam = 0.0, slick = 0.0;
  if (s > -0.6) {
    float sp = max(s, 0.0), gone = 1.0 - smoothstep(0.2*len, len, sp);
    float arm = abs(abs(b.x) - 0.2 - 0.30*sp), wide = 0.05 + 0.025*sp;
    foam += gone*smoothstep(wide, 0.2*wide, arm)*smoothstep(0.15, 0.55, 0.55*n1 + 0.45*n2 + 0.3*gone)
          * smoothstep(-0.5, 0.2, s);
    float mid = smoothstep(0.25 + 0.16*sp, 0.03 + 0.06*sp, abs(b.x));
    float churn = 1.0 - smoothstep(0.0, 0.5*len, sp);
    foam += 0.8*mid*churn*smoothstep(0.50, 0.80, 0.5*n1 + 0.5*n2 + 0.38*churn)*smoothstep(-0.6, 0.0, s);
    slick = mid*gone*smoothstep(-0.6, 0.3, s);
    if (tail > 0.0) {
      // the rooster tail: thick foam that spreads and breaks up as it falls astern
      float left = 1.0 - smoothstep(0.15*tail, tail, sp);
      float band = smoothstep(0.7 + 0.07*sp, 0.25 + 0.03*sp, abs(b.x));
      float torn = smoothstep(0.85 - 1.0*left, 1.05 - 0.75*left, 0.4*n1 + 0.25*n2 + 0.45*noise(w*1.1));
      foam = max(foam/max(way, 0.1), band*torn*smoothstep(-0.6, 0.2, s))*max(way, 0.1);
      slick = max(slick, band*left);
    }
  }
  // the bow wave curls off the hull's sides
  float hullx = b.x*(1.0 + 0.5*smoothstep(0.2, 1.4, b.y));
  float e = length(vec2(hullx/0.50, b.y/1.38));
  float bow = smoothstep(1.34, 1.08, e)*smoothstep(0.8, 1.05, e)*smoothstep(-1.3, 0.4, b.y);
  foam += bow*(0.45 + 0.8*n2);
  return vec2(clamp(foam*way, 0.0, 1.0), slick*min(way, 1.0));
}

// The plume as smoke, not balls: how much of the view the puffs along a ray cover (0..1), with
// the normal and the age (0 new .. 1) of what covers it and the distance to the nearest of it.
float plumeSoft(vec3 o, vec3 d, float tMax, out vec3 n, out float age, out float tNear){
  float clear = 1.0, sum = 0.0;
  n = vec3(0.0); age = 0.0; tNear = tMax;
  vec3 mid = vec3(uVolcano.x, uVolcano.z + 60.0, uVolcano.y) + vec3(uWind.x, 0.0, uWind.y)*90.0*uWindSpeed - o;
  float along = dot(mid, d);
  if (along < 0.0 || dot(mid, mid) - along*along > 240.0*240.0) return 0.0;
  for (int i = 0; i < ${PUFFS}; i++) {
    float fi = float(i);
    float s = fract((fi + uT*0.05)/${PUFFS}.0);
    vec3 c = vec3(uVolcano.x, uVolcano.z + 100.0*pow(s, 0.85), uVolcano.y);
    c.xz += uWind.xy*(14.0*s + 190.0*s*s*uWindSpeed) + 7.0*s*vec2(sin(fi*2.4), cos(fi*1.7));
    float r = 1.3*(8.0 + 27.0*s)*smoothstep(0.0, 0.05, s)*smoothstep(1.0, 0.8, s);
    vec3 oc = o - c;
    float b = dot(oc, d), h2 = dot(oc, oc) - b*b;
    if (r < 0.5 || h2 > r*r || b > 0.0 || -b > tMax) continue;
    float x = 1.0 - h2/(r*r);                          // 1 through the middle .. 0 at the rim
    vec3 nn = (oc + d*(-b - r*sqrt(x)))/r;
    float lump = noise(vec2(nn.x - nn.z, nn.y)*3.0 + fi*7.3 + uT*0.04)
               + 0.5*noise(vec2(nn.x + nn.z, nn.y)*7.0 - fi*3.1);
    float a = smoothstep(0.05, 0.6, x - 0.3*lump)*(1.0 - 0.45*smoothstep(0.55, 1.0, s));
    n += nn*a; age += s*a; sum += a;
    clear *= 1.0 - a;
    tNear = min(tNear, -b - r);
  }
  if (sum < 1e-3) return 0.0;
  n = normalize(n + vec3(0.0, 1e-4, 0.0)); age /= sum;
  return 1.0 - clear;
}
`;
