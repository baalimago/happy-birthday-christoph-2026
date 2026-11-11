// The scene every view shares, as GLSL: the sea, the land read from the height texture (with its
// woods, the volcano and the sea cave carved into it), the lighthouses and cave lights on the
// ports, the smoke plume and the boat, plus the marks they carry in every view.
//
// Everything is in world coordinates (x east, y up, z north) except the boat, which is a distance
// field in its own frame: it sits at the origin facing +z. W() and L() go between the two.

/** Ports the shader has room for. */
export const PORTS = 8;
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

float gHit = 0.0;                // what this pixel shows (an id, 0 for sky), for the post passes

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

// ---- the sea: two wave trains running with the wind, and a little chop
float sea(vec2 w){
  vec2 d = w - uPos;
  float h = 0.11*sin(dot(d, uWind.xy)*0.85 + uWave.x)
          * (0.7 + 0.3*sin(dot(d, vec2(-uWind.y, uWind.x))*0.3 + uWave.z));
  h += 0.05*sin(dot(d, uWind.zw)*1.9 + uWave.y);
  return h*uWindSpeed + 0.03*noise(w*2.5 + uT*0.5);
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
  float by = sea(uPos)*0.7 + 0.03;
  vec3 q = p - vec3(0.0, by, 0.0);
  float a = 0.07*sin(uT*1.3) - uLean, c = cos(a), s = sin(a);   // uLean > 0 heels to starboard
  q.xy = mat2(c, -s, s, c)*q.xy;
  a = 0.05*sin(uT*0.9 + 1.0); c = cos(a); s = sin(a);
  q.yz = mat2(c, -s, s, c)*q.yz;
  return q;
}
// the mainsail's own coordinates: it swings about the mast with the boom
vec3 sailLocal(vec3 q){
  float c = cos(uBoom), s = sin(uBoom);
  vec2 m = vec2(q.x, q.z - 0.12);
  return vec3(m.x*c + m.y*s, q.y, m.y*c - m.x*s + 0.12);
}
// ids: 3 hull, 4 mainsail, 5 mast and boom, 6 jib, 7 pennant
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
  float b = dot(oc, d), disc = b*b - dot(oc, oc) + 2.9*2.9;
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
  if (uSpeed > 0.8 && b.y < -1.25 && b.y > -1.5 - uSpeed*0.9) {
    float arm = abs(abs(b.x) - (-b.y - 1.2)*0.32);
    if (arm < 0.05 + 0.012*(-b.y)) m.y = 1.0;
  }
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
`;
