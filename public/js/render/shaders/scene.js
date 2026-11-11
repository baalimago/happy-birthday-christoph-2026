// The scene every view shares: the sea, the islands, the lighthouses on the ports and the boat,
// as a distance field in the boat's own frame (the boat sits at the origin facing +z and the
// world turns around it), plus the marks the sea and the lighthouses carry in every view.

export const MAX_ISLES = 14;
export const PORTS = 6;

export const SCENE = /* glsl */ `
uniform vec2 uRes, uShift, uPos, uHead;
uniform vec3 uSun;
uniform float uT, uYaw, uPitch, uEnd, uSpeed, uLean;
uniform int uMode;
uniform vec4 uIsle[${MAX_ISLES}];   // x, z, height, spread; the first ${PORTS} are ports
uniform float uFound[${PORTS}];

const float LIGHT_TOP = 1.35;   // lighthouse lamp above its island's nominal height
const float LIGHT_LAMP = 1.13;  // the lamp room starts here

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y);
}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

// boat frame to world (x, z), and a world (x, z) direction back into the boat frame
vec2 W(vec3 p){ return uPos + p.x*vec2(uHead.y, -uHead.x) + p.z*uHead; }
vec2 L(vec2 d){ return vec2(dot(d, vec2(uHead.y, -uHead.x)), dot(d, uHead)); }

float sea(vec2 w){
  float t = uT;
  float h = 0.10 * sin(w.x*0.9 + t*1.1) * cos(w.y*0.7 + t*0.8);
  h += 0.05 * sin(w.x*1.9 - t*1.6 + w.y*1.3);
  h += 0.03 * noise(w*2.5 + t*0.5);
  return h;
}
// height of the land; near = offset from the nearest port (xy) and that port's index (z)
float land(vec2 w, out vec3 near){
  float h = -1.0, best = 1e9;
  near = vec3(1e4, 1e4, 0.0);
  for (int i = 0; i < ${MAX_ISLES}; i++) {
    vec4 c = uIsle[i];
    vec2 d = w - c.xy;
    float dd = dot(d, d);
    if (i < ${PORTS} && dd < best) { best = dd; near = vec3(d, float(i)); }
    if (dd < c.w*4.5) {
      float e = exp(-dd/c.w);
      h = max(h, c.z*e - 0.35 + 0.3*e*noise(w*1.3));
    }
  }
  return h;
}
float ter(vec2 w){ vec3 near; return land(w, near); }
// the lighthouse of the nearest port (ports stand far apart, so one is enough)
float light(vec3 near, float y){
  float r = length(near.xy);
  if (r > 3.0) return r - 1.0;
  float top = uIsle[int(near.z)].z + LIGHT_TOP;
  float body = max(r - (0.20 + 0.045*clamp(top - y, 0.0, 2.0)), y - top);
  float lamp = length(vec2(r, y - top - 0.02)) - 0.27;
  return min(body, lamp);
}
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
// the boat's own coordinates: it bobs, rolls and pitches on the swell
vec3 boatLocal(vec3 p){
  float by = sea(uPos)*0.7 + 0.03;
  vec3 q = p - vec3(0.0, by, 0.0);
  float a = 0.07*sin(uT*1.3) + uLean, c = cos(a), s = sin(a);
  q.xy = mat2(c, -s, s, c)*q.xy;
  a = 0.05*sin(uT*0.9 + 1.0); c = cos(a); s = sin(a);
  q.yz = mat2(c, -s, s, c)*q.yz;
  return q;
}
// ids: 3 hull, 4 mainsail, 5 mast, 6 jib, 7 pennant
vec2 boat(vec3 p){
  vec3 q = boatLocal(p);
  vec3 r = vec3(0.50, 0.44, 1.40), h = q - vec3(0.0, 0.12, 0.0);
  h.x *= 1.0 + 0.5*smoothstep(0.2, 1.4, q.z);
  float hull = max((length(h/r) - 1.0)*0.40, q.y - 0.27);
  vec3 m = q - vec3(0.0, 0.0, 0.15);
  float mast = length(m - vec3(0.0, clamp(m.y, 0.2, 2.75), 0.0)) - 0.035;
  float bx = q.x - 0.11*sin(clamp((q.y - 0.4)*1.45, 0.0, 3.14));
  float s1 = max(sdTri(q.zy, vec2(0.08,0.5), vec2(0.08,2.45), vec2(-1.2,0.5)), abs(bx) - 0.02);
  float s2 = max(sdTri(q.zy, vec2(0.24,0.42), vec2(0.2,2.1), vec2(1.32,0.42)), abs(bx) - 0.02);
  float fx = q.x - 0.05*sin(q.z*9.0 - uT*6.0)*clamp(0.15 - q.z, 0.0, 1.0)*3.0;
  float flag = max(sdTri(q.zy, vec2(0.15,2.72), vec2(0.15,2.52), vec2(-0.42,2.62)),
                   abs(fx) - 0.015);
  vec2 res = vec2(hull, 3.0);
  if (mast < res.x) res = vec2(mast, 5.0);
  if (s1 < res.x) res = vec2(s1, 4.0);
  if (s2 < res.x) res = vec2(s2, 6.0);
  if (flag < res.x) res = vec2(flag, 7.0);
  return res;
}
// x = distance, y = id (1 sea, 2 island, 3-7 boat, 10+i lighthouse of port i)
vec2 map(vec3 p){
  vec2 w = W(p);
  vec3 near;
  float t = land(w, near);
  // well above the swell its crest is a safe stand-in, and saves the noise
  float s = p.y > 0.6 ? 0.18 : sea(w);
  vec2 r = vec2((p.y - max(s, t))*0.5, t > s ? 2.0 : 1.0);
  float l = light(near, p.y);
  if (l < r.x) r = vec2(l, 10.0 + near.z);
  float bd = length(p - vec3(0.0, 1.3, 0.0));
  if (bd < 2.8) { vec2 b = boat(p); b.x *= 0.8; if (b.x < r.x) r = b; }
  else r.x = min(r.x, bd - 2.5);
  return r;
}
float ground(vec2 w){ return max(sea(w), ter(w)); }
vec3 groundN(vec2 w, float e){
  vec3 n = normalize(vec3(ground(w - vec2(e,0)) - ground(w + vec2(e,0)), 2.0*e,
                          ground(w - vec2(0,e)) - ground(w + vec2(0,e))));   // world frame
  return vec3(L(n.xz), n.y).xzy;
}
vec3 boatN(vec3 p){
  vec2 e = vec2(0.003, -0.003);
  return normalize(e.xyy*boat(p + e.xyy).x + e.yyx*boat(p + e.yyx).x +
                   e.yxy*boat(p + e.yxy).x + e.xxx*boat(p + e.xxx).x);
}
vec3 lightN(float id, vec3 p){
  vec2 d = L(W(p) - uIsle[int(id - 9.5)].xy);
  float top = uIsle[int(id - 9.5)].z + LIGHT_TOP;
  return normalize(vec3(d.x, max(p.y - top, 0.0)*1.5, d.y));
}
// an antialiased line wherever v crosses an integer; fw = fwidth(v)
float lineAt(float v, float fw){
  float d = abs(fract(v - 0.5) - 0.5);
  return (1.0 - smoothstep(0.0, 1.5*fw, d)) * clamp(0.4/max(fw, 1e-4), 0.0, 1.0);
}
// what the sea carries, shared by every view:
// x = ring round an unfound port, y = wake, z = height of the land over the water (shore)
vec3 seaMarks(vec3 p, vec2 w, float t){
  vec3 m = vec3(0.0);
  vec3 near;
  m.z = land(w, near) - sea(w);
  int port = int(near.z);
  if (uFound[port] < 0.5) {
    float r = length(near.xy), ring = 5.6 + 0.4*sin(uT*2.4 + near.z);
    float dash = fract(atan(near.y, near.x)*2.546 + uT*0.25);
    if (abs(r - ring) < 0.14 + 0.008*t && dash < 0.62) m.x = 1.0;
  }
  if (uSpeed > 0.8 && p.z < -1.25 && p.z > -1.5 - uSpeed*0.9) {
    float arm = abs(abs(p.x) - (-p.z - 1.2)*0.32);
    if (arm < 0.05 + 0.012*(-p.z)) m.y = 1.0;
  }
  return m;
}
// lighthouse: x = stripe (0 or 1), y = lamp lit (0 or 1), z = found, w = in the lamp room
vec4 lightMarks(float id, vec3 p){
  int port = int(id - 9.5);
  float y = p.y - uIsle[port].z;
  float blink = step(fract(uT*0.9 + float(port)*0.37), 0.6);
  return vec4(step(mod(floor(y*2.6), 2.0), 0.5), max(blink, uFound[port]), uFound[port],
              step(LIGHT_LAMP, y));
}
`;
