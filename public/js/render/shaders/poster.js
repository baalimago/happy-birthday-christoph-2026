// View 0, the Riviera poster: flat colour, hard bands, no gradients.

export const poster = {
  id: 'poster',
  glsl: /* glsl */ `
const vec3 NAVY = vec3(0.071,0.188,0.290), CREAM = vec3(1.0,0.957,0.863);
const vec3 CORAL = vec3(0.937,0.416,0.298), ORANGE = vec3(0.961,0.541,0.235);
const vec3 AMBER = vec3(0.976,0.722,0.290), YELLOW = vec3(0.984,0.851,0.478);
const vec3 TEAL = vec3(0.059,0.431,0.478), TEAL2 = vec3(0.090,0.537,0.604);
const vec3 SUNC = vec3(1.0,0.945,0.788), RUST = vec3(0.659,0.196,0.102);

vec3 sky_poster(vec3 rd, vec2 fc, float k){
  float y = rd.y + 0.05*uEnd;
  vec3 c = y > 0.46 ? CORAL : y > 0.28 ? ORANGE : y > 0.13 ? AMBER : YELLOW;
  if (dot(rd, uSun) > 0.982 - 0.012*uEnd) c = SUNC;
  return c;
}
vec3 shade_poster(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k){
  float df = dot(n, uSun);
  if (id < 1.5) {
    vec3 mk = seaMarks(p, W(p), t);
    float sp = pow(max(dot(reflect(rd, n), uSun), 0.0), 24.0);
    vec3 c = TEAL;
    if (dot(n.xz, uSun.xz) > 0.07) c = TEAL2;
    if (sp > 0.5) c = SUNC;
    if (mk.z > -0.06 || mk.y > 0.5) c = CREAM;
    if (mk.x > 0.5) c = YELLOW;
    return mix(c, TEAL, smoothstep(25.0, 60.0, t)*0.7);
  }
  if (id < 2.5) {
    if (p.y < 0.14) return SUNC;
    return df < 0.05 ? NAVY : df < 0.5 ? RUST : ORANGE;
  }
  if (id > 9.5) {
    vec4 lm = lightMarks(id, p);
    if (lm.w > 0.5) return lm.y > 0.5 ? (lm.z > 0.5 ? YELLOW : SUNC) : NAVY;
    vec3 c = lm.x > 0.5 ? CREAM : (lm.z > 0.5 ? NAVY : CORAL);
    return df < 0.0 ? c*0.86 : c;
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
