// View 1, the Tractatus terminal: the world as a phosphor tube draws it. Green vectors on
// near-black with amber for what matters: true contour lines on the land, a grid that rides the
// swell, hidden lines hidden, a dim fill under the lines so that forms have volume, and a tube
// (scanlines, bloom, vignette) in front of it all.
//
// Every surface is worked out as two beam intensities, green and amber, plus a white-hot core;
// termBeam() turns them into light and post_terminal() into a picture on glass.

export const terminal = {
  id: 'terminal',
  glsl: /* glsl */ `
const vec3 T_BG = vec3(0.012,0.022,0.020), T_GREEN = vec3(0.20,1.0,0.44);
const vec3 T_AMBER = vec3(1.0,0.66,0.20), T_HOT = vec3(1.0,0.96,0.84);

// a glowing line wherever v crosses an integer: a core w pixels wide and a soft halo. Lines that
// crowd closer than a few pixels fade out instead of filling in.
float termLine(float v, float w){
  float fw = max(fwidth(v), 1e-6);
  float d = abs(fract(v - 0.5) - 0.5)/fw;
  float core = 1.0 - smoothstep(0.5*w - 0.5, 0.5*w + 0.6, d);
  return (core + 0.22*exp(-d*d/(2.2*w*w)))*(1.0 - smoothstep(0.10, 0.34, fw));
}
// the same line broken into dashes: m cuts it wherever a chequer of the plane says so
float termDash(vec2 x, float f){
  vec2 c = step(0.5, fract(x*f));
  return abs(c.x - c.y);
}
// an edge of a form: where the distance jumps by more than the slope of the surface explains,
// or where one thing ends and another begins
float termEdge(float id, float t, vec3 n, vec3 rd){
  float facing = abs(dot(n, rd));
  float m = fwidth(t)*max(facing, 0.06)*1.25*uRes.y/t;
  float rim = 1.0 - smoothstep(0.0, 0.015 + 1.5*fwidth(facing), facing);
  return max(max(smoothstep(5.0, 12.0, m), step(0.5, fwidth(id))), id > 1.5 ? rim : 0.0);
}
// points scattered on the plane, one to a cell or none; px is the size of a pixel there
float termDots(vec2 x, float cell, float r){
  vec2 g = x/cell, c = floor(g);
  float d = length(g - c - 0.2 - 0.6*vec2(hash(c), hash(c + 37.0)))*cell;
  return (1.0 - smoothstep(0.6*r, 1.5*r, d))*step(0.3, hash(c + 91.0));
}
// one of ten 3 by 5 glyphs, i in 0..9; c is the place in a 4 by 6 cell
float termGlyph(int i, ivec2 c){
  const int FONT[10] = int[10](31599, 11415, 1488, 2728, 2, 1040, 4772, 24445, 10752, 3640);
  if (c.x > 2 || c.y > 4) return 0.0;
  return float((FONT[i] >> (c.y*3 + 2 - c.x)) & 1);
}
vec3 termBeam(float g, float a, float hot){
  vec3 tint = mix(T_GREEN, vec3(0.62,0.95,0.30), 0.5*uEnd);   // the green warms as the day ends
  return T_BG + tint*g + T_AMBER*a + T_HOT*hot;
}

vec3 sky_terminal(vec3 rd, vec2 fc, float k){
  float w = max(1.0, 1.25*k), g = 0.0, a = 0.0, hot = 0.0;
  float az = atan(rd.x, rd.z), el = asin(clamp(rd.y, -1.0, 1.0));
  float up = smoothstep(0.0, 0.03, rd.y);
  // a faint grid of bearings and altitudes, ticked along the horizon
  float grid = max(termLine(az*5.7296, w), termLine(el*5.7296, w));
  g += 0.055*grid*up*(1.0 - smoothstep(0.5, 1.2, el));
  g += 0.25*termLine(az*57.296*0.5, w)*step(abs(el - 0.012), 0.008);
  // sparse stars, each a round dot a pixel or two across
  vec2 sg = vec2(az*cos(el), el)*26.0, sc = floor(sg);
  float r = length(sg - sc - 0.2 - 0.6*vec2(hash(sc), hash(sc + 19.0)));
  float px = 26.0/(1.25*uRes.y);
  float star = (1.0 - smoothstep(0.7*w*px, 1.6*w*px, r))*step(0.86, hash(sc + 53.0));
  g += star*(0.35 + 0.65*hash(sc + 7.0))*smoothstep(0.03, 0.12, rd.y);
  // the glow of the horizon, brighter under the sun and amber at the end of the day
  float glow = exp(-abs(rd.y)*16.0), sunward = 0.5 + 0.5*dot(normalize(rd.xz), normalize(uSun.xz));
  float warm = clamp(uEnd + 0.35*sunward*sunward, 0.0, 1.0);
  float amount = glow*(0.10 + 0.22*pow(sunward, 4.0) + 0.10*uEnd);
  g += amount*(1.0 - warm);
  a += amount*warm*1.3;
  // the sun: rings, a disc cut into slats below its middle, and a ring of rays
  vec3 sr = normalize(cross(vec3(0.0, 1.0, 0.0), uSun)), su = cross(uSun, sr);
  vec2 s = vec2(dot(rd, sr), dot(rd, su));
  float d = length(s), R = 0.082;
  if (dot(rd, uSun) > 0.0 && d < 3.2*R) {
    float ring = termLine(d/R, 1.5*w) + 0.8*termLine(d/R*3.0, w)*step(d, R);
    float slat = step(s.y, 0.12*R)*step(0.45 + 0.4*s.y/R, fract(s.y/R*5.5));
    float disc = (1.0 - smoothstep(R*0.97, R, d))*(1.0 - slat);
    float ray = termLine(atan(s.x, s.y)*2.5465, 1.2*w)*step(1.3*R, d)*step(d, 1.75*R);
    a += disc*(0.30 + 0.25*smoothstep(-R, R, s.y)) + step(d, 1.05*R)*ring*0.9 + 0.7*ray;
    a += 0.22*exp(-d*d/(R*R*1.6));
    hot += 0.25*disc*smoothstep(0.75*R, 0.0, d);
    g *= smoothstep(R, 1.4*R, d);
  }
  return termBeam(g, a, hot);
}

vec3 shade_terminal(float id, vec3 p, vec3 n, vec3 rd, vec3 q, float t, vec2 fc, float k){
  float w = max(1.0, 1.25*k), g = 0.0, a = 0.0, hot = 0.0;
  float px = t/(1.25*uRes.y);                  // the size of a pixel out there
  float fog = exp(-t*0.0009);
  float edge = termEdge(id, t, n, rd);
  float lit = clamp(0.5 + 0.5*dot(n, uSun), 0.0, 1.0);
  if (id < 1.5) {
    // ---- the sea
    vec4 mk = seaMarks(p, t);
    float h = landAt(p.xz).r;
    float l4 = max(termLine(p.x*0.25, w), termLine(p.z*0.25, w))*(1.0 - smoothstep(70.0, 190.0, t));
    float l16 = max(termLine(p.x*0.0625, w), termLine(p.z*0.0625, w));
    float l64 = max(termLine(p.x*0.015625, 1.4*w), termLine(p.z*0.015625, 1.4*w));
    float grid = max(max(0.62*l4, 0.8*l16), l64);
    vec2 sx = normalize(uSun.xz);
    float slope = dot(n.xz, sx);                                    // the face of a wave to the sun
    float swell = clamp(0.6 + 1.6*slope + 3.0*p.y, 0.25, 1.5);
    if (mk.w > 0.5) {
      // under the rock: daylight from the mouth, the lamp from the chamber
      vec2 cl = caveLight(p, n);
      g = (0.02 + 0.75*grid)*(0.22 + 0.9*cl.x) + 0.05*cl.x + 0.30*cl.x*cl.x;
      // the lamp lies on the water as a streak of dashes
      float streak = pow(max(dot(reflect(rd, n), normalize(uCaveLamp - p)), 0.0), 80.0);
      streak *= step(0.35, fract(fc.y/max(2.0, floor(3.0*k + 0.5))*0.5));
      a = cl.y*(0.10 + 1.1*grid) + 1.0*streak;
      hot = 0.4*streak*streak;
      if (mk.z > -0.07) g += 0.5*(0.3 + cl.x), a += 0.8*cl.y;
    } else {
      g = 0.014 + 0.06*smoothstep(-0.08, 0.2, p.y);                 // crests catch a little light
      g += grid*swell;
      g += 0.045*smoothstep(150.0, 1200.0, t);                      // lines too fine to see add up
      // the glitter path under the sun: dashes that come and go
      float da = atan(rd.x*sx.y - rd.z*sx.x, dot(rd.xz, sx)), el = -rd.y;
      float wide = 0.04 + 0.28*el;
      float lobe = exp(-da*da/(wide*wide))*exp(-pow(max(el - uSun.y, 0.0)/0.22, 2.0));
      float spec = pow(max(dot(reflect(rd, n), uSun), 0.0), 160.0);
      float row = floor(fc.y/max(2.0, floor(3.0*k + 0.5)));
      float cw = max(2.0, floor(3.0*k + 0.5))*(2.0 + 5.0*hash(vec2(row, 3.0)));
      float gx = (fc.x + 97.0*hash(vec2(row, 11.0)))/cw;
      float on = step(hash(vec2(floor(gx), row) + floor(uT*2.5)*vec2(13.0, 7.0)), 0.34*lobe + 0.35*spec);
      on *= step(fract(gx), 0.72);
      a += on*(0.5 + 0.5*lobe);
      hot += on*0.12*lobe*lobe;
      g += on*0.12;
      // shoals: dotted contours of the depth, closer and brighter as the water shallows
      if (h > -3.6) {
        float sh = smoothstep(-3.6, -0.3, h);
        float cont = termLine(h*2.0 + 0.5, 1.2*w)*termDash(p.xz, 1.1);
        float lfs = log2(max(7.0*px, 0.6)), cs = exp2(floor(lfs));
        float pts = mix(termDots(p.xz, cs, 1.1*w*px), termDots(p.xz, 2.0*cs, 1.1*w*px), fract(lfs));
        a += cont*(0.35 + 1.0*sh) + 0.07*sh*sh + 0.8*pts*sh*sh;
        hot += 0.3*cont*smoothstep(0.75, 1.0, sh);
        g *= 1.0 - 0.6*sh;
      }
      if (mk.z > -0.045) g += 0.6;                      // the water's edge
    }
    // the wake: two bright arms, two fainter ones inside them, and the stern waves between
    vec2 b = L(p.xz - uPos);
    float s = -b.y - 1.15, len = 3.0 + 2.6*uSpeed;
    if (s > 0.0 && s < len && abs(b.x) < 0.4*s + 0.3) {
      float go = smoothstep(0.3, 1.2, uSpeed)*(1.0 - s/len);
      float fwb = fwidth(b.x) + 1e-5;
      float arm = 1.0 - smoothstep(0.0, 0.035 + 0.008*s + fwb, abs(abs(b.x) - 0.32*s));
      float inner = 1.0 - smoothstep(0.0, 0.02 + fwb, abs(abs(b.x) - 0.15*s));
      inner *= step(0.4, fract(s*1.2 - uT*1.8));
      float stern = termLine(s*0.9 - uT*1.4, w)*step(abs(b.x), 0.3*s);
      g += go*(1.3*arm + 0.6*inner + 0.4*stern);
      hot += go*0.5*arm;
    }
    g += 0.6*mk.y;
  } else if (id < 2.5) {
    // ---- the land
    vec4 lm = landMarks(p, t);
    // contours at an interval that doubles with the distance; every fourth is drawn bold
    float lf = log2(max(9.0*px, 1.0)), iv = exp2(-floor(lf));
    float cont = max(max(0.45*(1.0 - fract(lf))*termLine(p.y*iv, w), 0.6*termLine(p.y*iv*0.5, w)),
                     termLine(p.y*iv*0.25, 1.35*w));
    float shade = 0.18 + 1.1*lit*lit;
    g = 0.018 + 0.11*lit*lit + cont*shade + edge*(0.45 + 0.6*lit);
    if (lm.z > 1.5) {
      // a rock awash is a hazard: amber
      a = 0.10 + 0.5*cont + 0.9*edge + 0.35*termDash(p.xz, 1.4);
      g *= 0.25;
    } else if (lm.z > 0.5) {
      g += 0.30*termDots(p.xz, 0.9, 1.1*w*px)*shade;                // sand
    }
    if (lm.x > 0.0) {
      // firs: a dark cone with a bright outline, rungs and a tip; far off, a scatter of points
      float lod = lodAt(t);
      float rung = termLine(lm.x*7.0, w);
      float thin = 1.0 - 0.72*smoothstep(40.0, 190.0, t);
      float near = 0.012 + 0.07*lit*lit + thin*(edge*(0.3 + 0.9*lit*lit) + 0.42*rung*shade)
                 + (0.25 + 0.65*thin)*smoothstep(0.88, 0.99, lm.x) + 0.25*cont*shade;
      float sp = t*0.02/max(sqrt(abs(dot(n, rd))), 0.35), lf = log2(max(sp, 1.0));
      float c0 = exp2(floor(lf)), r = 1.15*w*px;
      float pts = mix(termDots(p.xz, c0, r), termDots(p.xz, 2.0*c0, r), fract(lf));
      float far = 0.014 + 0.07*lit*lit + pts*(0.35 + 0.9*lit) + 0.6*edge + 0.6*cont*shade;
      g = mix(near, far, lod);
    }
    if (lm.y > 0.5) {
      // lava runs in bright dashes
      float run = step(0.45, fract(lm.w));
      a = 0.30 + 0.75*run + 0.5*edge;
      hot = 0.30*run;
      g = 0.0;
    }
  } else if (id > 9.5) {
    // ---- lighthouses and the lights of the cave
    int port = int(id - 9.5);
    vec4 lm = lightMarks(id, p), at = uPort[port];
    float v = 0.0;
    if (at.w > 0.5) {
      if (lm.w > 0.5) {
        float core = pow(abs(dot(n, rd)), 2.0);
        a = (0.5 + 1.2*core)*(0.45 + 0.55*lm.y);
        hot = 0.7*core*lm.y;
      } else v = 0.06 + 0.6*termLine(p.y*2.0, w) + 0.8*edge;
      a += v;
    } else {
      float y = p.y - at.z;
      float mer = termLine(atan(p.x - at.x, p.z - at.y)*1.9099, w);
      float ring = termLine(y/1.72, w);
      v = 0.025 + 0.09*lit*lit + 0.05*lm.x + max(mer*0.6, ring)*(0.3 + 0.9*lit) + edge;
      if (lm.w > 0.5) {
        if (lm.y > 0.5) {
          float core = pow(abs(dot(n, rd)), 3.0);
          a = 1.0 + 0.6*core;
          hot = 0.25 + 0.7*core;
          v = 0.0;
          fog = max(fog, 0.8);                 // a lit lamp carries
        } else v += 0.4*mer;
      }
      if (lm.z > 0.5) g += v; else a += v;     // a light still to be found is drawn in amber
    }
  } else if (id > 8.5) {
    // ---- the plume: a column of glyphs, hot at the crater and thinning as it drifts off
    float u = max(1.0, floor(2.6*k + 0.5));
    vec2 gp = vec2(fc.x, fc.y - uT*9.0*u)/u;
    vec2 cell = floor(gp/vec2(4.0, 6.0));
    ivec2 c = ivec2(gp - cell*vec2(4.0, 6.0));
    c.y = 5 - c.y;
    float body = clamp(dot(n, -rd), 0.0, 1.0);
    float dense = (1.0 - 0.6*q.x)*(0.4 + 0.6*body);
    float tick = floor(uT*1.6 + 5.0*hash(cell + 3.0));
    float on = step(hash(cell + tick*vec2(17.0, 29.0)), dense);
    float gl = on*termGlyph(int(9.99*hash(cell + 61.0 + tick)), c);
    float heat = smoothstep(0.32, 0.0, q.x);
    float v = gl*(0.45 + 0.8*lit) + 0.012 + 0.03*lit*body;
    a = v*heat*1.3;
    g = v*(1.0 - heat);
  } else if (id > 7.5) {
    // ---- the wall of the cave: strata and ribs, lit by the lamp and by the day at the mouth
    if (t < 0.05) {
      g = 0.03 + 0.05*step(0.82, fract((fc.x + fc.y)/(8.0*k)));     // the camera is in the rock
    } else {
      vec2 cl = caveLight(p, n), ax = normalize(uCave.zw - uCave.xy), hc = p.xz - uCave.zw;
      float strata = termLine(p.y, w);
      float along = dot(p.xz - uCave.xy, ax);
      float rib = length(hc) < uCaveShape.y + 0.5
        ? termLine(atan(hc.x, hc.y)*3.8197, w) : termLine(along*0.3333, w);
      float lines = max(strata, 0.8*rib) + 0.7*edge;
      g = (0.02 + 0.6*lines)*(0.10 + 1.1*cl.x) + 0.05*cl.x + 0.30*cl.x*cl.x;
      a = (0.045 + 1.25*lines)*cl.y*1.35;
    }
  } else {
    // ---- the boat
    fog = 1.0;
    float side = id > 3.5 && id < 6.5 && id != 5.0 ? abs(dot(n, uSun)) : dot(n, uSun);
    lit = clamp(0.5 + 0.5*side, 0.0, 1.0);
    float shade = 0.35 + 0.9*lit;
    if (id < 3.5) {
      // the hull: waterlines and stations, planks on the deck
      float deck = step(0.9, n.y);
      float l = mix(max(termLine(q.y*9.0, w), 0.8*termLine(q.z*3.5, w)), termLine(q.x*9.0, w)*0.7, deck);
      g = 0.03 + 0.11*lit*lit + l*shade + edge;
    } else if (id < 4.5 || (id > 5.5 && id < 6.5)) {
      // sails: seams across and a few up and down
      vec3 s = id < 4.5 ? sailLocal(q) : q;
      float l = max(termLine(q.y*4.0, w), 0.6*termLine(s.z*3.0 + q.y*1.2, w));
      g = 0.045 + 0.13*lit*lit + l*shade*(id < 4.5 ? 1.0 : 0.8) + edge;
    } else if (id < 5.5) {
      g = 0.75 + 0.3*lit;
      hot = 0.15;
    } else {
      a = 0.85 + 0.35*lit;
      hot = 0.2*lit;
    }
  }
  return T_BG + (termBeam(g, a, hot) - T_BG)*fog;
}

// the tube: bloom on what is bright, scanlines, a darkening towards the corners of the glass
vec3 post_terminal(vec3 col, vec3 rd, vec2 fc, float k){
  // a hot beam spreads into white and saturates
  float l = max(col.r, max(col.g, col.b));
  col += T_HOT*0.35*smoothstep(0.85, 1.7, l);
  col = 1.0 - exp(-1.35*col);
  // scanlines a whole number of pixels apart, so that they never beat with the pixel grid;
  // a bright beam is a wide beam and fills the gap
  float pitch = max(2.0, floor(3.0*k + 0.5));
  float beam = 0.5 - 0.5*cos(6.2832*(fc.y + 0.5)/pitch);
  float depth = (pitch < 2.5 ? 0.16 : 0.30)*(1.0 - 0.6*smoothstep(0.3, 0.95, l));
  col *= 1.0 - depth*(1.0 - beam);
  col *= 1.06;
  // the glass: a soft vignette, and the corners fall away
  vec2 c = fc/uRes*2.0 - 1.0;
  c *= c;
  col *= 1.0 - 0.20*smoothstep(0.35, 1.5, c.x + c.y) - 0.38*smoothstep(1.45, 2.0, c.x + c.y);
  // grain, a hum bar that drifts up the screen and the faintest flicker
  float grain = hash(fc + floor(uT*24.0)*vec2(37.0, 17.0)) - 0.5;
  col += (0.012 + 0.03*col)*grain;
  col *= 1.0 + 0.025*sin(6.2832*(fc.y/uRes.y - uT*0.11)) + 0.006*sin(uT*31.0);
  return max(col, 0.0);
}
`,
};
