// View 3, the engraved chart: ink hatching on parchment, a compass-rose sun, red for what matters.

export const chart = {
  id: 'chart',
  glsl: /* glsl */ `
const vec3 C_PAPER = vec3(0.905,0.850,0.705), C_INK = vec3(0.165,0.141,0.094);
const vec3 C_RED = vec3(0.54,0.20,0.14);

// screen-space hatching at an angle; fc in pixels, period in pixels
float hatch(vec2 fc, float ang, float period){
  float v = abs(fract(dot(fc, vec2(cos(ang), sin(ang)))/period) - 0.5)*2.0;
  return smoothstep(0.5, 0.72, v);
}
// the darker the tone, the more layers of hatching
float inkFromLum(float lum, vec2 fc, float k){
  float i = 0.0;
  if (lum < 0.78) i = max(i, hatch(fc, 0.6, 7.0*k));
  if (lum < 0.52) i = max(i, hatch(fc, -0.75, 7.0*k));
  if (lum < 0.28) i = max(i, hatch(fc, 1.57, 4.0*k));
  return i;
}
vec3 sky_chart(vec3 rd, vec2 fc, float k){
  float ink = 0.0;
  float ang = acos(clamp(dot(rd, uSun), -1.0, 1.0));
  vec3 rt = normalize(cross(vec3(0,1,0), uSun)), up = cross(uSun, rt);
  float az = atan(dot(rd, up), dot(rd, rt));
  ink = max(ink, 1.0 - smoothstep(0.0, 0.006, abs(ang - 0.16)));
  ink = max(ink, 1.0 - smoothstep(0.0, 0.004, abs(ang - 0.185)));
  float ray = 0.21 + 0.16*(0.55 + 0.45*step(0.5, fract(az*16.0/6.2832 + 0.25)));
  if (ang > 0.21 && ang < ray)
    ink = max(ink, 1.0 - smoothstep(0.0, 0.10, abs(fract(az*32.0/6.2832) - 0.5)*2.0*ang*4.0));
  if (ang < 0.16) ink = max(ink, hatch(fc, 0.6, 9.0*k)*0.6);
  vec3 c = mix(C_PAPER, C_INK, clamp(ink, 0.0, 1.0)*0.9);
  float rh = abs(fract(az*16.0/6.2832) - 0.5)*2.0;
  if (ang > 0.42) c = mix(c, C_RED, (1.0 - smoothstep(0.0, 0.012/ang, 1.0 - rh))*0.35);
  return c;
}
vec3 shade_chart(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k){
  float df = clamp(dot(n, uSun), 0.0, 1.0);
  float edge = abs(dot(n, rd));
  float ink = 0.0;
  vec3 tint = C_INK;
  if (id < 1.5) {
    vec2 w = W(p); float s = sea(w);
    vec3 mk = seaMarks(p, w, t);
    float v = w.y*2.6 + s*7.0 + 0.4*sin(w.x*1.7);
    ink = lineAt(v, fwidth(v))*0.85*exp(-t*0.03);
    if (mk.z > -0.22) {
      float stipple = step(0.55, hash(floor(fc/(2.5*k))));
      ink = max(ink, stipple*smoothstep(-0.22, -0.05, mk.z));
    }
    if (mk.z > -0.035 || mk.y > 0.5) ink = 1.0;
    ink = max(ink, inkFromLum(0.55 + df*0.6, fc, k)*0.5*exp(-t*0.08));
    if (mk.x > 0.5) { ink = 1.0; tint = C_RED; }
  } else if (id < 2.5) {
    ink = inkFromLum(0.12 + df*0.95, fc, k);
    if (edge < 0.22) ink = 1.0;
  } else if (id > 9.5) {
    vec4 lm = lightMarks(id, p);
    ink = lm.x > 0.5 ? 0.0 : 1.0;
    if (edge < 0.3) ink = 1.0;
    if (lm.w > 0.5) { ink = 1.0; if (lm.y > 0.5) tint = C_RED; }
  } else if (id < 3.5) {
    ink = inkFromLum(0.2 + df*0.3, fc, k);
    if (q.y > 0.13 && q.y < 0.2) ink = 0.0;
    if (edge < 0.3) ink = 1.0;
  } else if (id > 4.5 && id < 5.5) {
    ink = 1.0;
  } else if (id > 6.5) {
    ink = 1.0; tint = C_RED;
  } else {
    ink = inkFromLum(0.62 + 0.5*abs(dot(n, uSun)), fc, k)*0.8;
    ink = max(ink, lineAt(q.y*2.5, fwidth(q.y*2.5))*0.6);
    if (edge < 0.16) ink = 1.0;
  }
  vec3 c = mix(C_PAPER, tint, clamp(ink, 0.0, 1.0)*0.92);
  if (id > 5.5 && id < 6.5) c = mix(c, C_RED, 0.25);
  return mix(c, C_PAPER, smoothstep(30.0, 70.0, t));
}
vec3 post_chart(vec3 col, vec3 rd, vec2 fc, float k){
  col *= 0.95 + 0.07*noise(fc*0.35/k);
  col *= 1.0 - 0.35*pow(length((fc/uRes - 0.5)*vec2(1.1, 1.3)), 2.5);
  if (abs(rd.y) < 0.0016) col = mix(col, C_INK, 0.8);
  return col;
}
`,
};
