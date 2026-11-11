// The poster sea: one full-screen triangle, everything else is the fragment shader.
// A raymarched heightfield (waves and islands), signed-distance lighthouses and a sailboat,
// shaded in one of four views (uMode): Riviera poster, terminal wireframe, Secession gold or
// engraved chart. The scene is drawn in the boat's
// own frame: the boat sits at the origin facing +z and the world turns around it.

export const MAX_ISLES = 14;
export const PORTS = 6;

export const VERTEX = `#version 300 es
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAGMENT = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uRes, uShift, uPos, uHead;
uniform vec3 uSun;
uniform float uT, uYaw, uPitch, uEnd, uSpeed, uLean;
uniform int uMode;
uniform vec4 uIsle[${MAX_ISLES}];   // x, z, height, spread; the first ${PORTS} are ports
uniform float uFound[${PORTS}];

const vec3 NAVY = vec3(0.071,0.188,0.290), CREAM = vec3(1.0,0.957,0.863), CORAL = vec3(0.937,0.416,0.298);
const vec3 ORANGE = vec3(0.961,0.541,0.235), AMBER = vec3(0.976,0.722,0.290), YELLOW = vec3(0.984,0.851,0.478);
const vec3 TEAL = vec3(0.059,0.431,0.478), TEAL2 = vec3(0.090,0.537,0.604), SUNC = vec3(1.0,0.945,0.788);

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }

// boat frame to world
vec2 W(vec3 p){ return uPos + p.x*vec2(uHead.y, -uHead.x) + p.z*uHead; }

float sea(vec2 w){
  float t = uT;
  float h = 0.10 * sin(w.x*0.9 + t*1.1) * cos(w.y*0.7 + t*0.8);
  h += 0.05 * sin(w.x*1.9 - t*1.6 + w.y*1.3);
  h += 0.03 * noise(w*2.5 + t*0.5);
  return h;
}
float ter(vec2 w){
  float h = -1.0;
  for (int i = 0; i < ${MAX_ISLES}; i++) {
    vec4 c = uIsle[i];
    vec2 d = w - c.xy;
    float dd = dot(d, d);
    if (dd < c.w*4.5) {
      float e = exp(-dd/c.w);
      h = max(h, c.z*e - 0.35 + 0.3*e*noise(w*1.3));
    }
  }
  return h;
}
// lighthouses on the ports: x = distance, y = port index
vec2 lights(vec2 w, float y){
  vec2 res = vec2(1e5, 0.0);
  for (int i = 0; i < ${PORTS}; i++) {
    vec4 c = uIsle[i];
    vec2 d = w - c.xy;
    float r = length(d), top = c.z + 1.35;
    float body = max(r - (0.26 + 0.05*clamp(top - y, 0.0, 2.0)), y - top);
    float lamp = length(vec3(d.x, y - top - 0.1, d.y)) - 0.36;
    float dl = min(body, lamp);
    if (dl < res.x) res = vec2(dl, float(i));
  }
  return res;
}
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2){
  vec2 e0=p1-p0, e1=p2-p1, e2=p0-p2, v0=p-p0, v1=p-p1, v2=p-p2;
  vec2 pq0=v0-e0*clamp(dot(v0,e0)/dot(e0,e0),0.0,1.0);
  vec2 pq1=v1-e1*clamp(dot(v1,e1)/dot(e1,e1),0.0,1.0);
  vec2 pq2=v2-e2*clamp(dot(v2,e2)/dot(e2,e2),0.0,1.0);
  float s=sign(e0.x*e2.y-e0.y*e2.x);
  vec2 d=min(min(vec2(dot(pq0,pq0),s*(v0.x*e0.y-v0.y*e0.x)),vec2(dot(pq1,pq1),s*(v1.x*e1.y-v1.y*e1.x))),vec2(dot(pq2,pq2),s*(v2.x*e2.y-v2.y*e2.x)));
  return -sqrt(d.x)*sign(d.y);
}
vec3 boatLocal(vec3 p){
  float by = sea(uPos)*0.7 + 0.03;
  vec3 q = p - vec3(0.0, by, 0.0);
  float a = 0.07*sin(uT*1.3) + uLean, c = cos(a), s = sin(a);
  q.xy = mat2(c,-s,s,c)*q.xy;
  a = 0.05*sin(uT*0.9+1.0); c = cos(a); s = sin(a);
  q.yz = mat2(c,-s,s,c)*q.yz;
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
  float bx = q.x - 0.11*sin(clamp((q.y-0.4)*1.45, 0.0, 3.14));
  float s1 = max(sdTri(q.zy, vec2(0.08,0.5), vec2(0.08,2.45), vec2(-1.2,0.5)), abs(bx)-0.02);
  float s2 = max(sdTri(q.zy, vec2(0.24,0.42), vec2(0.2,2.1), vec2(1.32,0.42)), abs(bx)-0.02);
  float fx = q.x - 0.05*sin(q.z*9.0 - uT*6.0)*clamp(0.15 - q.z, 0.0, 1.0)*3.0;
  float flag = max(sdTri(q.zy, vec2(0.15,2.72), vec2(0.15,2.52), vec2(-0.42,2.62)), abs(fx)-0.015);
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
  float s = sea(w), t = ter(w);
  vec2 r = vec2((p.y - max(s, t))*0.5, t > s ? 2.0 : 1.0);
  vec2 l = lights(w, p.y);
  if (l.x < r.x) r = vec2(l.x, 10.0 + l.y);
  float bd = length(p - vec3(0.0, 1.3, 0.0));
  if (bd < 2.8) { vec2 b = boat(p); b.x *= 0.8; if (b.x < r.x) r = b; }
  else r.x = min(r.x, bd - 2.5);
  return r;
}
vec3 groundN(vec2 w, float e){
  float a = max(sea(w-vec2(e,0)), ter(w-vec2(e,0))), b = max(sea(w+vec2(e,0)), ter(w+vec2(e,0)));
  float c = max(sea(w-vec2(0,e)), ter(w-vec2(0,e))), d = max(sea(w+vec2(0,e)), ter(w+vec2(0,e)));
  vec3 n = normalize(vec3(a-b, 2.0*e, c-d));   // world frame
  vec2 right = vec2(uHead.y, -uHead.x);
  return vec3(dot(n.xz, right), n.y, dot(n.xz, uHead));
}
vec3 boatN(vec3 p){
  vec2 e = vec2(0.003, -0.003);
  return normalize(e.xyy*boat(p+e.xyy).x + e.yyx*boat(p+e.yyx).x + e.yxy*boat(p+e.yxy).x + e.xxx*boat(p+e.xxx).x);
}
float lineAt(float v, float fw){
  float d = abs(fract(v - 0.5) - 0.5);
  return (1.0 - smoothstep(0.0, 1.5*fw, d)) * clamp(0.4/max(fw, 1e-4), 0.0, 1.0);
}
float hatch(vec2 fc, float ang, float period){
  float v = abs(fract(dot(fc, vec2(cos(ang), sin(ang)))/period) - 0.5)*2.0;
  return smoothstep(0.5, 0.72, v);
}
// what the sea carries, shared by every view: x = ring round an unfound port, y = wake, z = shore
vec3 seaMarks(vec3 p, vec2 w){
  vec3 m = vec3(0.0);
  for (int i = 0; i < ${PORTS}; i++) {
    if (uFound[i] > 0.5) continue;
    vec2 d = w - uIsle[i].xy;
    float r = length(d), ring = 5.6 + 0.5*sin(uT*2.4 + float(i));
    if (abs(r - ring) < 0.13 && fract(atan(d.y, d.x)*2.546 + uT*0.25) < 0.62) m.x = 1.0;
  }
  if (uSpeed > 0.8 && p.z < -1.25 && p.z > -1.5 - uSpeed*0.9) {
    float arm = abs(abs(p.x) - (-p.z - 1.2)*0.32);
    if (arm < 0.05 + 0.012*(-p.z)) m.y = 1.0;
  }
  m.z = ter(w) - sea(w);
  return m;
}
// lighthouse: x = stripe (0 or 1), y = lamp (0 or 1), z = found
vec3 lightMarks(float id, vec3 p){
  int port = int(id - 9.5);
  float top = uIsle[port].z + 1.35;
  float lamp = step(top - 0.22, p.y);
  float blink = step(fract(uT*0.9 + float(port)*0.37), 0.6);
  return vec3(step(mod(floor(p.y*1.7), 2.0), 0.5), lamp*max(blink, uFound[port]), uFound[port]);
}

// ---------- view 0: Riviera poster ----------
vec3 skyA(vec3 rd){
  float y = rd.y + 0.05*uEnd;
  vec3 c = y > 0.46 ? CORAL : y > 0.28 ? ORANGE : y > 0.13 ? AMBER : YELLOW;
  if (dot(rd, uSun) > 0.972 - 0.02*uEnd) c = SUNC;
  return c;
}
vec3 shadeA(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t){
  float df = dot(n, uSun);
  if (id < 1.5) {
    vec3 mk = seaMarks(p, W(p));
    float sp = pow(max(dot(reflect(rd, n), uSun), 0.0), 24.0);
    vec3 c = TEAL;
    if (dot(n.xz, uSun.xz) > 0.07) c = TEAL2;
    if (sp > 0.35) c = SUNC;
    if (mk.z > -0.06 || mk.y > 0.5) c = CREAM;
    if (mk.x > 0.5) c = YELLOW;
    return mix(c, TEAL, smoothstep(25.0, 60.0, t)*0.7);
  }
  if (id < 2.5) {
    if (p.y < 0.14) return SUNC;
    return df < 0.05 ? NAVY : df < 0.5 ? vec3(0.659,0.196,0.102) : ORANGE;
  }
  if (id > 9.5) {
    vec3 lm = lightMarks(id, p);
    vec3 c = lm.x > 0.5 ? CREAM : (lm.z > 0.5 ? NAVY : CORAL);
    if (p.y > uIsle[int(id - 9.5)].z + 1.13) c = lm.y > 0.5 ? (lm.z > 0.5 ? YELLOW : SUNC) : CORAL;
    else if (df < 0.0) c *= 0.86;
    return c;
  }
  if (id < 3.5) return (q.y > 0.13 && q.y < 0.2) ? YELLOW : NAVY;
  if (id < 4.5) return (q.y > 1.05 && q.y < 1.35) ? CORAL : CREAM;
  if (id < 5.5) return NAVY;
  if (id < 6.5) return CORAL;
  return YELLOW;
}
// ---------- view 1: Tractatus terminal ----------
const vec3 B_BG = vec3(0.02,0.031,0.039), B_GREEN = vec3(0.494,0.878,0.631), B_AMBER = vec3(0.941,0.702,0.353);
vec3 skyB(vec3 rd){
  vec3 c = B_BG;
  vec2 g = floor(vec2(atan(rd.x, rd.z)*60.0, rd.y*120.0));
  if (rd.y > 0.02 && hash(g) > 0.9965) c += 0.5;
  if (dot(rd, uSun) > 0.975 && fract(rd.y*46.0) > 0.4) c = B_AMBER*0.85;
  c += B_GREEN*0.10*exp(-abs(rd.y)*18.0);
  return c;
}
vec3 shadeB(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t){
  float fade = exp(-t*0.035);
  float rim = pow(1.0 - abs(dot(n, rd)), 1.5);
  if (id < 2.5) {
    vec2 w = W(p); vec2 fw = fwidth(w);
    float l = max(lineAt(w.x*0.5, fw.x*0.5), lineAt(w.y*0.5, fw.y*0.5));
    if (id < 1.5) {
      vec3 mk = seaMarks(p, w);
      vec3 c = B_BG + B_GREEN*(l*0.95 + 0.03)*fade;
      if (mk.y > 0.5) c = vec3(0.85);
      if (mk.x > 0.5) c = B_AMBER;
      return c;
    }
    float cl = lineAt(p.y*4.0, fwidth(p.y*4.0));
    return B_BG + B_AMBER*(max(cl, l*0.5) + 0.06)*fade;
  }
  if (id > 9.5) {
    vec3 lm = lightMarks(id, p);
    vec3 c = lm.z > 0.5 ? B_GREEN : B_AMBER;
    if (p.y > uIsle[int(id - 9.5)].z + 1.13) return B_BG + vec3(1.0)*lm.y + c*0.3;
    return B_BG + c*(0.12 + 0.8*lineAt(p.y*3.0, fwidth(p.y*3.0)) + rim*0.5);
  }
  vec3 c = id < 3.5 ? vec3(0.37,0.65,0.72) : id < 4.5 ? B_GREEN : id < 5.5 ? vec3(0.9) : B_AMBER;
  float l = lineAt(q.y*6.0, fwidth(q.y*6.0));
  if (id > 3.5 && (id < 4.5 || id > 5.5)) l = max(l, lineAt(q.z*4.0 + q.y*2.0, fwidth(q.z*4.0 + q.y*2.0)));
  return B_BG + c*(0.10 + l*0.85 + rim*0.5);
}
// ---------- view 2: Secession gold ----------
const vec3 C_BG = vec3(0.055,0.055,0.051), C_GOLD = vec3(0.831,0.682,0.353), C_IVORY = vec3(0.945,0.925,0.878);
vec3 skyC(vec3 rd){
  vec3 c = C_BG;
  float ang = acos(clamp(dot(rd, uSun), -1.0, 1.0));
  if (ang < 0.30) c = fract(ang*34.0) > 0.32 ? C_GOLD : C_BG;
  else if (rd.y > 0.03) {
    vec2 g = vec2(atan(rd.x, rd.z)*9.0, rd.y*16.0); vec2 f = abs(fract(g) - 0.5);
    if (hash(floor(g)) > 0.95 && max(f.x, f.y) < 0.2) c = C_GOLD*0.9;
  }
  c += C_GOLD*0.35*exp(-abs(rd.y)*30.0);
  return c;
}
vec3 mosaic(vec2 u, float df){
  vec2 f = abs(fract(u) - 0.5); float h = hash(floor(u));
  vec3 c = h < 0.45 ? C_GOLD : h < 0.65 ? vec3(0.45,0.33,0.12) : h < 0.82 ? C_IVORY : vec3(0.10,0.10,0.09);
  c *= 0.5 + 0.5*clamp(df*0.5 + 0.5, 0.0, 1.0);
  if (max(f.x, f.y) > 0.44) c = C_BG;
  return c;
}
vec3 shadeC(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t){
  float df = dot(n, uSun);
  float sp = pow(max(dot(reflect(rd, n), uSun), 0.0), 60.0);
  if (id < 1.5) {
    vec2 w = W(p); float s = sea(w)*16.0;
    vec3 mk = seaMarks(p, w);
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
    float l = lineAt(s, fwidth(s));
    vec3 c = C_BG + C_GOLD*(sp*1.6 + fres*0.45 + l*0.55*exp(-t*0.05));
    if (mk.z > -0.05 || mk.x > 0.5) c = C_GOLD;
    if (mk.y > 0.5) c = C_IVORY;
    return c;
  }
  if (id < 2.5) { vec2 w = W(p); return mosaic(vec2(w.x + w.y*0.37, p.y*1.6 + w.y*0.9)*2.6, df) + C_GOLD*sp*0.6; }
  if (id > 9.5) {
    vec3 lm = lightMarks(id, p);
    if (p.y > uIsle[int(id - 9.5)].z + 1.13) return lm.y > 0.5 ? C_IVORY : C_GOLD*0.5;
    vec3 c = lm.x > 0.5 ? C_IVORY : (lm.z > 0.5 ? vec3(0.45,0.33,0.12) : C_GOLD);
    return c*(0.6 + 0.4*clamp(df*0.5 + 0.5, 0.0, 1.0)) + sp*0.5;
  }
  if (id < 3.5) { vec3 c = C_GOLD*(0.55 + 0.45*clamp(df*0.5+0.5,0.0,1.0)); vec2 f = abs(fract(vec2(q.z*5.0, q.y*5.0)) - 0.5);
    if (q.y > 0.0 && q.y < 0.2 && max(f.x, f.y) < 0.28) c = C_BG; return c + sp; }
  if (id < 4.5) { vec2 u = q.zy*5.0; vec2 f = abs(fract(u) - 0.5); float h = hash(floor(u));
    vec3 c = C_IVORY; if (h > 0.72 && max(f.x, f.y) < 0.36) c = h > 0.9 ? C_BG : C_GOLD;
    return c*(0.72 + 0.28*clamp(abs(df) + 0.3, 0.0, 1.0)); }
  if (id < 5.5) return C_GOLD;
  return C_GOLD*(0.6 + 0.4*clamp(abs(df) + 0.3, 0.0, 1.0)) + sp;
}
// ---------- view 3: engraved chart ----------
const vec3 D_PAPER = vec3(0.905,0.850,0.705), D_INK = vec3(0.165,0.141,0.094), D_RED = vec3(0.54,0.20,0.14);
float inkFromLum(float lum, vec2 fc, float k){
  float i = 0.0;
  if (lum < 0.78) i = max(i, hatch(fc, 0.6, 7.0*k));
  if (lum < 0.52) i = max(i, hatch(fc, -0.75, 7.0*k));
  if (lum < 0.28) i = max(i, hatch(fc, 1.57, 4.0*k));
  return i;
}
vec3 skyD(vec3 rd, vec2 fc, float k){
  float ink = 0.0;
  float ang = acos(clamp(dot(rd, uSun), -1.0, 1.0));
  vec3 rt = normalize(cross(vec3(0,1,0), uSun)), up = cross(uSun, rt);
  float az = atan(dot(rd, up), dot(rd, rt));
  ink = max(ink, 1.0 - smoothstep(0.0, 0.006, abs(ang - 0.16)));
  ink = max(ink, 1.0 - smoothstep(0.0, 0.004, abs(ang - 0.185)));
  if (ang > 0.21 && ang < 0.21 + 0.16*(0.55 + 0.45*step(0.5, fract(az*16.0/6.2832 + 0.25))))
    ink = max(ink, 1.0 - smoothstep(0.0, 0.10, abs(fract(az*32.0/6.2832) - 0.5)*2.0*ang*4.0));
  if (ang < 0.16) ink = max(ink, hatch(fc, 0.6, 9.0*k)*0.6);
  vec3 c = mix(D_PAPER, D_INK, clamp(ink, 0.0, 1.0)*0.9);
  float rh = abs(fract(az*16.0/6.2832) - 0.5)*2.0;
  if (ang > 0.42) c = mix(c, D_RED, (1.0 - smoothstep(0.0, 0.012/ang, 1.0 - rh))*0.35);
  return c;
}
vec3 shadeD(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k){
  float df = clamp(dot(n, uSun), 0.0, 1.0);
  float edge = abs(dot(n, rd));
  float ink = 0.0;
  vec3 tint = D_INK;
  if (id < 1.5) {
    vec2 w = W(p); float s = sea(w);
    vec3 mk = seaMarks(p, w);
    float v = w.y*2.6 + s*7.0 + 0.4*sin(w.x*1.7);
    ink = lineAt(v, fwidth(v))*0.85*exp(-t*0.03);
    if (mk.z > -0.22) ink = max(ink, step(0.55, hash(floor(fc/(2.5*k)))) * smoothstep(-0.22, -0.05, mk.z));
    if (mk.z > -0.035 || mk.y > 0.5) ink = 1.0;
    ink = max(ink, inkFromLum(0.55 + df*0.6, fc, k)*0.5*exp(-t*0.08));
    if (mk.x > 0.5) { ink = 1.0; tint = D_RED; }
  } else if (id < 2.5) {
    ink = inkFromLum(0.12 + df*0.95, fc, k);
    if (edge < 0.22) ink = 1.0;
  } else if (id > 9.5) {
    vec3 lm = lightMarks(id, p);
    ink = lm.x > 0.5 ? 0.0 : 1.0;
    if (edge < 0.3) ink = 1.0;
    if (p.y > uIsle[int(id - 9.5)].z + 1.13) { ink = 1.0; if (lm.y > 0.5) tint = D_RED; }
  } else if (id < 3.5) {
    ink = inkFromLum(0.2 + df*0.3, fc, k);
    if (q.y > 0.13 && q.y < 0.2) ink = 0.0;
    if (edge < 0.3) ink = 1.0;
  } else if (id > 4.5 && id < 5.5) {
    ink = 1.0;
  } else if (id > 6.5) {
    ink = 1.0; tint = D_RED;
  } else {
    ink = inkFromLum(0.62 + 0.5*abs(dot(n, uSun)), fc, k)*0.8;
    ink = max(ink, lineAt(q.y*2.5, fwidth(q.y*2.5))*0.6);
    if (edge < 0.16) ink = 1.0;
  }
  vec3 c = mix(D_PAPER, tint, clamp(ink, 0.0, 1.0)*0.92);
  if (id > 5.5 && id < 6.5) c = mix(c, D_RED, 0.25);
  return mix(c, D_PAPER, smoothstep(30.0, 70.0, t));
}
void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (fc - 0.5*uRes)/uRes.y - uShift;
  vec3 ta = vec3(0.0, 1.1, 0.0);
  vec3 ro = ta + 8.6*vec3(cos(uPitch)*sin(uYaw), sin(uPitch), cos(uPitch)*cos(uYaw));
  vec3 f = normalize(ta - ro), r = normalize(cross(vec3(0,1,0), f)), u = cross(f, r);
  vec3 rd = normalize(f*1.25 + r*uv.x + u*uv.y);

  float t = 0.0; vec2 m = vec2(0.0); bool hit = false;
  for (int i = 0; i < 110; i++) {
    m = map(ro + rd*t);
    if (m.x < 0.0012*t + 0.0008) { hit = true; break; }
    t += m.x;
    if (t > 90.0) break;
  }
  float id = m.y;
  if (!hit && rd.y < -0.002) { t = -ro.y/rd.y; id = 1.0; hit = t < 400.0; }

  float k = uRes.y/700.0;
  vec3 col;
  if (hit) {
    vec3 p = ro + rd*t;
    vec3 n;
    if (id < 2.5) n = groundN(W(p), 0.01 + 0.004*t);
    else if (id > 9.5) { vec2 d = W(p) - uIsle[int(id - 9.5)].xy; vec2 right = vec2(uHead.y, -uHead.x); n = normalize(vec3(dot(d, right), 0.0, dot(d, uHead))); }
    else n = boatN(p);
    vec3 q = boatLocal(p);
    if (uMode == 0) col = shadeA(id, p, n, rd, q, t);
    else if (uMode == 1) col = shadeB(id, p, n, rd, q, t);
    else if (uMode == 2) col = shadeC(id, p, n, rd, q, t);
    else col = shadeD(id, p, n, rd, q, t, fc, k);
    float far = smoothstep(60.0, 300.0, t);
    if (uMode == 1) col = mix(col, B_BG + B_GREEN*0.10, far);
    if (uMode == 2) col = mix(col, C_BG + C_GOLD*0.3, far);
  } else {
    if (uMode == 0) col = skyA(rd);
    else if (uMode == 1) col = skyB(rd);
    else if (uMode == 2) col = skyC(rd);
    else col = skyD(rd, fc, k);
  }
  if (uMode == 1) col *= 0.88 + 0.12*step(0.5, fract(fc.y/(3.0*k)));
  if (uMode == 3) {
    col *= 0.95 + 0.07*noise(fc*0.35/k);
    col *= 1.0 - 0.35*pow(length((fc/uRes - 0.5)*vec2(1.1, 1.3)), 2.5);
    if (abs(rd.y) < 0.0016) col = mix(col, D_INK, 0.8);
  }
  outColor = vec4(col, 1.0);
}`;
