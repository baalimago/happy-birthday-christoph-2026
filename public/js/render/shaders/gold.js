// View 2, Secession gold: the world as gilded metal and enamel on black. A lacquer sea with
// gold-leaf crests and a molten sun path, islands of mosaic, a gilded sun with its halo.
//
// Everything is shaded in linear light with one small metal/enamel model (gdLit: a GGX highlight
// from the low sun, Fresnel, and a reflection of the sky's gradient), and post_gold brings it to
// the screen: a lift of the brightest gold, a tone curve, a vignette and a dither.

export const gold = {
  id: 'gold',
  glsl: /* glsl */ `
// albedo (or the colour of the metal), and in w: 1 metal, 0 enamel
const vec4 G_GOLD = vec4(1.0, 0.61, 0.15, 1.0), G_PALE = vec4(1.0, 0.77, 0.34, 1.0);
const vec4 G_BRONZE = vec4(0.44, 0.21, 0.055, 1.0), G_DARK = vec4(0.15, 0.08, 0.032, 1.0);
const vec4 G_IVORY = vec4(0.80, 0.73, 0.58, 0.0), G_ONYX = vec4(0.012, 0.011, 0.010, 0.0);
const vec4 G_PATINA = vec4(0.07, 0.30, 0.22, 0.0), G_EMERALD = vec4(0.015, 0.17, 0.07, 0.0);
const vec4 G_TEAL = vec4(0.0, 0.17, 0.19, 0.0), G_LAPIS = vec4(0.025, 0.065, 0.30, 0.0);
const vec4 G_RED = vec4(0.42, 0.028, 0.012, 0.0);

vec3 gdSunC(){ return mix(vec3(1.0, 0.80, 0.52), vec3(1.0, 0.52, 0.22), uEnd)*2.8; }
vec3 gdHorizon(){ return mix(vec3(0.085, 0.046, 0.017), vec3(0.17, 0.06, 0.016), uEnd); }

// the sky without its ornaments: black-brown overhead, umber at the horizon, warm about the sun
vec3 gdSky(vec3 rd){
  float y = max(rd.y, 0.0);
  float az = max(dot(normalize(rd.xz + 1e-5), normalize(uSun.xz + 1e-5)), 0.0);
  vec3 hor = gdHorizon()*(0.42 + 1.5*az*az*az);
  vec3 c = mix(vec3(0.0055, 0.0042, 0.0034), hor, exp(-y*5.5)) + hor*0.9*exp(-y*30.0);
  float s = max(dot(rd, uSun), 0.0);
  float s8 = pow(s, 8.0);
  return c + gdSunC()*(0.02*s8 + 0.09*s8*s8*s8*s8*s8*s8);
}
// what a surface mirrors: the sky, and under the horizon the dark sea
vec3 gdEnv(vec3 r){
  vec3 c = gdSky(vec3(r.x, abs(r.y), r.z));
  return r.y > 0.0 ? c : c*mix(0.75, 0.18, smoothstep(0.0, -0.3, r.y));
}
vec3 gdAmb(vec3 n){
  float sun = max(dot(n.xz, normalize(uSun.xz + 1e-5)), 0.0);
  return mix(vec3(0.008, 0.006, 0.004), vec3(0.036, 0.024, 0.013), n.y*0.5 + 0.5) + gdHorizon()*0.35*sun;
}
float gdGGX(float ndh, float rough){
  float a = rough*rough, a2 = a*a, d = ndh*ndh*(a2 - 1.0) + 1.0;
  return a2/(3.1416*d*d);
}
// a highlight from a light in direction l, for a surface of roughness rough and reflectance f0
vec3 gdSpec(vec3 f0, float rough, vec3 n, vec3 v, vec3 l){
  vec3 h = normalize(v + l);
  float ndl = max(dot(n, l), 0.0), ldh = max(dot(l, h), 0.0);
  vec3 f = f0 + (1.0 - f0)*pow(1.0 - ldh, 5.0);
  return f*min(gdGGX(max(dot(n, h), 0.0), rough)*0.25/(ldh*ldh*(rough + 0.5) + 0.02), 40.0)*ndl;
}
// metal (m.w = 1) or enamel (m.w = 0) under the low sun and the sky. occ: how much sky it sees.
vec3 gdLit(vec4 m, float rough, vec3 n, vec3 rd, float occ){
  vec3 v = -rd, sunC = gdSunC();
  float ndv = max(dot(n, v), 0.0), ndl = max(dot(n, uSun), 0.0);
  vec3 f0 = mix(vec3(0.05), m.rgb, m.w);
  vec3 fv = f0 + (max(vec3(1.0 - rough), f0) - f0)*pow(1.0 - ndv, 5.0);
  vec3 amb = gdAmb(n);
  vec3 env = mix(gdEnv(reflect(rd, n)), amb*1.6, rough*rough*1.5);
  // enamel scatters; leaf scatters a little too, which is what makes it read as gold in shade
  float wrap = dot(n, uSun)*0.5 + 0.5;
  vec3 body = m.rgb*mix(sunC*ndl*0.30 + amb, sunC*0.15*wrap*wrap + amb*2.2, m.w);
  return body*(0.35 + 0.65*occ) + (gdSpec(f0, rough, n, v, uSun)*sunC + env*fv*mix(1.0, 2.6, m.w))*occ;
}
// the slope of a small-scale relief: hammer marks, ripples
vec2 gdBump(vec2 u){
  float a = noise(u);
  return vec2(noise(u + vec2(0.37, 0.0)) - a, noise(u + vec2(0.0, 0.37)) - a);
}

// ---- tesserae. A point is laid out on the plane its normal faces most, so a cliff carries
// courses and the ground a pavement, and nothing is stretched. Returns the tile's number;
// f: the place in the tile (-0.5..0.5), tx and ty: the plane's axes in the world.
vec2 gdTess(vec3 p, vec3 n, float side, out vec2 f, out vec3 tx, out vec3 ty){
  vec2 u; float o;
  if (n.y > 0.7) { u = vec2(0.921*p.x - 0.389*p.z, 0.389*p.x + 0.921*p.z); tx = vec3(0.921, 0.0, -0.389); ty = vec3(0.389, 0.0, 0.921); o = 0.0; }
  else if (abs(n.x) > abs(n.z)) { u = p.zy; tx = vec3(0.0, 0.0, 1.0); ty = vec3(0.0, 1.0, 0.0); o = 37.0; }
  else { u = p.xy; tx = vec3(1.0, 0.0, 0.0); ty = vec3(0.0, 1.0, 0.0); o = 71.0; }
  u /= side;
  float row = floor(u.y);
  u.x += 0.5*mod(row, 2.0) + 0.3*hash(vec2(row, o + 3.0));
  f = fract(u) - 0.5;
  return floor(u) + o;
}
// the side of a tile: it doubles with distance, so the mosaic never turns to noise
float gdSide(float t){ return 0.7*exp2(floor(log2(clamp(t/20.0, 1.0, 16.0)))); }
// One tessera, lit. m: its material; tile: its number; f, tx, ty from gdTess; fw: the width of
// a pixel in tiles; ham: hammering. Each tile is tilted a little and pillowed at its edge, so
// each catches the sun on its own.
vec3 gdTile(vec4 m, vec2 tile, vec2 f, vec3 tx, vec3 ty, vec3 n, vec3 rd, float fw, float occ){
  float r1 = hash(tile + 11.0), r2 = hash(tile + 23.0), r3 = hash(tile + 57.0);
  float edge = 0.5 - max(abs(f.x), abs(f.y));
  float gap = 0.045 + 0.05*r3;
  float sharp = smoothstep(0.55, 0.2, fw);                 // tiles smaller than this are a blur
  vec2 tilt = (vec2(r1, r2) - 0.5)*0.34 + f*smoothstep(0.22, 0.5, 0.5 - edge)*1.1;
  if (m.w*sharp > 0.05) tilt += gdBump((tile + f)*5.0)*0.9;
  vec3 nn = normalize(n + (tx*tilt.x + ty*tilt.y)*sharp);
  float rough = mix(0.16, 0.26 + 0.2*r3, m.w);
  vec3 c = gdLit(vec4(m.rgb*(0.8 + 0.4*r1), m.w), rough, nn, rd, occ);
  float grout = 1.0 - smoothstep(gap - fw, gap + fw, edge);
  return mix(c, vec3(0.004, 0.003, 0.0025), grout*(0.35 + 0.65*sharp));
}

// a spiral inlaid in a cell of side cs, in the manner of Klimt: the distance to its line
float gdSwirl(vec2 w, float cs, float seed, out float rim){
  vec2 g = w/cs, c = floor(g);
  float h = hash(c + seed);
  rim = 0.0;
  if (h < 0.5) return 1e3;
  vec2 o = (g - c - 0.5 - (vec2(hash(c + seed + 5.0), hash(c + seed + 9.0)) - 0.5)*0.36)*cs;
  float r = length(o), R = cs*(0.2 + 0.11*fract(h*17.0));
  if (r > R) return 1e3;
  float turns = 3.0;
  float a = atan(o.y, o.x)/6.2832*(h > 0.75 ? 1.0 : -1.0);
  rim = smoothstep(R, R*0.75, r);
  return abs(fract(r/R*turns + a) - 0.5)*R/turns;
}

vec3 sky_gold(vec3 rd, vec2 fc, float k){
  vec3 c = gdSky(rd), sunC = gdSunC();
  float px = 1.0/(1.25*uRes.y);
  float ang = acos(clamp(dot(rd, uSun), -1.0, 1.0));
  // the sun: a gilded disc, concentric halos of leaf, and rays
  vec3 a1 = normalize(cross(uSun, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0)), a2 = cross(a1, uSun);
  float th = atan(dot(rd, a1), dot(rd, a2));
  float disc = 0.052 + 0.012*uEnd;
  if (ang < 0.5) {
    float ring = ang/disc;
    // halos: thin rings, each fainter and broken into leaves
    float rl = abs(fract(ring*0.5 + 0.25) - 0.5)*2.0*disc;
    float leaf = 0.55 + 0.45*step(0.35, hash(vec2(floor(ring*0.5 + 0.25), floor(th*(6.0 + 3.0*floor(ring*0.5))))));
    float halo = (1.0 - smoothstep(0.0025, 0.0025 + 1.5*px, rl))*leaf*exp(-ang*9.0)*step(disc*1.2, ang);
    // rays: sixteen long, sixteen short between them
    float w = abs(fract(th*16.0/6.2832) - 0.5), w2 = abs(fract(th*16.0/6.2832 + 0.5) - 0.5);
    float ray = (1.0 - smoothstep(0.02, 0.05 + 0.2*px/max(ang, 0.01), w*ang*3.0))*exp(-ang*7.0)
              + 0.6*(1.0 - smoothstep(0.015, 0.04 + 0.2*px/max(ang, 0.01), w2*ang*3.0))*exp(-ang*14.0);
    ray *= step(disc*1.35, ang);
    c += sunC*G_GOLD.rgb*(halo*0.55 + ray*0.30);
    // the disc itself, with a darker engraved ring and a bright rim
    float d = 1.0 - smoothstep(disc - px, disc + px, ang);
    float eng = 1.0 - 0.35*(1.0 - smoothstep(0.0, 0.05, abs(ring - 0.72)));
    c = mix(c, sunC*mix(vec3(1.0, 0.78, 0.36), vec3(1.0, 0.95, 0.8), exp(-ring*ring*2.5))*1.7*eng, d);
  }
  // sparse gold flecks: little squares and diamonds of leaf, and finer dust
  if (rd.y > 0.02) {
    vec2 g = vec2(atan(rd.x, rd.z)*15.0, asin(rd.y)*15.0/(0.55 + 0.45*rd.y));
    vec2 cell = floor(g);
    float h = hash(cell + 3.0);
    if (h > 0.88) {
      vec2 f = g - cell - 0.5 - (vec2(hash(cell + 17.0), hash(cell + 29.0)) - 0.5)*0.6;
      float size = 0.02 + 0.075*fract(h*41.0)*fract(h*41.0);
      float d = fract(h*9.0) > 0.5 ? max(abs(f.x), abs(f.y)) : (abs(f.x) + abs(f.y))*0.75;
      float tw = 0.65 + 0.35*sin(uT*(0.7 + 2.0*fract(h*23.0)) + h*90.0);
      c += G_GOLD.rgb*(1.0 - smoothstep(size, size + 15.0*px*1.5, d))*tw*(0.25 + 1.3*fract(h*5.0))*smoothstep(0.02, 0.12, rd.y);
    }
    vec2 g2 = g*4.3 + 7.0;
    float h2 = hash(floor(g2));
    if (h2 > 0.965) {
      vec2 f = fract(g2) - 0.5;
      c += G_PALE.rgb*0.35*(1.0 - smoothstep(0.06, 0.06 + 65.0*px*1.5, length(f)))*fract(h2*31.0);
    }
  }
  return c;
}

// things far off sink into the umber of the horizon behind them
vec3 gdHaze(vec3 c, vec3 rd, float t){
  float hz = haze(t);
  if (hz < 0.002) return c;
  return mix(c, gdSky(normalize(vec3(rd.x, 0.012, rd.z))), hz*0.92);
}

vec3 shade_gold(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k){
  vec3 sunC = gdSunC(), v = -rd;
  float px = t/(1.25*uRes.y);                       // the width of a pixel at the hit
  vec3 c;
  if (id < 1.5) {
    // ---- the sea: black lacquer
    vec4 mk = seaMarks(p, t);
    float foot = px/max(-rd.y, 0.03);
    float near = exp(-t*0.018);
    float s = sea(p.xz);
    vec2 rip = vec2(0.0);
    if (near > 0.03) {
      rip = gdBump(p.xz*2.1 + uT*vec2(0.33, 0.21));
      if (near > 0.2) rip += 0.6*gdBump(p.xz*5.3 - uT*vec2(0.4, 0.5));
    }
    vec3 nn = normalize(n + vec3(rip.x, 0.0, rip.y)*0.55*near);
    if (mk.w > 0.5) nn = normalize(mix(nn, vec3(0.0, 1.0, 0.0), 0.5));       // it lies still in the cave
    float ndv = max(dot(nn, v), 0.0);
    float fres = 0.045 + 0.955*pow(1.0 - ndv, 5.0);
    vec3 r = reflect(rd, nn);
    if (mk.w > 0.5) {
      // in the cave: black water that carries the lamp and the daylight of the mouth
      vec2 cl = caveLight(p, nn);
      vec3 l = uCaveLamp - p;
      float att = 1.0/(1.0 + dot(l, l)/110.0);
      vec2 out2 = normalize(uCave.xy - uCave.zw);
      vec3 day = normalize(vec3(out2.x, 0.35, out2.y));
      c = vec3(0.0015, 0.0018, 0.002) + vec3(0.0, 0.03, 0.035)*cl.x*cl.x;
      c += vec3(1.0, 0.62, 0.22)*gdSpec(vec3(0.06), 0.22, nn, v, normalize(l))*att*5.0;
      c += vec3(1.0, 0.5, 0.12)*att*0.03*fres;
      c += gdSky(day)*fres*cl.x*1.6 + vec3(0.5, 0.62, 0.6)*gdSpec(vec3(0.06), 0.3, nn, v, day)*cl.x;
      // the foot of the wall: a course of leaf that glints
      if (mk.z > -0.07) c = G_GOLD.rgb*(0.012 + 0.25*cl.x + 1.6*cl.y);
      if (mk.y > 0.5) c += G_PALE.rgb*(0.02 + 0.3*cl.x + 0.8*cl.y);
      return c;
    }
    // deep water is obsidian; over a shoal the enamel shows through: teal, then lapis cloisons
    vec3 deep = vec3(0.0028, 0.0030, 0.0036);
    if (mk.x > 0.01) {
      vec2 u = p.xz/0.95 + nn.xz*0.3;
      u.x += 0.5*mod(floor(u.y), 2.0);
      vec2 f = fract(u) - 0.5;
      float h = hash(floor(u) + 91.0);
      vec3 en = mix(G_TEAL.rgb, G_LAPIS.rgb, step(0.62, h))*(0.7 + 0.9*fract(h*13.0));
      en = mix(en, G_PATINA.rgb, step(0.9, h));
      float wire = 1.0 - smoothstep(0.035, 0.035 + foot/0.95, 0.5 - max(abs(f.x), abs(f.y)));
      float show = smoothstep(0.6, 0.15, foot/0.95);
      en = mix(mix(G_TEAL.rgb, G_LAPIS.rgb, 0.3), en, show);
      en = en*(sunC*max(dot(nn, uSun), 0.0)*0.45 + 0.13);
      en = mix(en, G_GOLD.rgb*(0.06 + 0.5*max(dot(nn, uSun), 0.0)), wire*show*0.8);
      deep = mix(deep, en, mk.x*(0.55 + 0.45*mk.x));
    }
    c = deep + gdEnv(r)*fres;
    // the sun: a sharp glint close by, and far off a long molten path under it
    vec3 f0 = vec3(0.06);
    c += sunC*gdSpec(f0, 0.10 + 0.12*(1.0 - near), nn, v, uSun)*1.4;
    vec3 rf = reflect(rd, normalize(mix(nn, vec3(0.0, 1.0, 0.0), 0.75)));
    float az = max(dot(normalize(rf.xz + 1e-5), normalize(uSun.xz + 1e-5)), 0.0);
    if (az > 0.8 && uSun.y > -0.05) {
      float glit = noise(p.xz*0.9/max(foot*2.5, 0.25) + uT*1.3);
      float path = pow(az, 260.0)*exp(-abs(rf.y - uSun.y)*2.2)*(0.25 + 1.5*glit*glit) + 0.12*pow(az, 24.0)*exp(-abs(rf.y - uSun.y)*5.0);
      c += sunC*G_GOLD.rgb*path*1.5;
    }
    // inlaid spirals, which ride the swell; they thin out as the wind gets up
    float calm = clamp(1.45 - 0.5*uWindSpeed, 0.25, 1.0)*smoothstep(0.45, 0.12, foot)*(1.0 - 0.7*mk.x);
    if (calm > 0.01) {
      float rim;
      vec2 w = p.xz + nn.xz*0.6;
      float d = min(gdSwirl(w, 8.5, 0.0, rim), 1e3);
      float rim2, d2 = gdSwirl(w + 40.0, 4.1, 50.19, rim2);
      if (d2 < d) { d = d2; rim = rim2; }
      float line = (1.0 - smoothstep(0.03, 0.03 + foot*0.7, d))*rim;
      if (line > 0.004) c = mix(c, gdLit(G_GOLD, 0.3, nn, rd, 1.0) + G_GOLD.rgb*0.05, line*calm);
    }
    // leaf on the crests: torn, hammered flakes of gold
    float tear = noise(p.xz*2.6 + vec2(uT*0.15, 0.0)) + (foot < 0.6 ? 0.5*noise(p.xz*7.0) : 0.25);
    // a crest is where the water stands over its neighbours up and down the wind
    float crest = 0.0;
    if (foot < 1.0) {
      vec2 a = uWind.xy*0.8;
      float top = s - 0.5*(sea(p.xz + a) + sea(p.xz - a));
      float lee = dot(n.xz, uWind.xy);                // the leaf lies just over the top, down the wind
      crest = smoothstep(0.0, 0.006 + foot*0.08, top - 0.03 + 0.016*tear)*smoothstep(1.0, 0.2, foot)
            * smoothstep(-0.01, 0.02, lee)*smoothstep(0.13, 0.07, lee);
    }
    if (crest > 0.01) {
      float fine = smoothstep(0.5, 0.1, foot*5.0);
      vec2 hb = gdBump(p.xz*8.0)*fine;
      vec3 nl = normalize(nn + vec3(hb.x, 0.0, hb.y)*2.4);
      vec3 leaf = gdLit(G_GOLD, 0.3, nl, rd, 1.0) + G_GOLD.rgb*0.03;
      c = mix(c, leaf, crest*mix(1.0, smoothstep(0.26, 0.34, noise(p.xz*11.0 + 5.0)), fine));
    }
    // a fine engraved line along the swell, close by
    float sl = s*7.0;
    c += G_GOLD.rgb*lineAt(sl, fwidth(sl))*0.05*near*(0.3 + max(dot(nn, uSun), 0.0));
    // the shore wears a rim of pale leaf, the wake two threads of it
    if (mk.z > -0.09) c = mix(c, gdLit(G_PALE, 0.3, nn, rd, 1.0) + G_PALE.rgb*0.05, smoothstep(-0.09, -0.04, mk.z)*(0.6 + 0.3*tear));
    if (mk.y > 0.5) c = mix(c, gdLit(G_PALE, 0.3, nn, rd, 1.0) + G_PALE.rgb*0.10, 0.12 + 0.88*smoothstep(0.5, 0.6, tear));
    return gdHaze(c, rd, t);
  }
  if (id < 2.5) {
    // ---- the land: mosaic
    vec4 lm = landMarks(p, t);
    float side = gdSide(t);
    float fw = px/side/max(dot(n, v), 0.25);
    vec2 f; vec3 tx, ty;
    if (lm.y > 0.5) {
      // lava: plates of red enamel, and the melt glowing in the joints between them
      vec2 tile = gdTess(p, n, side*1.6, f, tx, ty);
      float h = hash(tile + 5.0);
      float band = 0.5 + 0.5*sin(lm.w*6.2832);
      float edge = 0.5 - max(abs(f.x), abs(f.y));
      float joint = 1.0 - smoothstep(0.03, 0.16 + fw, edge + 0.08*h);
      vec3 nn = normalize(n + (tx*f.x + ty*f.y)*0.5);
      c = gdLit(vec4(G_RED.rgb*(0.5 + h), 0.0), 0.2, nn, rd, 1.0) + vec3(0.55, 0.035, 0.008)*(0.25 + band*band);
      c = mix(c, vec3(3.2, 1.25, 0.22)*(0.45 + 0.9*band), joint);
      return gdHaze(c, rd, t);
    }
    if (lm.x > 0.0) {
      // woods: ovals of green enamel in gold wire, on black; a leaf of gold at the top of a fir
      float os = side*0.8;
      vec2 tile = gdTess(p, n, os, f, tx, ty);
      float fo = fw*side/os;
      float h = hash(tile + 5.0), h2 = hash(tile + 19.0);
      float d = length(f*vec2(2.25, 2.0));
      float sharp = smoothstep(0.55, 0.2, fo);
      float occ = smoothstep(0.45, 0.8, lm.x);
      vec4 m = h < 0.42 ? G_EMERALD : h < 0.74 ? G_PATINA : h < 0.86 ? vec4(0.16, 0.22, 0.03, 0.0) : G_GOLD;
      if (lm.x > 0.86) m = h < 0.75 ? G_GOLD : G_PALE;
      m.rgb *= 0.65 + 0.9*h2;
      // each oval is a low dome
      vec3 nn = normalize(n + (tx*f.x + ty*f.y)*1.5*sharp + (tx*(h - 0.5) + ty*(h2 - 0.5))*0.3);
      c = gdLit(m, mix(0.14, 0.3, m.w), nn, rd, 0.3 + 0.7*occ);
      vec3 wire = gdLit(G_GOLD, 0.3, n, rd, 0.3 + 0.7*occ);
      float inside = 1.0 - smoothstep(0.82 - fo*2.0, 0.82 + fo*2.0, d);
      float ring = (1.0 - smoothstep(0.96 - fo*2.0, 0.96 + fo*2.0, d))*(1.0 - inside);
      vec3 ground = vec3(0.0035, 0.006, 0.0035);
      c = mix(mix(ground, wire, ring*sharp), c, inside*(0.55 + 0.45*sharp) + 0.3*(1.0 - sharp));
      return gdHaze(c, rd, t);
    }
    vec2 tile = gdTess(p, n, side, f, tx, ty);
    float h = hash(tile + 5.0);
    vec4 m;
    vec2 vv = p.xz - uVolcano.xy;
    if (lm.z > 1.5) m = h < 0.6 ? G_DARK : h < 0.82 ? G_ONYX : h < 0.93 ? G_BRONZE : G_GOLD;
    else if (lm.z > 0.5 && n.y > 0.9) m = h < 0.38 ? G_IVORY : h < 0.72 ? G_PALE : h < 0.93 ? G_GOLD : G_TEAL;
    else if (dot(vv, vv) < uVolcanoR*uVolcanoR*0.5) {
      // the volcano: onyx and dark bronze, veined with gold, sparks of red
      m = h < 0.36 ? G_ONYX : h < 0.72 ? G_DARK : h < 0.84 ? G_BRONZE : h < 0.94 ? G_GOLD : G_RED;
    } else if (n.y < 0.7) {
      // a cliff: courses of dark bronze, and now and then a course of gold
      float course = hash(vec2(tile.y, 77.0));
      m = h < 0.50 ? G_DARK : h < 0.74 ? G_BRONZE : h < 0.86 ? G_ONYX : h < 0.95 ? G_GOLD : G_PATINA;
      if (course > 0.86 && h > 0.25) m = h < 0.8 ? G_GOLD : G_PALE;
    } else {
      // open ground: fields of gold, of bronze and of verdigris
      float field = noise(p.xz*0.045 + 13.0), g = h + (field - 0.5)*0.9;
      m = g < 0.18 ? G_PATINA : g < 0.30 ? G_EMERALD : g < 0.44 ? G_BRONZE : g < 0.50 ? G_ONYX
        : g < 0.86 ? G_GOLD : g < 0.95 ? G_PALE : G_IVORY;
      if (h > 0.975) m = G_LAPIS;
    }
    c = gdTile(m, tile, f, tx, ty, n, rd, fw, 1.0);
    return gdHaze(c, rd, t);
  }
  if (id > 9.5) {
    // ---- lighthouses and the lights of the cave
    vec4 lm = lightMarks(id, p);
    int port = int(id - 9.5);
    bool cave = uPort[port].w > 0.5;
    if (lm.w > 0.5) {
      // a lamp: it shines, and far off it is a point of gold
      float core = max(dot(n, v), 0.0);
      c = lm.y > 0.5 ? mix(vec3(1.6, 0.75, 0.18), vec3(3.4, 2.5, 1.2), core*core)*(cave ? 0.9 : 1.0)
                     : gdLit(G_BRONZE, 0.2, n, rd, 1.0)*0.7 + G_GOLD.rgb*0.02;
      return mix(c, gdSky(normalize(vec3(rd.x, 0.012, rd.z))), haze(t)*(lm.y > 0.5 ? 0.3 : 0.9));
    }
    if (cave) {
      // a brazier's post: bronze in the light of its own flame
      c = gdLit(G_BRONZE, 0.3, n, rd, 0.6) + G_GOLD.rgb*vec3(1.0, 0.7, 0.4)*lm.y*0.5*smoothstep(-2.0, 0.3, n.y + (p.y - uBrazier[0].y)*0.5);
      return gdHaze(c, rd, t);
    }
    // the tower: small tesserae in bands of ivory enamel and of gold (verdigris once found)
    vec2 o = p.xz - uPort[port].xy;
    float y = p.y - uPort[port].z;
    float around = atan(o.x, o.y);
    vec2 u = vec2(around*24.0/6.2832, y/0.215);
    u.x += 0.5*mod(floor(u.y), 2.0);
    vec2 f = fract(u) - 0.5;
    vec3 tx = vec3(cos(around), 0.0, -sin(around)), ty = vec3(0.0, 1.0, 0.0);
    vec2 tile = floor(u) + float(port)*13.0;
    float h = hash(tile);
    vec4 m = lm.x > 0.5 ? (h < 0.85 ? G_IVORY : G_PALE)
           : lm.z > 0.5 ? (h < 0.7 ? G_PATINA : h < 0.9 ? G_EMERALD : G_GOLD)
           : (h < 0.75 ? G_GOLD : h < 0.92 ? G_PALE : G_BRONZE);
    if (y > LIGHT_TOP - 0.34 || length(o) > 1.32) {
      // the gallery and the cap: plain gilt
      c = gdLit(y > LIGHT_TOP + 1.0 ? G_GOLD : G_BRONZE, 0.22, n, rd, 1.0);
    } else {
      c = gdTile(m, tile, f, tx, ty, n, rd, px/0.215/max(dot(n, v), 0.3), 1.0);
    }
    return gdHaze(c, rd, t);
  }
  if (id > 8.5) {
    // ---- the plume: luminous gold smoke, drawn in curling spirals of leaf
    float age = q.x, ndv = max(dot(n, v), 0.0);
    vec3 a = abs(n);
    vec2 u = a.y > max(a.x, a.z) ? n.xz*sign(n.y) : a.x > a.z ? n.zy*sign(n.x) : n.xy*sign(n.z);
    float r = length(u), th = atan(u.y, u.x)/6.2832;
    float turn = fract(r*2.3 - th + age*3.0 + uT*0.03);
    float fw = px/(8.0 + 27.0*age)*2.3/max(ndv, 0.4);
    float curl = (1.0 - smoothstep(0.15 - fw, 0.15 + fw, abs(turn - 0.5)))*smoothstep(0.9, 0.7, r);
    float lit = max(dot(n, uSun), 0.0), wrap = dot(n, uSun)*0.5 + 0.5;
    // the smoke glows from within, redder where it is young and the lava lights it from below
    float young = smoothstep(0.32, 0.0, age);
    vec3 smoke = vec3(0.075, 0.030, 0.006)*(0.3 + 1.6*wrap*wrap) + vec3(0.9, 0.16, 0.02)*young*young*(0.25 + 0.75*max(-n.y, 0.0));
    smoke += sunC*G_GOLD.rgb*0.05*pow(1.0 - ndv, 2.0)*wrap;
    vec2 hb = gdBump(u*14.0 + age*30.0);
    vec3 nl = normalize(n + vec3(hb.x, hb.y, -hb.x)*0.9);
    vec3 leaf = gdLit(G_GOLD, 0.36, nl, rd, 1.0) + G_GOLD.rgb*(0.16 + 0.6*young);
    c = mix(smoke, leaf, curl*(0.9 - 0.45*smoothstep(0.55, 1.0, age)));
    // the puff thins at its rim and as it ages
    float thin = pow(1.0 - ndv, 3.0)*0.85 + 0.5*smoothstep(0.7, 1.0, age);
    c = mix(c, gdSky(rd), min(thin, 0.92)*(1.0 - 0.6*curl));
    return gdHaze(c, rd, t);
  }
  if (id > 7.5) {
    // ---- the wall of the cave: tesserae in the dark, glinting in the lamp and the daylight
    if (t < 0.05) return vec3(0.0012, 0.001, 0.0009);
    vec2 cl = caveLight(p, n);
    vec2 f; vec3 tx, ty;
    vec2 tile = gdTess(p, n, 0.62, f, tx, ty);
    float h = hash(tile + 5.0), r1 = hash(tile + 11.0), r2 = hash(tile + 23.0);
    vec4 m = h < 0.34 ? G_DARK : h < 0.56 ? G_BRONZE : h < 0.80 ? G_GOLD : h < 0.88 ? G_PALE : h < 0.95 ? G_TEAL : G_IVORY;
    float fw = px/0.62/max(dot(n, v), 0.3);
    float edge = 0.5 - max(abs(f.x), abs(f.y));
    float sharp = smoothstep(0.55, 0.2, fw);
    vec2 tilt = (vec2(r1, r2) - 0.5)*0.5 + f*smoothstep(0.22, 0.5, 0.5 - edge)*1.1 + gdBump((tile + f)*5.0)*m.w;
    vec3 nn = normalize(n + (tx*tilt.x + ty*tilt.y)*sharp);
    vec3 f0 = mix(vec3(0.05), m.rgb, m.w);
    float rough = mix(0.18, 0.3, m.w);
    // the lamp at the back of the chamber, the braziers at the mouth, the day outside
    vec3 lampC = vec3(1.0, 0.60, 0.22);
    vec3 l = uCaveLamp - p;
    float att = 1.0/(1.0 + dot(l, l)/110.0);
    l = normalize(l);
    vec3 alb = m.rgb*(0.75 + 0.5*r1);
    c = alb*(0.0035 + lampC*att*(0.25 + 0.75*max(dot(nn, l), 0.0))*mix(0.5, 0.22, m.w));
    c += lampC*gdSpec(f0, rough, nn, v, l)*att*3.0;
    for (int i = 0; i < 2; i++) {
      vec3 b = uBrazier[i] + vec3(0.0, 0.45, 0.0) - p;
      float ab = 1.0/(1.0 + dot(b, b)/14.0);
      b = normalize(b);
      c += lampC*ab*(alb*max(dot(nn, b), 0.0)*0.3 + gdSpec(f0, rough, nn, v, b)*1.5);
    }
    vec2 out2 = normalize(uCave.xy - uCave.zw);
    vec3 day = normalize(vec3(out2.x, 0.3, out2.y));
    vec3 dayC = vec3(0.30, 0.27, 0.22)*cl.x;
    c += dayC*(alb*(0.25 + 0.75*max(dot(nn, day), 0.0))*mix(0.6, 0.3, m.w) + gdSpec(f0, rough + 0.1, nn, v, day)*1.5);
    // a faint sheen wherever the wall turns from the eye, so the vault can be read
    c += f0*vec3(0.02, 0.014, 0.008)*pow(1.0 - max(dot(nn, v), 0.0), 3.0)*(1.0 + 6.0*att + 4.0*cl.x);
    float grout = 1.0 - smoothstep(0.06 - fw, 0.06 + fw, edge);
    return mix(c, vec3(0.0008), grout*(0.4 + 0.6*sharp));
  }
  // ---- the boat
  float two = dot(n, v) < 0.0 ? -1.0 : 1.0;
  vec3 nb = n*two;
  if (id < 3.5) {
    // the hull: gilt under clear lacquer, a band of onyx set with squares, a bronze deck
    vec2 hb = gdBump(q.zy*vec2(9.0, 14.0));
    vec3 nn = normalize(nb + toWorld(vec3(0.0, hb.y, hb.x))*0.35);
    if (q.y > 0.262) {
      float plank = abs(fract(q.x*9.0) - 0.5);
      c = gdLit(mix(G_BRONZE, G_GOLD, 0.6), 0.38, nb, rd, 1.0)*(0.5 + 0.5*smoothstep(0.02, 0.09, plank));
    } else if (q.y > 0.105 && q.y < 0.215) {
      vec2 u = vec2(q.z*9.0, (q.y - 0.105)/0.11);
      vec2 f = abs(fract(u) - 0.5);
      float hh = hash(floor(u) + 3.0);
      float sq = 1.0 - smoothstep(0.26, 0.30, max(f.x, f.y*0.8));
      c = gdLit(G_ONYX, 0.1, nb, rd, 1.0);
      c = mix(c, gdLit(hh < 0.6 ? G_GOLD : hh < 0.85 ? G_IVORY : G_RED, 0.2, nn, rd, 1.0), sq);
      float trim = 1.0 - smoothstep(0.035, 0.06, min(u.y, 1.0 - u.y));
      c = mix(c, gdLit(G_PALE, 0.2, nb, rd, 1.0), trim);
    } else {
      c = gdLit(G_GOLD, 0.2, nn, rd, 1.0);
      // the lacquer over it: a second, glassy highlight
      c += sunC*gdSpec(vec3(0.05), 0.06, nb, v, uSun)*0.6;
      c *= 0.55 + 0.45*smoothstep(-0.05, 0.1, q.y);        // the wet foot of the hull is darker
    }
  } else if (id < 4.5 || (id > 5.5 && id < 6.5)) {
    // sails: ivory enamel, soft in the shade and glowing when the sun stands behind them,
    // with a hem of gold leaf
    bool main_ = id < 4.5;
    vec3 s = main_ ? sailLocal(q) : q;
    float ed = main_ ? sdTri(s.zy, vec2(0.08, 0.5), vec2(0.08, 2.45), vec2(-1.2, 0.5))
                     : sdTri(q.zy, vec2(0.24, 0.42), vec2(0.2, 2.1), vec2(1.32, 0.42));
    float ndl = dot(nb, uSun);
    vec3 ivory = main_ ? G_IVORY.rgb : mix(G_IVORY.rgb, G_PALE.rgb, 0.22);
    // seams between the panels, and the belly's shade
    float seam = 1.0 - smoothstep(0.004, 0.012, abs(fract(s.y*3.2 + 0.2*s.z) - 0.5)/3.2);
    c = ivory*(sunC*(max(ndl, 0.0)*0.30 + max(-ndl, 0.0)*0.17*vec3(1.0, 0.85, 0.6)) + gdAmb(nb)*1.4 + gdHorizon()*0.25);
    c += sunC*gdSpec(vec3(0.05), 0.35, nb, v, uSun)*0.5 + gdEnv(reflect(rd, nb))*0.05;
    c *= 1.0 - 0.22*seam;
    c *= 0.82 + 0.18*smoothstep(-0.5, -0.05, ed);          // fuller, and so brighter, to the edge
    if (main_) {
      // a scatter of Klimt's little squares along the luff
      vec2 u = s.zy*8.0;
      vec2 f = abs(fract(u) - 0.5);
      float hh = hash(floor(u) + 7.0);
      float zone = smoothstep(-0.55, -0.1, s.z)*smoothstep(2.0, 1.5, s.y)*smoothstep(-0.05, -0.12, ed);
      if (hh > 1.0 - 0.34*zone && max(f.x, f.y) < 0.33) {
        vec4 m = hh > 0.95 ? G_RED : hh > 0.86 ? G_PALE : G_GOLD;
        c = gdLit(m, 0.26, normalize(nb + toWorld(vec3(0.0, hash(floor(u)) - 0.5, hash(floor(u) + 1.0) - 0.5))*0.3), rd, 1.0) + m.rgb*0.10;
      }
    }
    float hem = smoothstep(-0.065, -0.05, ed);
    vec2 hb = gdBump(s.zy*30.0);
    vec3 nh = normalize(nb + toWorld(vec3(0.0, hb.y, hb.x))*0.6);
    c = mix(c, gdLit(G_GOLD, 0.28, nh, rd, 1.0) + G_GOLD.rgb*(0.05 + 0.1*max(-ndl, 0.0)), hem);
  } else if (id < 5.5) c = gdLit(G_BRONZE, 0.25, nb, rd, 1.0) + G_GOLD.rgb*0.02;      // mast and boom
  // the pennant: red enamel
  else c = G_RED.rgb*1.5*(sunC*(0.2 + 0.25*abs(dot(nb, uSun))) + 0.08) + sunC*gdSpec(vec3(0.05), 0.3, nb, v, uSun)*0.4;
  // under the rock she is lit by the lamp and by what daylight reaches in
  if (landAt(uPos).r > 0.5 && caveD(vec3(uPos.x, 0.5, uPos.y)) < 0.5) {
    vec2 cl = caveLight(p, nb);
    c *= 0.05 + 0.55*cl.x + vec3(1.0, 0.62, 0.26)*1.5*cl.y;
  }
  return c;
}

vec3 post_gold(vec3 col, vec3 rd, vec2 fc, float k){
  // the glare of the sun over whatever stands near it
  float s = max(dot(rd, uSun), 0.0);
  float s16 = pow(s, 16.0);
  col += gdSunC()*G_GOLD.rgb*(0.012*s16 + 0.05*s16*s16*s16*s16)*(gHit < 0.5 ? 1.0 : 0.45);
  // the brightest gold blooms: it is lifted, and bleeds towards white
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  float hot = smoothstep(0.7, 2.6, lum);
  col = mix(col, col*1.35 + lum*vec3(0.10, 0.085, 0.05), hot);
  // tone curve (each channel on its own, so strong gold pales as it burns out) and gamma
  col = 1.0 - exp(-col*1.25);
  col = pow(col, vec3(0.4545));
  col = mix(col, col*col*(3.0 - 2.0*col), 0.25);
  vec2 w = fc/uRes - 0.5;
  col *= 1.0 - 0.75*dot(w, w)*(0.6 + 1.6*dot(w, w));
  col.r += 0.004;                                    // the black is a warm black
  return col + (hash(fc) + hash(fc + 37.0) - 1.0)/255.0;
}
`,
};
