// View 1, the Tractatus terminal: a green wireframe on near-black, with scanlines.

export const terminal = {
  id: 'terminal',
  glsl: /* glsl */ `
const vec3 T_BG = vec3(0.02,0.031,0.039), T_GREEN = vec3(0.494,0.878,0.631);
const vec3 T_AMBER = vec3(0.941,0.702,0.353);

vec3 sky_terminal(vec3 rd, vec2 fc, float k){
  vec3 c = T_BG;
  vec2 g = floor(vec2(atan(rd.x, rd.z)*150.0, rd.y*300.0));
  if (rd.y > 0.02 && hash(g) > 0.9975) c += 0.6;
  if (dot(rd, uSun) > 0.975 && fract(rd.y*46.0) > 0.4) c = T_AMBER*0.85;
  c += T_GREEN*0.10*exp(-abs(rd.y)*18.0);
  return c;
}
// lines every unit of v close by, every eight units further off
float lines_terminal(float v, float t){
  float near = lineAt(v, fwidth(v))*exp(-t*0.012);
  return max(near, lineAt(v*0.125, fwidth(v*0.125))*exp(-t*0.0015));
}
vec3 shade_terminal(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k){
  float rim = pow(1.0 - abs(dot(n, rd)), 1.5);
  vec3 c;
  if (id < 2.5) {
    float l = max(lines_terminal(p.x*0.25, t), lines_terminal(p.z*0.25, t));
    if (id < 1.5) {
      vec4 mk = seaMarks(p, t);
      c = T_BG + T_GREEN*(l*0.95 + 0.03);
      if (mk.w < 0.5 && mk.x > 0.3) c += T_AMBER*0.16*step(0.5, fract((fc.x + fc.y)/(6.0*k)));
      if (mk.z > -0.07) c = T_BG + T_AMBER*0.8;
      if (mk.w > 0.5) c += T_AMBER*0.5*caveLight(p, n).y;
      if (mk.y > 0.5) c = vec3(0.85);
    } else {
      vec4 lm = landMarks(p, t);
      float cl = lines_terminal(p.y*0.5, t);
      c = T_BG + T_AMBER*(max(cl, l*0.4) + 0.07);
      if (lm.x > 0.0) {
        // firs: green triangles, an outline and two rungs
        float rung = lineAt(lm.x*5.0, fwidth(lm.x*5.0));
        c = T_BG + T_GREEN*(0.10 + 0.8*max(rung, smoothstep(0.45, 0.8, rim)));
      }
      if (lm.y > 0.5) c = mix(T_AMBER, vec3(1.0), step(0.5, fract(lm.w)));
    }
  } else if (id > 9.5) {
    vec4 lm = lightMarks(id, p);
    c = lm.z > 0.5 ? T_GREEN : T_AMBER;
    if (lm.w > 0.5) c = T_BG + vec3(1.0)*lm.y + c*0.3;
    else c = T_BG + c*(0.12 + 0.8*lineAt(p.y*0.6, fwidth(p.y*0.6)) + rim*0.5);
  } else if (id > 8.5) {
    float ring = lineAt(p.y*0.2, fwidth(p.y*0.2));
    c = T_BG + mix(vec3(0.55, 0.62, 0.6), T_AMBER, step(q.x, 0.15))*(0.06 + 0.7*max(ring, rim*rim));
  } else if (id > 7.5) {
    vec2 cl = caveLight(p, n);
    float strata = lineAt(p.y*0.5, fwidth(p.y*0.5));
    float rib = lineAt((p.x + p.z)*0.25, fwidth((p.x + p.z)*0.25));
    c = T_BG + T_GREEN*(0.03 + 0.5*max(strata, rib*0.6))*(0.35 + cl.x)
      + T_AMBER*(0.1 + 0.9*max(strata, rib))*cl.y*1.5;
  } else {
    c = id < 3.5 ? vec3(0.37,0.65,0.72) : id < 4.5 ? T_GREEN : id < 5.5 ? vec3(0.9) : T_AMBER;
    float l = lineAt(q.y*6.0, fwidth(q.y*6.0));
    if (id > 3.5 && (id < 4.5 || id > 5.5)) {
      float v = q.z*4.0 + q.y*2.0;
      l = max(l, lineAt(v, fwidth(v)));
    }
    c = T_BG + c*(0.10 + l*0.85 + rim*0.5);
  }
  return mix(c, T_BG + T_GREEN*0.10, haze(t)*0.85);
}
vec3 post_terminal(vec3 col, vec3 rd, vec2 fc, float k){
  return col*(0.88 + 0.12*step(0.5, fract(fc.y/(3.0*k))));
}
`,
};
