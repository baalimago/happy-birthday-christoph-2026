// View 3, the engraved chart: a hand-tinted copperplate. Form is cut in sepia lines that lie on the
// surfaces themselves (so they stay put when the camera moves) and swell where the light fails;
// thin watercolour washes are laid over the paper under the ink; red is kept for what matters.
//
// Every family of lines is a set of level surfaces of some coordinate v of the world (or of the
// boat). burin() draws them at a spacing that is constant on the screen by choosing the period
// from how fast v changes per pixel, a power of two at a time: when the camera closes in, every
// second line grows out of nothing between its neighbours, and none of them slides.

export const chart = {
  id: 'chart',
  glsl: /* glsl */ `
const vec3 C_PAPER = vec3(0.930,0.884,0.752), C_INK = vec3(0.180,0.128,0.086);
const vec3 C_RED = vec3(0.66,0.19,0.12);

// lines where v crosses multiples of a period; fw = change of v per pixel, sp = spacing and
// w = half the width of a line, both in pixels
float burin(float v, float fw, float sp, float w){
  fw = max(fw, 1e-6);
  float l = log2(fw*sp), l0 = floor(l), f = l - l0, P = exp2(l0);
  float x = v/P, i = floor(x + 0.5);
  float d = abs(x - i)*P/fw;
  w *= 1.0 - mod(i, 2.0)*smoothstep(0.1, 0.9, f);      // the lines in between taper away
  return (1.0 - smoothstep(w - 0.6, w + 0.6, d))*smoothstep(0.0, 0.4, w);
}
// how fast the coordinate dot(p, a) changes per pixel, from the derivatives of p
float perPx(vec3 a, vec3 dx, vec3 dy){ return length(vec2(dot(dx, a), dot(dy, a))); }
// two crossing families of lines on a surface; D is how dark the tone is, 0..1
float engrave(vec3 p, vec3 dx, vec3 dy, vec3 a, vec3 b, float sp, float k, float D){
  float wob = 0.4*noise(p.xz*0.8 + p.y*0.6);
  float i = burin(dot(p, a) + wob, perPx(a, dx, dy), sp, k*1.9*smoothstep(0.08, 0.8, D));
  return max(i, burin(dot(p, b) - wob, perPx(b, dx, dy), sp, k*1.3*smoothstep(0.45, 0.95, D)));
}
// dots scattered on the plane w (world x, z), at a density that is constant on the screen
float stip1(vec2 w, float P, float fw, float dens, float r){
  vec2 g = w/P, c = floor(g);
  float h = hash(c);
  vec2 o = g - c - 0.5 - (vec2(fract(h*13.7), fract(h*71.3)) - 0.5)*0.7;
  return step(fract(h*5.3), dens)*(1.0 - smoothstep(r - 0.6, r + 0.6, length(o)*P/fw));
}
float stipple(vec2 w, float fw, float sp, float dens, float r){
  fw = max(fw, 1e-6);
  float l = log2(fw*sp), l0 = floor(l), P = exp2(l0);
  return mix(stip1(w, P, fw, dens*0.5, r), stip1(w + 31.0, 2.0*P, fw, dens, r), l - l0);
}
// Ink at a step in depth, on the nearer side only; ndv: how squarely the surface faces the eye.
// Derivatives are differences inside a 2 x 2 block of pixels: the parity of the pixel tells which
// of the two this one is, and so whether its neighbour lies behind it.
float contour(float t, float ndv, vec2 fc){
  vec2 sgn = 1.0 - 2.0*mod(floor(fc), 2.0);
  vec2 dt = vec2(dFdx(t), dFdy(t))*sgn, dg = vec2(dFdx(gHit), dFdy(gHit))*sgn;
  float e = smoothstep(2.5, 6.0, max(dt.x, dt.y)*max(ndv, 0.06)*uRes.y/(0.8*t));
  // where two things touch, the line belongs to the one that stands on the other
  if (gHit > 2.5 && ((dg.x < -0.5 && dt.x > -0.02*t) || (dg.y < -0.5 && dt.y > -0.02*t))) e = 1.0;
  return e;
}
// The outline of the land: a pixel is on a silhouette when the ground curves away from the ray
// fast enough that the next ray out misses it. One more height, taken a little further along.
float landRim(vec3 p, vec3 n, vec3 rd, float t, float lod){
  float px = t*0.8/uRes.y, ndv = dot(n, rd);
  vec3 tau = rd - n*ndv;
  float tl = length(tau);
  if (tl < 1e-3) return 0.0;
  float s = max(2.5*px, 0.04);
  vec3 x = p + tau/tl*s;
  float kap = 2.0*max((x.y - landH(x.xz, lod))*n.y, 0.0)/(s*s);
  return 1.0 - smoothstep(0.6, 1.4, ndv*ndv/max(min(2.6*kap*px, 0.3), 1e-6));
}
// The outline of a thing given as a distance field (0 the boat, else port + 1): where the field a
// pixel to the side is further off than a flat surface would have it, there is an edge.
float fieldAt(int what, vec3 x){ return what == 0 ? boat(x).x : propD(what - 1, x); }
float fieldRim(int what, vec3 x, vec3 d, vec3 n, float off){
  vec3 u = normalize(cross(d, vec3(0.0, 1.0, 0.0))), v = cross(u, d);
  float d0 = fieldAt(what, x), e = 0.0;
  for (int i = 0; i < 4; i++) {
    vec3 o = (i < 2 ? u : v)*((i & 1) == 0 ? off : -off);
    e = max(e, fieldAt(what, x + o) - d0 - dot(o, n));
  }
  return smoothstep(0.3, 0.7, e/off);
}
// the rim of a rounded thing, a pixel or two wide
float rim(float ndv, float k){ return 1.0 - smoothstep(1.0, 2.2, ndv/max(fwidth(ndv), 1e-4)/k); }

// the wash of the sky in a direction (a tint the paper is multiplied by)
vec3 skyWash(vec3 rd){
  float y = clamp(rd.y, 0.0, 1.0);
  vec3 w = mix(vec3(0.985,0.965,0.925), vec3(0.74,0.855,0.915), smoothstep(0.0, 0.75, y));
  w = mix(w, vec3(0.90,0.80,0.86), uEnd*0.7*smoothstep(0.03, 0.6, y));
  w = mix(w, vec3(1.0,0.72,0.52), uEnd*0.85*exp(-y*7.0));
  float s = max(dot(rd, uSun), 0.0);
  return mix(w, mix(vec3(1.0,0.93,0.74), vec3(1.0,0.68,0.46), uEnd), pow(s, 5.0)*(0.55 - 0.15*uEnd));
}
// the cave's lamp as a wash over w: a red-brown that warms to amber and pales by the flame
vec3 lampWash(vec3 w, float g){
  w = mix(w, vec3(0.62,0.31,0.21), smoothstep(0.02, 0.26, g));
  w = mix(w, vec3(1.0,0.60,0.29), smoothstep(0.24, 0.62, g));
  return mix(w, vec3(1.0,0.87,0.58), smoothstep(0.6, 1.0, g)*0.8);
}
// paper, wash, ink; distance pales both (aerial perspective)
vec3 plate(vec3 wash, float ink, vec3 inkCol, float t){
  float far = max(haze(t), 1.0 - exp(-t/750.0));
  wash = mix(wash, vec3(0.90,0.925,0.93), far*0.8);
  return mix(C_PAPER*wash, inkCol, clamp(ink, 0.0, 1.0)*(0.93 - 0.68*far));
}

vec3 sky_chart(vec3 rd, vec2 fc, float k){
  vec3 wash = skyWash(rd);
  float y = max(rd.y, 0.0), el = asin(clamp(rd.y, -1.0, 1.0));
  // clouds on a ceiling far overhead, drifting with the wind
  vec2 cu = (rd.xz/(y + 0.22)*1.5 - uWind.xy*uT*0.004)*vec2(0.55, 1.5);
  vec2 ls = normalize(uSun.xz)*0.22;
  float c = 0.62*noise(cu) + 0.38*noise(cu*2.3 + 5.0);
  float c2 = 0.62*noise(cu + ls) + 0.38*noise(cu*2.3 + ls*2.3 + 5.0);
  float body = smoothstep(0.50, 0.64, c)*smoothstep(0.02, 0.12, y);
  float under = body*smoothstep(0.0, 0.16, c - c2)*smoothstep(0.9, 0.3, y);       // the side away from the sun
  wash = mix(wash, vec3(1.0,0.99,0.96), body*0.8);
  wash *= mix(vec3(1.0), mix(vec3(0.80,0.82,0.88), vec3(0.90,0.70,0.66), uEnd), under*0.6);

  // the sun: an engraved disc, a ring and fine rays
  float ang = acos(clamp(dot(rd, uSun), -1.0, 1.0)), fa = max(fwidth(ang), 1e-5);
  vec3 rt = normalize(cross(vec3(0,1,0), uSun)), up = cross(uSun, rt);
  float az = atan(dot(rd, up), dot(rd, rt))/6.2832;
  float R = 0.062;
  float near = 1.0 - smoothstep(R, R*4.5, ang);

  // the air: fine level lines that swell under the clouds and break off around them
  float v = el*175.0 + 2.2*c;
  float dash = noise(vec2(atan(rd.x, rd.z)*9.0 + c*3.0, floor(v + 0.5)*7.3));
  float w = k*(0.10 + 0.55*smoothstep(0.03, 0.7, y))*smoothstep(0.30, 0.62, dash);
  w = mix(w, 0.0, body);
  w = max(w, k*0.75*under*smoothstep(0.2, 0.6, dash + 0.25));
  w *= (1.0 - near)*smoothstep(0.0, 0.05, y);
  float ink = burin(v, fwidth(el)*175.0, 5.0*k, w)*(0.8 - 0.25*under);
  // the outline of a cloud, a broken line on its sunlit side and a firm one below
  float fcl = max(fwidth(c), 1e-5);
  float lip = (1.0 - smoothstep(0.5*k, 1.6*k, abs(c - 0.57)/fcl))*smoothstep(0.03, 0.12, y);
  ink = max(ink, lip*(0.12 + 0.6*smoothstep(-0.01, 0.05, c - c2))*smoothstep(0.25, 0.5, dash + 0.4*under)*(1.0 - near));

  float sun = 1.0 - smoothstep(0.6*k, 1.6*k, abs(ang - R)/fa);
  sun = max(sun, (1.0 - smoothstep(0.2*k, 1.1*k, abs(ang - R*1.22)/fa))*0.7);
  float n32 = az*32.0, ri = floor(n32 + 0.5);
  float len = R*(mod(ri, 2.0) < 0.5 ? (mod(ri, 4.0) < 0.5 ? 4.2 : 3.1) : 2.3);
  float along = clamp((ang - R*1.45)/(len - R*1.45), 0.0, 1.0);
  float rayD = abs(n32 - ri)/32.0*6.2832*sin(ang)/fa;      // pixels from the ray's centre line
  if (ang > R*1.45 && ang < len) sun = max(sun, (1.0 - smoothstep(0.0, 1.2, rayD - k*(1.0 - along)))*0.85);
  // the disc itself: left bare but for a few strokes across its lower half
  if (ang < R) {
    wash = mix(wash, mix(vec3(1.0,0.90,0.62), vec3(1.0,0.56,0.36), uEnd), 0.75);
    float sv = dot(rd, up)/R;
    sun = max(sun, burin(dot(rd, up)*175.0, fa*175.0, 4.0*k, k*0.9*smoothstep(0.1, -0.9, sv))*0.7);
  }
  ink = max(ink, sun);
  // the horizon, where the sky meets the sea
  ink = max(ink, (1.0 - smoothstep(0.4*k, 1.5*k, abs(rd.y)/max(fwidth(rd.y), 1e-6)))*0.55);
  vec3 col = mix(C_PAPER*wash, C_INK, clamp(ink, 0.0, 1.0)*0.8);
  return mix(col, C_RED, sun*step(R*1.45, ang)*0.25*uEnd);
}

vec3 shade_chart(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k){
  vec3 dx = dFdx(p), dy = dFdy(p), qx = dFdx(q), qy = dFdy(q);
  float sp = 5.0*k;
  float sun = dot(n, uSun), ndv = abs(dot(n, rd));
  // how light the surface is: the low sun, and the sky on what faces up
  float tone = clamp(0.30 + 0.75*max(sun, 0.0) - 0.25*max(-sun, 0.0) + 0.25*n.y, 0.0, 1.0);
  float D = 1.0 - tone;
  float edge = contour(t, id < 1.5 ? -rd.y : ndv, fc);
  float px = t*0.8/uRes.y;                                  // the size of a pixel out there
  float ink = 0.0;
  vec3 wash = vec3(1.0), tint = C_INK;
  // washes are never quite even: the pigment pools, and settles in the grain of the paper
  float pool = 0.75 + 0.5*noise(p.xz*0.07 + p.y*0.05) + 0.16*(noise(fc*0.6/k) - 0.5);

  if (id < 1.5) {
    vec4 mk = seaMarks(p, t);
    vec2 wd = uWind.xy, wc = vec2(-wd.y, wd.x), d = p.xz - uPos;
    float lee = clamp(0.5 - 3.0*dot(n.xz, normalize(uSun.xz)), 0.0, 1.0);
    // wave lines: four to a swell close by, and they ride with it
    float v = (dot(d, wd)*0.85 + uWave.x)*0.6366 + 0.45*noise(p.xz*0.11) + 0.3*sin(dot(p.xz, wc)*0.3);
    float fw = length(vec2(dFdx(v), dFdy(v)));
    float dash = noise(vec2(dot(p.xz, wc)*0.24, v*0.8));
    float seaSp = sp*(1.25 + t/55.0);
    float lw = k*(0.30 + 1.0*lee)*smoothstep(0.22, 0.6, dash + 0.3*lee)*(0.12 + 0.88*exp(-t/120.0));
    if (mk.w > 0.5) {
      // in the cave: black water under a dark wash; the lamp and the mouth lie on it as light
      vec2 cl = caveLight(p, n);
      vec3 l = normalize(uCaveLamp - p);
      float glint = pow(max(dot(reflect(rd, n), l), 0.0), 6.0);
      float L = clamp(cl.x*0.85 + cl.y*0.9 + glint*cl.y*2.5, 0.0, 1.0);
      float dk = 1.0 - L;
      ink = burin(v*1.5, fw*1.5, sp*0.9, k*(0.5 + 1.5*dk));
      ink = max(ink, burin(dot(p.xz, wc)*1.3 + 0.6*v, perPx(vec3(wc.x, 0.0, wc.y)*1.3, dx, dy), sp*1.6, k*1.4*smoothstep(0.55, 0.95, dk)));
      wash = mix(vec3(0.40,0.33,0.30), vec3(0.74,0.88,0.86), smoothstep(0.0, 0.8, cl.x));
      wash = lampWash(wash, cl.y*0.8 + glint*cl.y*2.0);
      if (mk.z > -0.07) { ink = max(ink, 0.6); wash = mix(wash, vec3(1.0), 0.5*L); }
    } else {
      float h = mk.z + p.y;                                 // the sea bed, below zero
      float deep = smoothstep(-0.3, -7.0, h)*(1.0 - 0.55*mk.x);
      wash = mix(vec3(0.86,0.955,0.895), vec3(0.665,0.835,0.835), deep);
      wash *= (1.0 - 0.07*lee)*mix(vec3(1.0), vec3(1.0,0.90,0.84), uEnd*0.6);
      // the sky lies on the water where it is seen at a low angle; the sun leaves a bare path
      float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
      vec3 rf = reflect(rd, n); rf.y = abs(rf.y);
      wash = mix(wash, skyWash(rf)*vec3(0.90,0.96,0.97), fres*0.75);
      float glit = pow(max(dot(rf, uSun), 0.0), 60.0)*step(0.5, noise(p.xz*vec2(0.9, 0.35) + uT*0.7) + 0.25);
      wash = mix(wash, mix(vec3(1.0,0.98,0.90), vec3(1.0,0.74,0.52), uEnd), glit*0.9);
      ink = burin(v, fw, seaSp, lw)*(1.0 - 0.8*glit)*0.9*exp(-t/900.0);
      // shoals are stippled, as on any chart, and the water by a shore
      float shallow = max(smoothstep(-0.9, -0.1, mk.z), mk.x*0.8);
      if (shallow > 0.01) {
        float area = sqrt(abs(dx.x*dy.z - dx.z*dy.x));
        ink = max(ink*(1.0 - 0.6*shallow), stipple(p.xz, area, 4.4*k, 0.75*shallow, 0.85*k)*0.85);
        // and lined: the shore line repeated out to sea
        float fz = max(fwidth(mk.z), 1e-5), near = exp(-t/260.0);
        ink = max(ink, (1.0 - smoothstep(0.3*k, 1.3*k, abs(mk.z + 0.40)/fz))*0.60*near);
        ink = max(ink, (1.0 - smoothstep(0.2*k, 1.2*k, abs(mk.z + 0.95)/fz))*0.40*near);
        float surf = smoothstep(-0.22, -0.05, mk.z);
        wash = mix(wash, vec3(1.0), surf*0.85);
        ink = max(ink*(1.0 - surf), 1.0 - smoothstep(0.7*k, 1.8*k, abs(mk.z + 0.03)/fz));
      }
    }
    if (mk.y > 0.5) {
      // the wake: short strokes across each arm
      wash = mix(wash, vec3(1.0), 0.8);
      vec3 hd = vec3(uHead.x, 0.0, uHead.y)*5.0;
      ink = burin(dot(d, uHead)*5.0, perPx(hd, dx, dy), 3.6*k, 0.9*k);
    }
    wash = mix(vec3(1.0), wash, clamp(pool, 0.0, 1.3));
  } else if (id < 2.5) {
    vec4 lm = landMarks(p, t);
    float lod = lodAt(t);
    vec3 a = vec3(0.78, 0.22, 0.58), b = vec3(-0.26, 1.0, 0.34);
    float steep = 1.0 - smoothstep(0.55, 0.75, n.y);
    // tints: meadow, the grey-brown of rock on cliffs and high ground, sand by the water
    vec2 vv = p.xz - uVolcano.xy;
    float ash = 1.0 - smoothstep(0.45, 1.0, length(vv)/uVolcanoR);
    wash = mix(vec3(0.86,0.90,0.68), vec3(0.83,0.76,0.67), max(max(steep, ash), smoothstep(14.0, 40.0, p.y)));
    wash = mix(wash, vec3(0.70,0.64,0.60), ash*0.6);
    ink = engrave(p, dx, dy, a, b, sp, k, D);
    if (steep > 0.0) {
      // cliffs show their strata
      float sv = p.y*0.55 + 0.9*noise(p.xz*0.12);
      ink = max(ink, burin(sv, max(fwidth(sv), 1e-5), sp*1.6, k*(0.5 + 0.7*D))*steep*0.8);
    }
    if (lm.z > 1.5) { wash = vec3(0.74,0.69,0.63); ink = max(ink, engrave(p, dx, dy, b, a, sp*0.8, k, 0.55 + 0.45*D)); }
    else if (lm.z > 0.5 && n.y > 0.9) {
      wash = vec3(1.0,0.935,0.75);
      float area = sqrt(abs(dx.x*dy.z - dx.z*dy.x));
      ink = max(ink*0.35, stipple(p.xz + 7.0, area, 5.0*k, 0.35, 0.7*k)*0.7);
    }
    if (lm.x > 0.0) {
      // woods: firs drawn tier upon tier, their shaded side hatched upright, a green wash
      float up = (lm.x - 0.5)*8.2;
      float tv = up*1.5 + 0.5*noise(p.xz*3.0);
      float tiers = burin(tv, max(fwidth(tv), 1e-5), sp*1.1, k*(0.45 + 0.9*D));
      float shade = burin(dot(p.xz, vec2(0.6, 0.8))*2.0, perPx(vec3(1.2, 0.0, 1.6), dx, dy), sp*0.8, k*1.6*smoothstep(0.45, 0.9, D));
      float area = sqrt(abs(dx.x*dy.z - dx.z*dy.x));
      float tufts = stipple(p.xz*vec2(1.0, 1.6), area, 4.6*k, 0.35 + 0.5*D, 0.9*k);
      ink = mix(max(tiers, shade), max(tufts, shade*0.7), lod);
      wash = mix(vec3(0.74,0.84,0.60), vec3(0.50,0.66,0.50), smoothstep(0.2, 0.9, D));
    }
    wash *= mix(vec3(1.0), vec3(0.80,0.79,0.84), smoothstep(0.3, 0.95, D)*0.7);   // a glaze of shadow
    edge = max(edge, landRim(p, n, rd, t, lod));
    wash *= mix(vec3(1.0), vec3(1.0,0.92,0.84), uEnd*0.6);
    if (lm.y > 0.5) {
      // lava: a red wash, and the lines of its flow in red ink
      float glow = 0.5 + 0.5*sin(lm.w*6.2832);
      wash = mix(vec3(0.99,0.50,0.28), vec3(1.0,0.80,0.45), glow*0.6);
      ink = burin(lm.w*2.0, max(fwidth(lm.w*2.0), 1e-5), sp*1.2, k*(0.6 + 0.7*(1.0 - glow)))*0.9;
      tint = mix(C_RED, C_INK, 0.25);
    }
    wash = mix(vec3(1.0), wash, clamp(pool, 0.0, 1.3));
  } else if (id > 9.5) {
    vec4 lm = lightMarks(id, p);
    vec4 port = uPort[int(id - 9.5)];
    if (port.w > 0.5) {
      // the cave's lights: iron posts, flames in red and amber
      if (lm.w > 0.5) {
        wash = mix(vec3(0.98,0.42,0.22), vec3(1.0,0.86,0.50), smoothstep(0.35, 1.0, ndv))*mix(0.8, 1.0, lm.y);
        ink = 0.0; tint = C_RED;
        edge = max(edge*0.8, rim(ndv, k));
      } else {
        wash = vec3(0.62,0.55,0.50);
        ink = max(engrave(p*4.0, dx*4.0, dy*4.0, vec3(0.7, 0.1, 0.7), vec3(0.0, 1.0, 0.2), sp*0.8, k, 0.5 + 0.5*D), rim(ndv, k));
        edge = max(edge, fieldRim(int(id - 8.5), p, rd, n, 1.3*px));
      }
    } else {
      // a lighthouse: turned on a lathe, lines down its length, red bands, the lamp in red
      vec2 r = p.xz - port.xy;
      float y = p.y - port.z;
      float turn = atan(r.x, r.y)*8.0, fwT = max(fwidth(turn), 1e-5);
      if (fwT > 6.0) fwT = 1e-5;                           // the seam of atan
      ink = burin(turn, fwT, sp*1.1, k*1.1*smoothstep(0.3, 1.0, D))*0.85;
      if (lm.x < 0.5) wash = mix(vec3(0.93,0.40,0.28), vec3(0.74,0.24,0.18), lm.z*0.6);
      if (y > LIGHT_TOP - 0.35 && y < LIGHT_TOP + 0.05) { wash = vec3(0.6,0.55,0.5); ink = max(ink, 0.8); }
      if (y > LIGHT_TOP + 1.6) { wash = vec3(0.80,0.33,0.25); ink = max(ink, 0.35 + 0.5*D); }
      if (lm.w > 0.5) {
        // the lamp room: glazing bars, and the light behind them
        wash = lm.y > 0.5 ? mix(vec3(1.0,0.50,0.26), vec3(1.0,0.90,0.60), smoothstep(0.3, 1.0, ndv)) : vec3(0.72,0.74,0.74);
        ink = lm.y > 0.5 ? 0.0 : max(ink, 0.5*D);
      }
      edge = max(edge, rim(ndv, k)*step(0.0, y));
      if (lm.w < 0.5 || lm.y < 0.5) edge = max(edge, fieldRim(int(id - 8.5), p, rd, n, 1.3*px)*clamp(1.6 - 2.0*px, 0.0, 1.0));
      wash *= mix(vec3(1.0), vec3(0.82,0.80,0.84), smoothstep(0.3, 0.95, D)*0.6);
    }
  } else if (id > 8.5) {
    // the plume: curls cut round each puff, heavy on the side away from the sun; red at the root
    float pd = 1.0 - clamp(0.55 + 0.5*sun + 0.2*n.y, 0.0, 1.0);
    float swirl = 1.3*noise(n.xz*2.2 + q.x*31.0) + 0.7*noise(n.yx*3.1 + q.x*17.0);
    float v1 = dot(n, vec3(0.55, 0.62, 0.56))*5.0 + swirl;
    float v2 = dot(n, vec3(-0.66, 0.30, 0.69))*5.0 - swirl;
    ink = burin(v1, max(fwidth(v1), 1e-5), sp*1.05, k*(0.3 + 1.4*smoothstep(0.1, 0.9, pd)));
    ink = max(ink, burin(v2, max(fwidth(v2), 1e-5), sp*1.05, k*1.1*smoothstep(0.6, 1.0, pd)));
    edge = max(edge, rim(ndv, k));
    wash = mix(vec3(0.70,0.67,0.66), vec3(0.90,0.89,0.88), smoothstep(0.0, 0.7, q.x));
    wash *= mix(vec3(1.0), vec3(0.78,0.77,0.82), pd*0.7);
    float fire = (1.0 - smoothstep(0.05, 0.3, q.x))*smoothstep(0.35, -0.5, n.y + q.x*2.0);
    wash = mix(wash, vec3(1.0,0.50,0.30), fire*0.85);
    tint = mix(C_INK, C_RED, fire*0.6);
  } else if (id > 7.5) {
    // the cave: dark, close cross-hatching under an umber wash; the lamp glows red-amber on the
    // rock, the mouth lets in the cool of the day
    vec2 cl = caveLight(p, n);
    vec2 e = normalize(uCave.zw - uCave.xy);
    float L = clamp(cl.x*0.95 + cl.y*1.6, 0.0, 1.0);
    float dk = 1.0 - L;
    wash = mix(vec3(0.40,0.32,0.28), vec3(0.80,0.84,0.82), smoothstep(0.0, 0.9, cl.x));
    wash = lampWash(wash, cl.y*0.8);
    if (t < 0.05) {
      // the camera is inside the rock: a flat dark ground of crossed lines
      ink = max(burin(fc.x + fc.y, 1.414, sp, k*1.5), burin(fc.x - fc.y, 1.414, sp, k*1.3));
      wash = vec3(0.36,0.29,0.25);
    } else {
      vec3 a = vec3(e.x, 0.3, e.y)*0.8, b = vec3(-e.y*0.45, 1.0, e.x*0.45)*0.8;
      float wob = 0.5*noise(p.xz*0.5 + p.y*0.4);
      float rough = 0.7 + 0.6*noise(p.xz*0.9 + p.y*1.3);   // the rock is not even, nor the hand
      ink = burin(dot(p, b) + wob, perPx(b, dx, dy), sp, k*(0.45 + 1.5*smoothstep(0.05, 0.9, dk))*rough);
      ink = max(ink, burin(dot(p, a) - wob, perPx(a, dx, dy), sp*1.45, k*1.5*smoothstep(0.5, 0.95, dk)*rough));
      vec3 c3 = vec3(e.x - e.y, -1.1, e.y + e.x)*0.6;
      ink = max(ink, burin(dot(p, c3) + wob, perPx(c3, dx, dy), sp*2.1, k*1.6*smoothstep(0.72, 1.0, dk)));
    }
    tint = mix(C_INK, mix(C_INK, C_RED, 0.5), smoothstep(0.3, 0.8, cl.y));
    wash = mix(wash, wash*(0.8 + 0.4*noise(p.xz*0.25 + p.y*0.3)), 0.8);
  } else if (id < 7.5) {
    edge = max(edge, fieldRim(0, toBoat(p - vec3(uPos.x, 0.0, uPos.y)), toBoat(rd), toBoat(n), 1.2*px));
  }
  vec3 rk = id > 2.5 && id < 7.5 ? rocketMark(id, q) : vec3(0.0);
  if (id < 2.5 || id > 7.5) {
  } else if (rk.x > 1.5) {
    // the rocket's flame: bare at the nozzle, amber, then red, with a few strokes down its length
    wash = mix(vec3(1.0,0.93,0.66), vec3(0.97,0.40,0.22), smoothstep(0.1, 0.8, rk.z));
    ink = burin(q.x*30.0 + q.y*18.0, perPx(vec3(30.0, 18.0, 0.0), qx, qy), 4.0*k, 0.6*k)*0.5*rk.z;
    tint = C_RED; edge *= 0.7;
  } else if (rk.x > 0.5) {
    // the rocket: white paint left bare, red paint in red, the metal dark; rings round its body
    wash = rk.y > 1.5 ? vec3(0.50,0.46,0.44) : rk.y > 0.5 ? vec3(0.93,0.36,0.25) : vec3(1.0,0.98,0.94);
    float rd_ = rk.y > 1.5 ? 0.6 + 0.4*D : D;
    ink = burin(q.z*16.0, perPx(vec3(0.0, 0.0, 16.0), qx, qy), sp*0.8, k*1.5*smoothstep(0.3, 0.95, rd_));
    edge = max(edge, rim(ndv, k));
  } else if (id < 3.5) {
    // the hull: tarred planks, strake by strake; a pale sheer line
    float hd = 0.55 + 0.45*D;
    ink = burin(q.y*9.0, perPx(vec3(0.0, 9.0, 0.0), qx, qy), sp*0.8, k*(0.6 + 1.2*hd));
    ink = max(ink, burin(q.z*7.0 + q.y*5.0, perPx(vec3(0.0, 5.0, 7.0), qx, qy), sp*0.8, k*1.5*smoothstep(0.55, 0.95, hd)));
    wash = vec3(0.60,0.50,0.42);
    if (q.y > 0.13 && q.y < 0.2) { ink *= 0.15; wash = vec3(1.0,0.90,0.66); }
    if (q.y > 0.262) { wash = vec3(0.86,0.76,0.60); ink = burin(q.x*14.0, perPx(vec3(14.0, 0.0, 0.0), qx, qy), sp, k*0.7)*0.7; }
    edge = max(edge, rim(ndv, k));
  } else if (id > 4.5 && id < 5.5) {
    ink = 0.95; wash = vec3(0.7,0.6,0.5);
  } else if (id > 6.5) {
    wash = vec3(0.92,0.34,0.24); tint = C_RED;
    ink = 0.35 + 0.4*burin(q.y*40.0, perPx(vec3(0.0, 40.0, 0.0), qx, qy), 3.0*k, 0.7*k);
  } else {
    // the sails: bare paper, the seams of the cloth, a light hatching on the side in shade
    float sd = clamp(0.62 - 0.75*abs(sun), 0.0, 1.0);
    wash = mix(vec3(1.0,0.985,0.95), vec3(0.87,0.86,0.86), sd);
    ink = burin(q.y*2.6, perPx(vec3(0.0, 2.6, 0.0), qx, qy), 26.0*k, 0.5*k)*0.55;
    ink = max(ink, burin((q.y + q.z*0.8)*12.0, perPx(vec3(0.0, 12.0, 9.6), qx, qy), sp*1.1, k*1.5*smoothstep(0.25, 0.75, sd))*0.7);
    if (id > 5.5) wash *= vec3(1.0,0.80,0.74);
  }
  if (id > 2.5 && id < 7.5 && landAt(p.xz).r > 0.5 && caveD(p) < 0.5) {
    // the boat in the cave takes the dusk of it, and the lamp's colour
    vec2 cl = caveLight(p, n);
    vec3 dusk = mix(vec3(0.52,0.44,0.40), vec3(1.0), smoothstep(0.0, 0.8, cl.x));
    wash *= lampWash(dusk, cl.y*0.7);
  }
  ink = max(ink, edge);
  return plate(wash, ink, tint, t);
}

vec3 post_chart(vec3 col, vec3 rd, vec2 fc, float k){
  vec2 s = fc/k;
  // laid paper: fibres, a faint chain of lines, a mottling
  float fibre = noise(s*vec2(0.9, 0.16) + 3.0)*0.5 + noise(s.yx*vec2(1.1, 0.13) + 11.0)*0.5;
  float grain = noise(s*1.7);
  col *= 0.955 + 0.05*fibre + 0.035*grain;
  col *= 0.975 + 0.05*noise(s*0.021 + 40.0);
  col *= 1.0 - 0.018*smoothstep(0.42, 0.5, abs(fract(s.x/26.0) - 0.5));
  // the edges have browned, and the damp has left its spots
  vec2 e = (fc/uRes - 0.5)*vec2(1.08, 1.22);
  float vig = pow(clamp(length(e)*1.38, 0.0, 1.6), 3.6);
  col *= mix(vec3(1.0), vec3(0.82,0.72,0.56), clamp(vig*0.6, 0.0, 0.8));
  float fox = smoothstep(0.74, 0.86, noise(s*0.03 + 71.0))*smoothstep(0.35, 0.75, noise(s*0.19 + 5.0));
  col *= mix(vec3(1.0), vec3(0.86,0.73,0.55), fox*(0.05 + 0.6*clamp(vig*1.5, 0.0, 1.0)));
  return col + (hash(fc) - 0.5)/255.0;
}
`,
};
