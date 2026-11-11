// View 0, the Riviera poster: flat colour, hard bands, no gradients.

export const poster = {
  id: 'poster',
  glsl: /* glsl */ `
const vec3 NAVY = vec3(0.071,0.188,0.290), CREAM = vec3(1.0,0.957,0.863);
const vec3 CORAL = vec3(0.937,0.416,0.298), ORANGE = vec3(0.961,0.541,0.235);
const vec3 AMBER = vec3(0.976,0.722,0.290), YELLOW = vec3(0.984,0.851,0.478);
const vec3 TEAL = vec3(0.059,0.431,0.478), TEAL2 = vec3(0.090,0.537,0.604);
const vec3 SUNC = vec3(1.0,0.945,0.788), RUST = vec3(0.659,0.196,0.102);
const vec3 PINE = vec3(0.055,0.275,0.290), LEAF = vec3(0.180,0.490,0.400);
const vec3 SHOAL = vec3(0.330,0.690,0.660), INK = vec3(0.027,0.082,0.141);
const vec3 SLATE = vec3(0.070,0.170,0.240), SMOKE = vec3(0.330,0.300,0.380);

vec3 sky_poster(vec3 rd, vec2 fc, float k){
  float y = rd.y + 0.05*uEnd;
  vec3 c = y > 0.46 ? CORAL : y > 0.28 ? ORANGE : y > 0.13 ? AMBER : YELLOW;
  if (dot(rd, uSun) > 0.982 - 0.012*uEnd) c = SUNC;
  return c;
}
// distance in flat steps: far things fade into the colour of the horizon, a band at a time
vec3 hazed_poster(vec3 c, float t){
  return mix(c, mix(YELLOW, CORAL, 0.25), floor(haze(t)*5.0 + 0.5)/5.0*0.9);
}
vec3 shade_poster(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k){
  float df = dot(n, uSun);
  if (id < 1.5) {
    vec4 mk = seaMarks(p, t);
    float sp = pow(max(dot(reflect(rd, n), uSun), 0.0), 24.0);
    if (mk.w > 0.5) {
      // in the cave: black water that catches the lamp and the daylight at the mouth
      vec2 cl = caveLight(p, n);
      vec3 l = normalize(uCaveLamp - p);
      vec3 c = cl.x > 0.6 ? TEAL : cl.x > 0.2 ? SLATE*1.3 : cl.y > 0.2 ? RUST*0.3 : cl.x > 0.06 ? SLATE*0.8 : INK;
      if (dot(n.xz, l.xz) > 0.05) c = cl.y > 0.3 ? ORANGE : cl.y > 0.1 ? RUST : cl.y > 0.03 ? RUST*0.5 : c;
      if (mk.z > -0.07) c = cl.y > 0.2 ? AMBER : cl.x > 0.3 ? CREAM : SMOKE;
      if (mk.y > 0.5) c = cl.x + cl.y > 0.3 ? CREAM : SMOKE;
      return c;
    }
    vec3 c = TEAL;
    if (dot(n.xz, uSun.xz) > 0.07) c = TEAL2;
    c = mix(c, TEAL, smoothstep(25.0, 60.0, t)*0.7);
    if (mk.x > 0.5) c = SHOAL;
    else if (mk.x > 0.02) c = TEAL2;
    if (sp > 0.5) c = SUNC;
    if (mk.z > -0.06 || mk.y > 0.5) c = CREAM;
    return hazed_poster(c, t);
  }
  if (id < 2.5) {
    vec4 lm = landMarks(p, t);
    vec3 c = df < 0.05 ? NAVY : df < 0.5 ? RUST : ORANGE;
    // cliffs show their strata
    if (n.y < 0.62 && df > 0.05 && fract(p.y*0.33 + 0.7*noise(p.xz*0.12)) < 0.22) c = df < 0.5 ? NAVY : RUST;
    if (lm.z > 1.5) c = df < 0.3 ? INK : RUST;
    else if (lm.z > 0.5 && n.y > 0.93) c = df < 0.0 ? AMBER : SUNC;
    if (lm.x > 0.0) c = df < 0.12 ? PINE : (lm.x > 0.86 ? YELLOW : LEAF);
    if (lm.y > 0.5) { float b = fract(lm.w); c = b < 0.34 ? YELLOW : b < 0.67 ? ORANGE : CORAL; }
    return hazed_poster(c, t);
  }
  if (id > 9.5) {
    vec4 lm = lightMarks(id, p);
    if (lm.w > 0.5) return lm.y > 0.5 ? (lm.z > 0.5 ? YELLOW : SUNC) : NAVY;
    vec3 c = lm.x > 0.5 ? CREAM : (lm.z > 0.5 ? NAVY : CORAL);
    return hazed_poster(df < 0.0 ? c*0.86 : c, t);
  }
  if (id > 8.5) {
    // the plume: dark smoke, the low sun on one side, the lava's glow from below
    vec3 c = df > 0.25 ? CORAL : df > -0.2 ? SMOKE : NAVY;
    if (q.x < 0.22 && n.y < 0.15 - q.x*3.0) c = q.x < 0.1 ? YELLOW : ORANGE;
    return hazed_poster(c, t);
  }
  if (id > 7.5) {
    vec2 cl = caveLight(p, n);
    float strata = step(0.5, fract(p.y*0.4 + 0.6*noise(p.xz*0.3)));
    vec3 c = INK*0.6;
    if (cl.x > 0.06) c = INK*1.5;
    if (cl.x > 0.2) c = SLATE;
    if (cl.x > 0.5) c = SLATE*1.45;
    if (cl.y > 0.035) c = RUST*0.36;
    if (cl.y > 0.1) c = RUST*0.62;
    if (cl.y > 0.25) c = RUST;
    if (cl.y > 0.5) c = ORANGE;
    if (cl.y > 0.78) c = AMBER;
    return strata > 0.5 ? c : mix(c, INK, 0.3);
  }
  if (id < 3.5) return (q.y > 0.13 && q.y < 0.2) ? YELLOW : NAVY;
  if (id < 4.5) return (q.y > 1.05 && q.y < 1.35) ? CORAL : CREAM;
  if (id < 5.5) return NAVY;
  if (id < 6.5) return CORAL;
  return YELLOW;
}
vec3 post_poster(vec3 col, vec3 rd, vec2 fc, float k){ return col; }
`,
};
