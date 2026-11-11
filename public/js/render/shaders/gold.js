// View 2, Secession gold: a black sea with gold highlights, mosaic islands, an ornamental sun.

export const gold = {
  id: 'gold',
  glsl: /* glsl */ `
const vec3 G_BG = vec3(0.055,0.055,0.051), G_GOLD = vec3(0.831,0.682,0.353);
const vec3 G_IVORY = vec3(0.945,0.925,0.878), G_BRONZE = vec3(0.45,0.33,0.12);

vec3 sky_gold(vec3 rd, vec2 fc, float k){
  vec3 c = G_BG;
  float ang = acos(clamp(dot(rd, uSun), -1.0, 1.0));
  if (ang < 0.30) c = fract(ang*34.0) > 0.32 ? G_GOLD : G_BG;
  else if (rd.y > 0.03) {
    vec2 g = vec2(atan(rd.x, rd.z)*9.0, rd.y*16.0); vec2 f = abs(fract(g) - 0.5);
    if (hash(floor(g)) > 0.95 && max(f.x, f.y) < 0.2) c = G_GOLD*0.9;
  }
  c += G_GOLD*0.35*exp(-abs(rd.y)*30.0);
  return c;
}
vec3 goldMosaic(vec2 u, float df){
  vec2 f = abs(fract(u) - 0.5); float h = hash(floor(u));
  vec3 c = h < 0.45 ? G_GOLD : h < 0.65 ? G_BRONZE : h < 0.82 ? G_IVORY : vec3(0.10,0.10,0.09);
  c *= 0.5 + 0.5*clamp(df*0.5 + 0.5, 0.0, 1.0);
  if (max(f.x, f.y) > 0.44) c = G_BG;
  return c;
}
vec3 shade_gold(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k){
  float df = dot(n, uSun);
  float lit = clamp(df*0.5 + 0.5, 0.0, 1.0);
  float sp = pow(max(dot(reflect(rd, n), uSun), 0.0), 60.0);
  vec3 c;
  if (id < 1.5) {
    vec2 w = W(p); float s = sea(w)*16.0;
    vec3 mk = seaMarks(p, w, t);
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
    float l = lineAt(s, fwidth(s));
    c = G_BG + G_GOLD*(sp*1.6 + fres*0.45 + l*0.55*exp(-t*0.05));
    if (mk.z > -0.05 || mk.x > 0.5) c = G_GOLD;
    if (mk.y > 0.5) c = G_IVORY;
  } else if (id < 2.5) {
    vec2 w = W(p);
    c = goldMosaic(vec2(w.x + w.y*0.37, p.y*1.6 + w.y*0.9)*2.6, df) + G_GOLD*sp*0.6;
  } else if (id > 9.5) {
    vec4 lm = lightMarks(id, p);
    if (lm.w > 0.5) c = lm.y > 0.5 ? G_IVORY : G_GOLD*0.5;
    else c = (lm.x > 0.5 ? G_IVORY : (lm.z > 0.5 ? G_BRONZE : G_GOLD))*(0.6 + 0.4*lit) + sp*0.5;
  } else if (id < 3.5) {
    c = G_GOLD*(0.55 + 0.45*lit);
    vec2 f = abs(fract(vec2(q.z*5.0, q.y*5.0)) - 0.5);
    if (q.y > 0.0 && q.y < 0.2 && max(f.x, f.y) < 0.28) c = G_BG;
    c += sp;
  } else if (id < 4.5) {
    vec2 u = q.zy*5.0; vec2 f = abs(fract(u) - 0.5); float h = hash(floor(u));
    c = G_IVORY;
    if (h > 0.72 && max(f.x, f.y) < 0.36) c = h > 0.9 ? G_BG : G_GOLD;
    c *= 0.72 + 0.28*clamp(abs(df) + 0.3, 0.0, 1.0);
  } else if (id < 5.5) {
    c = G_GOLD;
  } else {
    c = G_GOLD*(0.6 + 0.4*clamp(abs(df) + 0.3, 0.0, 1.0)) + sp;
  }
  return mix(c, G_BG + G_GOLD*0.3, smoothstep(60.0, 300.0, t));
}
vec3 post_gold(vec3 col, vec3 rd, vec2 fc, float k){ return col; }
`,
};
