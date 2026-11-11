// View 2, Secession gold: a black sea with gold highlights, mosaic islands, an ornamental sun.

export const gold = {
  id: 'gold',
  glsl: /* glsl */ `
const vec3 G_BG = vec3(0.055,0.055,0.051), G_GOLD = vec3(0.831,0.682,0.353);
const vec3 G_IVORY = vec3(0.945,0.925,0.878), G_BRONZE = vec3(0.45,0.33,0.12);
const vec3 G_GREEN = vec3(0.105,0.200,0.115);

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
// the side of a tile: it doubles with distance, so the mosaic never turns to glitter
float tile_gold(float t){ return 0.9*exp2(floor(log2(max(t/45.0, 1.0)))); }
vec3 shade_gold(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k){
  float df = dot(n, uSun);
  float lit = clamp(df*0.5 + 0.5, 0.0, 1.0);
  float sp = pow(max(dot(reflect(rd, n), uSun), 0.0), 60.0);
  vec3 c;
  if (id < 1.5) {
    float s = sea(p.xz)*16.0;
    vec4 mk = seaMarks(p, t);
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
    float l = lineAt(s, fwidth(s));
    c = G_BG + G_GOLD*(sp*1.6 + fres*0.45 + l*0.55*exp(-t*0.05));
    if (mk.w > 0.5) {
      vec2 cl = caveLight(p, n);
      c = G_BG*0.6 + G_GOLD*l*(0.15 + cl.x*0.5 + cl.y*2.0);
      if (mk.z > -0.07) c = G_BRONZE*(0.5 + cl.x + cl.y*2.0);
    } else {
      if (mk.x > 0.3 && hash(floor(p.xz*1.3)) > 0.72) c += G_BRONZE*0.7;   // shoal: bronze flecks
      if (mk.z > -0.05) c = G_GOLD;
    }
    if (mk.y > 0.5) c = G_IVORY;
  } else if (id < 2.5) {
    vec4 lm = landMarks(p, t);
    float side = tile_gold(t);
    c = goldMosaic(vec2(p.x + p.z*0.37, p.y*1.6 + p.z*0.9)/side, df) + G_GOLD*sp*0.6;
    if (lm.x > 0.0) {
      // woods: dark green tiles, a leaf of gold at the top of each fir
      vec2 u = vec2(p.x + p.z*0.37, p.y*1.6 + p.z*0.9)*1.6/side;
      vec2 f = abs(fract(u) - 0.5);
      c = mix(G_GREEN, G_BRONZE, 0.25*hash(floor(u)))*(0.6 + 0.8*lit);
      if (max(f.x, f.y) > 0.42) c = G_BG;
      if (lm.x > 0.84) c = G_GOLD;
    }
    if (lm.y > 0.5) c = fract(lm.w) < 0.5 ? G_IVORY : G_GOLD;
  } else if (id > 9.5) {
    vec4 lm = lightMarks(id, p);
    if (lm.w > 0.5) c = lm.y > 0.5 ? G_IVORY : G_GOLD*0.5;
    else c = (lm.x > 0.5 ? G_IVORY : (lm.z > 0.5 ? G_BRONZE : G_GOLD))*(0.6 + 0.4*lit) + sp*0.5;
  } else if (id > 8.5) {
    // the plume: ivory tesserae scattered on the black, gold where the lava lights it
    vec2 u = vec2(atan(n.x, n.z)*5.0, n.y*6.0) + q.x*40.0;
    vec2 f = abs(fract(u) - 0.5);
    c = G_BG*1.6;
    if (max(f.x, f.y) < 0.33) c = (q.x < 0.16 ? G_GOLD : G_IVORY)*(0.3 + 0.5*lit)*(0.5 + 0.5*hash(floor(u)));
  } else if (id > 7.5) {
    vec2 cl = caveLight(p, n);
    vec2 u = vec2(p.x + p.z, p.y*1.4)*0.9;
    vec2 f = abs(fract(u) - 0.5); float h = hash(floor(u));
    c = (h < 0.5 ? G_BRONZE : h < 0.8 ? G_GOLD : G_IVORY)*(0.04 + 0.25*cl.x + 2.2*cl.y);
    if (max(f.x, f.y) > 0.44) c = G_BG*0.5;
  } else if (id < 3.5) {
    c = G_GOLD*(0.55 + 0.45*lit);
    vec2 f = abs(fract(vec2(q.z*5.0, q.y*5.0)) - 0.5);
    if (q.y > 0.0 && q.y < 0.2 && max(f.x, f.y) < 0.28) c = G_BG;
    c += sp;
  } else if (id < 4.5) {
    vec3 s = sailLocal(q);
    vec2 u = s.zy*5.0; vec2 f = abs(fract(u) - 0.5); float h = hash(floor(u));
    c = G_IVORY;
    if (h > 0.72 && max(f.x, f.y) < 0.36) c = h > 0.9 ? G_BG : G_GOLD;
    c *= 0.72 + 0.28*clamp(abs(df) + 0.3, 0.0, 1.0);
  } else if (id < 5.5) {
    c = G_GOLD;
  } else {
    c = G_GOLD*(0.6 + 0.4*clamp(abs(df) + 0.3, 0.0, 1.0)) + sp;
  }
  return mix(c, G_BG + G_GOLD*0.3, haze(t)*0.85);
}
vec3 post_gold(vec3 col, vec3 rd, vec2 fc, float k){ return col; }
`,
};
