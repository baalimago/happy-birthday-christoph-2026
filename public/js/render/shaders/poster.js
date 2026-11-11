// View 0, the Riviera: the poster's palette (navy, cream, coral, amber, teal, a low sun) painted
// with light. A sky with a sun and clouds, water that mirrors it and shows the sand under the
// shallows, land with materials, shadows and haze, a boat with cloth sails.
//
// Colours are linear in here (P3 squares what the screen would show); post_poster grades the
// picture and turns it back.

import { PORTS } from './scene.js';

export const poster = {
  id: 'poster',
  smoke: true,
  glsl: /* glsl */ `
#define P3(r, g, b) (vec3(r, g, b)*vec3(r, g, b))
const vec3 P_NAVY = P3(0.071,0.188,0.290), P_CREAM = P3(1.0,0.957,0.863);
const vec3 P_CORAL = P3(0.937,0.416,0.298), P_YELLOW = P3(0.984,0.800,0.380);
const vec3 P_RUST = P3(0.659,0.196,0.102), P_SAND = P3(0.960,0.840,0.600);
const vec3 P_LAMP = P3(1.0,0.66,0.27);          // firelight
const vec3 P_DEEP = P3(0.030,0.455,0.455);      // what deep water scatters back

// the light of the low sun and of the sky; both redden as the day ends
vec3 p_sun(){ return mix(vec3(1.0,0.82,0.60)*1.75, vec3(1.0,0.50,0.24)*1.55, uEnd); }
vec3 p_amb(){ return mix(vec3(0.44,0.52,0.64), vec3(0.40,0.32,0.50), uEnd)*0.72; }

// the air: the colour of the sky without its sun and clouds. Also what the water mirrors and
// what distance fades to.
vec3 p_air(vec3 rd){
  float y = clamp(rd.y, 0.0, 1.0);
  vec3 c = mix(mix(P3(1.0,0.900,0.640), P3(1.0,0.640,0.330), uEnd),
               mix(P3(0.985,0.780,0.520), P3(0.950,0.440,0.330), uEnd), smoothstep(0.0, 0.13, y));
  c = mix(c, mix(P3(0.830,0.740,0.680), P3(0.600,0.340,0.470), uEnd), smoothstep(0.07, 0.36, y));
  c = mix(c, mix(P3(0.400,0.590,0.730), P3(0.150,0.180,0.380), uEnd), smoothstep(0.24, 0.80, y));
  float sd = dot(rd, uSun);
  c *= mix(vec3(0.74,0.80,0.93), vec3(1.0), smoothstep(-0.9, 0.7, sd));   // cooler away from the sun
  sd = max(sd, 0.0);
  return c*1.25 + p_sun()*(0.10*pow(sd, 5.0) + 0.25*pow(sd, 48.0));
}
float p_fbm(vec2 u){ return 0.55*noise(u) + 0.30*noise(u*2.13 + 7.1) + 0.15*noise(u*4.7 + 3.3); }

vec3 sky_poster(vec3 rd, vec2 fc, float k){
  vec3 c = p_air(rd), sc = p_sun();
  float ang2 = 2.0*(1.0 - dot(rd, uSun)), r = 0.027 + 0.012*uEnd;
  c += sc*(8.0*(1.0 - smoothstep(r*r*0.75, r*r*1.15, ang2)) + 0.9*exp(-ang2/(r*r*7.0)));
  if (rd.y > 0.004) {
    // a few long clouds: lit where they face the sun, dusky underneath
    vec2 u = rd.xz/(rd.y + 0.11)*vec2(0.62, 0.95) + uWind.xy*uT*0.003 + 11.0;
    float d = p_fbm(u);
    float cover = smoothstep(0.50, 0.74, d)*smoothstep(0.004, 0.05, rd.y);
    if (cover > 0.002) {
      float lit = clamp(0.5 + 3.2*(d - p_fbm(u + normalize(uSun.xz)*0.30)), 0.0, 1.0);
      vec3 shade = p_amb()*0.75 + c*0.28;
      vec3 bright = sc*0.55 + c*0.45;
      vec3 cc = mix(shade, bright, lit) + sc*0.45*pow(max(dot(rd, uSun), 0.0), 10.0)*(1.0 - cover);
      c = mix(c, cc, cover*0.9);
    }
  }
  return c;
}
// distance: things sink into the colour of the air at the horizon
vec3 p_fog(vec3 c, vec3 rd, float t){
  float f = max(1.0 - exp(-t*0.0008), smoothstep(0.88*FAR, FAR, t));
  return mix(c, p_air(normalize(vec3(rd.x, 0.025, rd.z))), f);
}

// the paint of the boat: ids as in the scene, q in her own coordinates
vec3 p_paint(float id, vec3 q){
  vec3 rk = rocketMark(id, q);
  if (rk.x > 1.5) return mix(P3(1.0,0.88,0.40)*1.7, P3(1.0,0.30,0.06)*1.1, smoothstep(0.0, 0.8, rk.z));
  if (rk.x > 0.5) return rk.y > 1.5 ? P3(0.22,0.22,0.25) : rk.y > 0.5 ? P3(0.86,0.16,0.12) : P3(0.95,0.94,0.90);
  if (id < 3.5) {
    if (q.y > 0.262) {
      // the deck: planks, a pale rail round it, the cockpit aft
      vec3 teak = P3(0.72,0.52,0.31)*(0.82 + 0.18*step(0.12, fract(q.x*11.0)));
      float rail = length(vec2(q.x*(1.0 + 0.5*smoothstep(0.2, 1.4, q.z))/0.47, q.z/1.32));
      float well = length(vec2(q.x/0.25, (q.z + 0.62)/0.40));
      if (well < 1.0) teak = well > 0.82 ? P_CREAM*0.85 : P3(0.30,0.27,0.26);
      return rail > 0.9 ? P_CREAM*0.85 : teak;
    }
    if (q.y > 0.13 && q.y < 0.2) return P_YELLOW;
    return q.y < 0.015 ? P_RUST*0.8 : P_NAVY*1.25;
  }
  if (id < 4.5) {
    vec3 c = (q.y > 1.05 && q.y < 1.35) ? P_CORAL : P_CREAM*0.94;
    return c*(0.93 + 0.07*smoothstep(0.02, 0.06, abs(fract(q.y*2.6) - 0.5)));   // the seams
  }
  if (id < 5.5) return P3(0.16,0.20,0.26);
  if (id < 6.5) return P_CORAL*(0.93 + 0.07*smoothstep(0.02, 0.06, abs(fract(q.y*2.6 + 0.3) - 0.5)));
  return P_YELLOW;
}

vec3 p_sea(vec3 p, vec3 n, vec3 rd, float t){
  vec4 mk = seaMarks(p, t);
  vec3 sc = p_sun(), ac = p_amb();
  bool cave = mk.w > 0.5;
  vec2 wk = t < 70.0 + 200.0*uRocket ? wakeFoam(p.xz) : vec2(0.0);
  float gust = cave ? 0.0 : gustAt(p.xz);
  vec2 g = rippleSlope(p.xz, t)*(1.0 - 0.4*wk.y)*(cave ? 0.4 : 1.0);
  vec3 nn = normalize(n + vec3(-g.x, 0.0, -g.y));
  // far off the waves are too fine to see: the water there is rough, mirrors less, and more sky
  float rough = 0.22*smoothstep(10.0, 400.0, t) + 0.10*gust;
  float cosv = max(dot(nn, -rd), 0.03 + rough);
  float fres = 0.02 + 0.98*pow(1.0 - cosv, 5.0);
  vec3 r = reflect(rd, nn);
  float under = smoothstep(0.0, -0.2, r.y);          // a wave's back mirrors more water, not sky
  r.y = max(abs(r.y), 0.02) + 0.6*rough;
  r = normalize(r);
  vec2 lb = L(p.xz - uPos);
  vec3 pb = vec3(lb.x, p.y, lb.y);

  if (cave) {
    // black water that catches the firelight and the day at the mouth
    vec2 cl = caveLight(p, nn);
    float fire = 0.85 + 0.15*noise(vec2(uT*6.0, 3.0));
    vec3 day = p_air(vec3(0.0, 0.3, 1.0))*1.1*cl.x, lampL = P_LAMP*2.6*fire*cl.y;
    vec3 body = P3(0.03,0.30,0.33)*(day*0.9 + lampL*0.25);
    vec3 refl = P3(0.50,0.36,0.27)*(lampL*1.5 + day*0.5) + day*0.55*smoothstep(0.15, 0.7, cl.x);
    vec3 c = mix(body, refl, fres);
    vec3 l = uCaveLamp - p;
    float dl = length(l);
    c += P_LAMP*fire*(pow(max(dot(r, l/dl), 0.0), 140.0)*9.0 + pow(max(dot(r, l/dl), 0.0), 14.0)*0.5)
       / (1.0 + dl*dl/900.0);
    c *= 1.0 - 0.5*smoothstep(1.5, 0.9, length(vec2(lb.x/0.52, lb.y/1.42)));
    float foam = max(wk.x, 0.55*smoothstep(-0.16, -0.02, mk.z)*(0.5 + 0.5*noise(p.xz*5.0 + uT*0.3)));
    return mix(c, P_CREAM*(day*0.8 + lampL*0.5 + 0.004), foam);
  }

  float sh = t < 900.0 ? sunOverSea(p) : 1.0;
  if (t < 40.0) sh *= sunPastBoat(pb + vec3(0.0, 0.02, 0.0));

  // what the water mirrors: the air, the land that stands behind it, the boat
  vec3 refl = p_air(r)*(1.0 - 0.45*under);
  float behind = 0.0, wooded = 0.0, s = 7.0;
  for (int i = 0; i < 4; i++) {
    vec3 at = p + r*s;
    vec2 la = landAt(at.xz);
    float c = smoothstep(0.0, 6.0, la.r + 1.5*la.g - at.y);
    if (c > behind) { behind = c; wooded = la.g; }
    s *= 2.7;
  }
  if (behind > 0.0) {
    vec3 lc = mix(P3(0.50,0.36,0.26), P3(0.10,0.22,0.17), smoothstep(0.1, 0.5, wooded))*(ac + sc*0.22);
    refl = mix(refl, p_fog(lc, rd, t + 40.0), behind*0.85);
  }
  if (t < 45.0) {
    float part;
    vec3 rb = toBoat(r);
    float tb = marchBoat(pb, rb, 14.0, part);
    if (tb > 0.0) refl = mix(refl, p_paint(part, boatLocal(pb + rb*tb))*(ac + sc*0.3), 0.9);
  }

  // what shows through it: the sand under the shallows, the deep's own teal
  float depth = max(-mk.z, 0.0);
  depth += 30.0*smoothstep(3.0, 4.9, depth);
  vec3 light = (vec3(0.30) + 0.5*ac + sc*(0.35 + 0.2*sh))*(1.0 - 0.28*gust);
  vec3 through = exp(-vec3(1.05, 0.22, 0.17)*depth*1.15);
  vec3 body = P_SAND*0.8*through*light + P_DEEP*0.8*light*(1.0 - exp(-depth*0.5));
  // sunlight in the faces of the waves that lean to the eye
  float face = clamp(dot(nn.xz, -rd.xz)*2.2 + 0.1, 0.0, 1.0);
  body += P3(0.10,0.66,0.60)*sc*sh*0.10*face*(0.5 + 0.5*max(dot(rd, uSun), 0.0));

  vec3 c = mix(body, refl*0.94, fres);
  // the hull's shadow where she sits
  c *= 1.0 - 0.5*smoothstep(1.5, 0.9, length(vec2(lb.x/0.52, lb.y/1.42)));
  // the sun on the water: a hard glitter close by, a broad path far off
  float e = 70.0 + 800.0/(1.0 + t*0.035);
  float nh = max(dot(nn, normalize(uSun - rd)), 0.0);
  c += sc*sh*pow(nh, e)*(0.5 + e*0.011)*min(1.0, 0.25 + 3.0*fres);

  // foam: the swash on the shore, lines of surf off it, the wake, a whitecap here and there
  float foam = wk.x;
  float shore = -mk.z;
  if (shore < 1.8) {
    float nz = noise(p.xz*1.3 + uT*0.2);
    float swash = smoothstep(0.42, 0.06, shore + 0.3*nz + 0.07*sin(uT*0.9 + p.x*0.21 + p.z*0.17));
    float surf = smoothstep(0.80, 0.97, sin(shore*6.5 + uT*1.2 + nz*4.0))*smoothstep(1.7, 0.4, shore);
    foam = max(foam, max(swash, 0.55*surf*(0.4 + 0.6*nz))*(1.0 - 0.5*smoothstep(300.0, 900.0, t)));
  }
  if (t < 450.0) foam = max(foam, seaFoam(p.xz, sea(p.xz))*(1.0 - smoothstep(250.0, 450.0, t)));
  c = mix(c, P_CREAM*(ac + sc*sh*0.5)*0.9, clamp(foam, 0.0, 1.0));
  if (uRocket > 0.5) {
    // the flame on the water astern
    vec2 fl = lb - vec2(0.0, -2.6);
    c += (0.25 + 0.75*foam)*P_LAMP*0.8/(1.0 + dot(fl, fl)*0.45);
  }
  float f = max(1.0 - exp(-t*0.0008), smoothstep(0.88*FAR, FAR, t))*0.93;
  return mix(c, p_air(normalize(vec3(rd.x, 0.025, rd.z))), f);
}

vec3 p_land(vec3 p, vec3 n, vec3 rd, float t){
  vec4 lm = landMarks(p, t);
  vec2 s = landAt(p.xz);
  vec3 sc = p_sun(), ac = p_amb();
  float lod = lodAt(t), df = dot(n, uSun);
  float big = noise(p.xz*0.045), mid = noise(p.xz*0.31), fine = noise(p.xz*1.3);

  // the ground: dry grass, rock where it is steep, strata in the cliffs, sand by the water
  vec3 grass = mix(P3(0.44,0.50,0.23), P3(0.76,0.66,0.36), smoothstep(0.25, 0.8, big + 0.5*mid - 0.2));
  float grain = t < 160.0 ? noise(p.xz*4.7) : 0.5;                                // tufts and stones
  grass *= (0.86 + 0.28*fine)*(0.85 + 0.3*grain);
  grass = mix(grass, P3(0.30,0.42,0.20), 0.5*smoothstep(0.55, 0.8, noise(p.xz*0.13 + 9.0)));   // greener hollows
  float band = p.y*0.33 + 0.7*noise(p.xz*0.12);
  float layer = smoothstep(0.10, 0.22, abs(fract(band) - 0.5));
  vec3 rock = mix(P3(0.86,0.62,0.42), P3(0.72,0.44,0.30), mid);
  rock = mix(P3(0.55,0.25,0.17), rock, layer);
  rock = mix(rock, P3(0.93,0.80,0.62), 0.6*smoothstep(0.30, 0.42, abs(fract(band*0.31 + 0.2) - 0.5)));
  rock *= 0.85 + 0.3*fine;
  float steep = 1.0 - smoothstep(0.58, 0.83, n.y + 0.1*(mid - 0.5));
  steep = max(steep, 0.8*smoothstep(0.70, 0.78, noise(p.xz*0.23 + 17.0) + 0.15*fine));   // outcrops
  vec3 alb = mix(grass, rock, steep);
  float ao = 1.0;

  // Mount Panic: ash and dark rock up the cone
  vec2 v = p.xz - uVolcano.xy;
  float vr = length(v);
  float cone = 1.0 - smoothstep(0.30, 0.72, vr/uVolcanoR + 0.12*(mid - 0.5));
  if (cone > 0.0) {
    vec3 basalt = mix(P3(0.20,0.18,0.19), P3(0.40,0.22,0.17), smoothstep(0.45, 0.8, noise(p.xz*0.07 + 3.0)));
    alb = mix(alb, basalt*(0.75 + 0.5*fine), cone);
  }

  if (lm.z > 1.5) alb = P3(0.50,0.38,0.31)*(0.7 + 0.5*fine);                       // a rock awash
  else alb = mix(alb, P_SAND*(0.9 + 0.16*fine),
                 (1.0 - smoothstep(1.0, 2.3, s.r + 0.5*(mid - 0.5)))*smoothstep(0.5, 0.8, n.y));
  alb *= mix(vec3(0.60,0.56,0.50), vec3(1.0), smoothstep(0.05, 0.38, p.y + 0.1*fine));   // wet at the water

  bool tree = lm.x > 0.0;
  if (tree) {
    // firs: dark at the foot, light at the tip, no two quite the same green
    float up = (lm.x - 0.5)*2.0;
    float own = mix(hash(floor(p.xz/3.4)), mid, 0.4 + 0.6*lod);
    vec3 leaf = mix(P3(0.07,0.24,0.19), P3(0.30,0.47,0.23), 0.2 + 0.6*up);
    leaf = mix(leaf, P3(0.40,0.45,0.18), 0.45*smoothstep(0.55, 0.95, own));
    alb = leaf*(0.78 + 0.4*own)*mix(1.0, 0.82 + 0.36*fine, lod);
    ao = mix(0.35 + 0.65*up, 0.72, lod);
  } else if (s.g > 0.1 && s.r > 1.0) {
    // the floor of the wood: needles, and little sky
    float w = smoothstep(0.1, 0.5, s.g);
    alb = mix(alb, P3(0.33,0.29,0.17), 0.7*w);
    ao = 1.0 - 0.45*w;
  }

  float sh = 0.0;
  if (df > -0.25) {
    sh = t < 650.0 ? sunOverLand(p + vec3(0.0, 0.06 + 0.002*t, 0.0), lod) : 1.0;
    sh = mix(sh, 1.0, smoothstep(450.0, 650.0, t));
  }
  // needles let the light wrap round a tree
  float dif = (tree ? clamp((df + 0.25)/1.25, 0.0, 1.0) : max(df + 0.12*(grain - 0.5), 0.0))*sh;
  // the sun, the sky (warm and bright on the sun's side), and what the ground throws back
  vec3 light = sc*dif + (ac*(0.45 + 0.55*n.y) + sc*0.13*(0.6 + 0.4*sh))*ao
             + sc*P3(0.80,0.62,0.45)*0.07*(1.0 - 0.5*n.y)*ao;
  vec3 c = alb*light;

  if (cone > 0.0) {
    // the glow of the lake on the crater's rim, and the lava itself
    float rim = smoothstep(uVolcano.w*2.4, uVolcano.w, vr)*smoothstep(uVolcano.z - 16.0, uVolcano.z - 2.0, p.y);
    c += alb*P_LAMP*3.0*rim;
    if (lm.y > 0.5) {
      float heat = smoothstep(0.25, 0.8, 0.45 + 0.3*sin(6.2832*lm.w) + 0.55*(noise(p.xz*0.55 + lm.w) - 0.5)
                 + 0.3*fine);
      c = mix(c*0.3 + P3(0.55,0.10,0.04)*0.5, mix(P3(1.0,0.36,0.08)*2.2, P3(1.0,0.86,0.42)*5.0, heat),
              0.3 + 0.7*heat);
    }
  }
  return p_fog(c, rd, t);
}

vec3 p_wall(vec3 p, vec3 n, vec3 rd, float t){
  if (t < 0.05) return P3(0.10,0.08,0.09);            // the cut face of the rock the eye is in
  vec2 cl = caveLight(p, n);
  float fire = 0.85 + 0.15*noise(vec2(uT*6.0, 3.0));
  float mid = noise(p.xz*0.9 + p.y*0.7), band = p.y*0.4 + 0.6*noise(p.xz*0.3);
  vec3 alb = mix(P3(0.50,0.33,0.25), P3(0.74,0.55,0.40), smoothstep(0.12, 0.3, abs(fract(band) - 0.5)));
  float crag = noise(p.xz*3.1 + p.y*2.3) - 0.5 + 0.5*(noise(vec2(p.x + p.z, p.y)*7.0) - 0.5);
  alb *= (0.7 + 0.6*mid)*(1.0 + 0.55*crag)*mix(0.5, 1.0, smoothstep(0.1, 1.3, p.y));   // dark and wet by the water
  vec2 e = normalize(uCave.zw - uCave.xy);
  float mouth = 0.3 + 0.7*clamp(dot(n.xz, -e), 0.0, 1.0);
  // the day comes in at the mouth and off the water; the fire lights the chamber
  vec3 day = p_air(vec3(0.0, 0.3, 1.0))*1.25*cl.x*mouth;
  day += P3(0.10,0.55,0.55)*0.5*cl.x*clamp(-n.y + 0.3, 0.0, 1.0);
  // ripples of light thrown up from the water
  float rip = noise(p.xz*1.6 + vec2(p.y*1.9 + uT*0.5, -uT*0.35));
  day *= 1.0 + 0.9*smoothstep(0.55, 0.8, rip)*smoothstep(3.0, 0.3, p.y);
  vec3 l = normalize(uCaveLamp - p);
  vec3 c = alb*(day + P_LAMP*3.2*fire*cl.y + vec3(0.010,0.011,0.016));
  c += P_LAMP*fire*cl.y*1.2*pow(max(dot(reflect(rd, n), l), 0.0), 18.0)*smoothstep(1.6, 0.2, p.y);
  return t > 60.0 ? p_fog(c, rd, t) : c;
}

vec3 p_light(float id, vec3 p, vec3 n, vec3 rd, float t){
  vec4 lm = lightMarks(id, p);
  int port = int(id - 9.5);
  vec3 sc = p_sun(), ac = p_amb();
  float df = dot(n, uSun);
  vec3 c;
  if (lm.w > 0.5) {
    // the lamp, or a flame
    vec3 glow = mix(P3(1.0,0.90,0.62), P3(1.0,0.84,0.42), lm.z)*(4.0 + 2.0*lm.z);
    if (uPort[port].w > 0.5) glow = mix(P_LAMP*1.3, P3(1.0,0.90,0.55)*4.0, pow(clamp(dot(n, -rd), 0.0, 1.0), 2.5));
    vec3 glass = P3(0.20,0.30,0.38)*(ac + sc*max(df, 0.0)) + 0.3*p_air(reflect(rd, n));
    c = mix(glass, glow, lm.y);
  } else {
    vec3 alb;
    float sheen = 0.0;
    if (uPort[port].w > 0.5) { alb = P3(0.20,0.17,0.16); sheen = 0.5; }
    else {
      float y = p.y - uPort[port].z, rr = length(p.xz - uPort[port].xy);
      alb = lm.x > 0.5 ? P_CREAM*0.92 : mix(P_CORAL, P_NAVY*1.3, lm.z);
      if (y > LIGHT_TOP + 1.2) alb = mix(P_RUST, P_NAVY, lm.z);                   // the cap
      else if (y > LIGHT_TOP - 0.4 && rr > 0.95) alb = P_NAVY;                    // the gallery
      alb *= 0.9 + 0.1*noise(vec2(atan(n.x, n.z)*6.0, y*3.0));
      alb *= mix(0.6, 1.0, smoothstep(-0.5, 1.5, y));                             // weathered at the foot
    }
    float sh = df > 0.0 && t < 500.0 ? sunOverLand(p + n*0.05, 1.0) : 1.0;
    c = alb*(sc*max(df, 0.0)*sh + ac*(0.5 + 0.5*n.y) + sc*P3(0.80,0.62,0.45)*0.07*(1.0 - n.y));
    c += sc*sh*sheen*pow(max(dot(reflect(rd, n), uSun), 0.0), 30.0);
    if (uPort[port].w > 0.5) c += alb*P_LAMP*2.5*smoothstep(-1.6, 0.0, p.y - uBrazier[0].y);
  }
  return p_fog(c, rd, t);
}

vec3 p_boat(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t){
  vec3 sc = p_sun(), ac = p_amb();
  vec3 alb = p_paint(id, q);
  if (rocketMark(id, q).x > 1.5) return alb;
  float df = dot(n, uSun);
  vec2 lb = L(p.xz - uPos);
  vec3 pb = vec3(lb.x, p.y, lb.y), nb = toBoat(n), sb = toBoat(uSun);
  bool cloth = id > 3.5 && (id < 4.5 || id > 5.5);
  // the sun, where the land and her own sails leave it
  float open = sunOverSea(vec3(uPos.x, 1.0, uPos.y));
  vec2 cl = vec2(0.0);
  if (seaMarks(vec3(uPos.x, 0.0, uPos.y), 0.0).w > 0.5) { open = 0.0; cl = caveLight(p, n); }
  float sh = open;
  if (open > 0.0 && (df > 0.0 || cloth))
    sh *= sunPastBoat(df > 0.0 ? pb + nb*0.03 : pb + sb*(0.02 + 0.05/max(-df, 0.2)));
  vec3 amb = ac*(0.55 + 0.45*n.y);
  vec3 sea = P_DEEP*0.5*(ac + sc*0.4*open)*(0.5 - 0.5*n.y);                       // light off the water
  vec3 c;
  if (cloth) {
    // cloth: the sun on its face, and through it when it stands behind
    float front = max(df, 0.0), back = max(-df, 0.0);
    c = alb*(sc*sh*(0.9*front + 0.15) + amb + sea)
      + alb*sqrt(alb)*sc*sh*back*0.62;
  } else {
    c = alb*(sc*max(df, 0.0)*sh + amb + sea);
    // paint and varnish: a highlight, and the sky in the hull's sides
    float gloss = id < 3.5 && q.y < 0.262 ? 1.0 : 0.35;
    vec3 r = reflect(rd, n);
    c += sc*sh*gloss*0.9*pow(max(dot(r, uSun), 0.0), 60.0);
    float fres = 0.04 + 0.6*pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
    c = mix(c, r.y > 0.0 ? p_air(r) : P_DEEP*0.4*(ac + sc*0.4), gloss*fres);
    if (id < 3.5) c *= mix(0.7, 1.0, smoothstep(0.0, 0.12, q.y));                 // wet at the waterline
  }
  if (uRocket > 0.5) {
    // the flame lights her from astern
    vec3 l = vec3(0.0, 0.5, -2.5) - pb;
    float dl = length(l), on = dot(nb, l/dl);
    c += alb*P_LAMP*(1.6 + 0.4*sin(uT*37.0))*(cloth ? 0.3 + 0.7*abs(on) : max(on, 0.0))/(1.0 + 0.35*dl*dl);
  }
  if (open <= 0.0 && cl.x + cl.y > 0.0) {
    // in the cave: the day behind her, the fire ahead
    float fire = 0.85 + 0.15*noise(vec2(uT*6.0, 3.0));
    vec3 l = normalize(uCaveLamp - p);
    float wrap = cloth ? 0.35 + 0.65*abs(dot(n, l)) : max(dot(n, l), 0.0);
    c = alb*(p_air(vec3(0.0, 0.3, 1.0))*cl.x*0.9 + P_LAMP*3.0*fire*wrap/(1.0 + dot(uCaveLamp - p, uCaveLamp - p)/110.0)
        + vec3(0.012));
  }
  return c;
}

vec3 shade_poster(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k){
  if (id < 1.5) return p_sea(p, n, rd, t);
  if (id < 2.5) return p_land(p, n, rd, t);
  if (id > 9.5) return p_light(id, p, n, rd, t);
  if (id > 8.5) return p_fog(P3(0.36,0.33,0.38)*(p_amb() + p_sun()*max(dot(n, uSun), 0.0)), rd, t);
  if (id > 7.5) return p_wall(p, n, rd, t);
  return p_boat(id, p, n, rd, q, t);
}

// spray: thrown from the bow at speed in a rough sea, and the rooster tail behind the rocket
vec3 p_spray(vec3 col, vec3 ro, vec3 rd, float t){
  float bow = clamp((uSpeed - 3.0)/4.0, 0.0, 1.0)*clamp(uSea*1.8 - 0.8, 0.0, 1.0);
  if (bow + uRocket < 0.02) return col;
  vec2 lo = L(ro.xz - uPos);
  vec3 o = vec3(lo.x, ro.y, lo.y), d = toBoat(rd);
  vec3 oc = o - vec3(0.0, 0.8, uRocket > 0.5 ? -3.0 : 0.6);
  float reach = uRocket > 0.5 ? 6.6 : 2.6, b = dot(oc, d);
  if (b*b - dot(oc, oc) + reach*reach < 0.0) return col;
  float clear = 1.0;
  for (int i = 0; i < 14; i++) {
    float fi = float(i), h1 = hash(vec2(fi, 3.0)), h2 = hash(vec2(fi, 5.0));
    bool tail = i >= 6;
    if (tail ? uRocket < 0.5 : bow < 0.02) continue;
    float s = fract(uT*(tail ? 1.5 : 0.8) + fi*0.37 + h1), side = mod(fi, 2.0)*2.0 - 1.0;
    vec3 c = tail ? vec3(side*0.9*s*h2, 0.1 + 3.0*s*(1.0 - s)*(0.5 + 0.7*h1), -2.9 - 5.2*s)
                  : vec3(side*(0.25 + 0.9*s), 0.1 + 1.9*s*(1.0 - s)*(0.6 + 0.6*h2), 1.3 - 1.7*s);
    float r = tail ? 0.2 + 0.8*s : 0.12 + 0.5*s;
    float a = (tail ? 0.42 : 0.55*bow)*(1.0 - s)*smoothstep(0.0, 0.08, s);
    vec3 pc = o - c;
    float bb = dot(pc, d), far2 = dot(pc, pc) - bb*bb;
    if (bb > 0.0 || -bb > t || far2 > r*r) continue;
    float x = 1.0 - far2/(r*r);
    clear *= 1.0 - a*x*x;
  }
  float day = seaMarks(vec3(uPos.x, 0.0, uPos.y), 0.0).w > 0.5 ? 0.12 : 1.0;      // dim in the cave
  vec3 white = P_CREAM*(p_amb() + p_sun()*0.55)*day + uRocket*P_LAMP*0.35;
  return mix(white, col, clear);
}

// the plume: smoke over the finished picture, lit by the sun and from below by the lava
vec3 smoke_poster(vec3 col, vec3 ro, vec3 rd, float t){
  vec3 n;
  float age, tn;
  float a = plumeSoft(ro, rd, t, n, age, tn);
  col = p_spray(col, ro, rd, t);
  if (a < 0.003) return col;
  vec3 alb = mix(P3(0.34,0.31,0.35), P3(0.74,0.70,0.72), smoothstep(0.1, 0.9, age));
  float df = dot(n, uSun);
  vec3 c = alb*(p_sun()*0.85*smoothstep(-0.45, 0.85, df) + p_amb()*(0.6 + 0.4*n.y));
  c += P_LAMP*2.4*(1.0 - smoothstep(0.02, 0.30, age))*clamp(0.75 - n.y, 0.0, 1.0);
  return mix(col, p_fog(c, rd, tn), a);
}

vec3 post_poster(vec3 col, vec3 rd, vec2 fc, float k){
  // lit lamps glow
  for (int i = 0; i < ${PORTS}; i++) {
    vec4 port = uPort[i];
    if (port.w < -0.5) continue;
    vec3 c = port.w > 0.5 ? uCaveLamp : vec3(port.x, port.z + LIGHT_TOP + 0.7, port.y);
    vec3 v = c - gRo;
    float d = length(v);
    if (gT < d - 3.0 || d > FAR) continue;
    float ang2 = 2.0*(1.0 - dot(rd, v/d)), size = max(2.6/d, 0.0035);
    if (ang2 > size*size*9.0) continue;
    col += P_LAMP*0.9*lightMarks(10.0 + float(i), c).y*exp(-ang2/(size*size));
  }
  if (uRocket > 0.5) {
    vec3 v = vec3(W(vec3(0.0, 0.0, -2.35)), 0.5).xzy - gRo;
    float d = length(v);
    if (gT > d - 1.5) col += P_LAMP*(0.3 + 0.08*sin(uT*41.0))*exp(-2.0*(1.0 - dot(rd, v/d))*d*d/0.5);
  }
  // exposure, a mild filmic curve, back to what the screen shows
  // a soft shoulder on the brightest channel keeps every hue; the very bright bleach to white
  float top = max(col.r, max(col.g, col.b)) + 1e-4;
  float lit = top/pow(1.0 + pow(top, 2.4), 1.0/2.4);
  col = mix(col*(lit/top), vec3(lit), smoothstep(1.2, 5.0, top)*0.85);
  col = sqrt(col);
  col = mix(col, col*col*(3.0 - 2.0*col), 0.22);
  vec2 uv = fc/uRes - 0.5;
  col *= 1.0 - 0.28*dot(uv, uv);
  return col + (hash(fc) - 0.5)/255.0;
}
`,
};
