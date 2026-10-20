// READABILITY of text laid over footage, measured on the real frames. Pure — no I/O: the
// composite hands in the rendered graphic's frame (RGBA, its alpha is where it covers the
// picture) and the film's frame under it (RGB), both at full size.
//
// The standard is WCAG 2.x contrast (relative luminance), as broadcast and web captioning use:
// - white text: 7:1 (AAA). Footage is busier than a page, so the stricter level, not AA's 4.5.
// - coloured words (the accent, a warning's red): 4.5:1 (AA), the minimum the palette already
//   guarantees them on the card ground.
// Text = the graphic's fully opaque, non-dark pixels (letters; a plate or scrim is translucent or
// dark). Background = the FINISHED picture in a thin ring around the letters (picture, scrim,
// plate and shadow together — what the eye actually separates the letters from), inside the
// graphic's own footprint and never the letters' own soft edges. The dimmest
// tenth of the letters is held against the brightest twentieth of that ring: a caption is only as
// readable as its worst word over its brightest patch.

export const MIN_WHITE = 7;
export const MIN_COLOUR = 4.5;

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const LUT = Float32Array.from({ length: 256 }, (_, i) => lin(i));
const lum = (r: number, g: number, b: number) => 0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b];

function percentile(v: Float32Array | number[], p: number): number {
  if (v.length === 0) return NaN;
  const s = Float32Array.from(v).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

export type Contrast = {
  /** Contrast of the white text against its surround, or undefined when none is on screen. */
  white?: number;
  /** Contrast of the coloured words, or undefined when none is on screen. */
  colour?: number;
  /** Bounding box of all the letters, px. */
  box?: { x0: number; y0: number; x1: number; y1: number };
  pass: boolean;
};

/**
 * @param ov   graphic frame, RGBA, w*h*4
 * @param film film frame under it, RGB, w*h*3
 * @param inks the theme's coloured text colours ([r,g,b]); without them any saturated opaque
 *             pixel counts as a coloured letter
 */
export function measureContrast(ov: Uint8Array, film: Uint8Array, w: number, h: number, inks?: number[][], ring = 8): Contrast {
  const n = w * h;
  const text = new Uint8Array(n); // 1 = white letter, 2 = coloured letter
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) {
    const a = ov[i * 4 + 3];
    if (a < 248) continue;
    const r = ov[i * 4], g = ov[i * 4 + 1], b = ov[i * 4 + 2];
    const L = lum(r, g, b);
    if (L < 0.2) continue; // a dark plate or shadow, not a letter
    if (r >= 230 && g >= 230 && b >= 230) text[i] = 1; // white words
    else if (inks) {
      // Coloured words are drawn in the theme's own text colours only (the accent, the warning
      // red): anything else opaque and bright — an emoji, a picture — is not text.
      if (!inks.some(k => Math.abs(k[0] - r) + Math.abs(k[1] - g) + Math.abs(k[2] - b) <= 48)) continue;
      text[i] = 2;
    } else {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      text[i] = mx > 0 && (mx - mn) / mx > 0.25 ? 2 : 1;
    }
    const x = i % w, y = (i / w) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return { pass: true };
  // The ring: pixels within `ring` px of a letter that are not letters themselves (separable
  // max filter over the box only).
  const bx0 = Math.max(0, x0 - ring), bx1 = Math.min(w - 1, x1 + ring), by0 = Math.max(0, y0 - ring), by1 = Math.min(h - 1, y1 + ring);
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const horiz = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    let last = -1e9;
    const row = (by0 + y) * w + bx0;
    for (let x = 0; x < bw; x++) {
      if (text[row + x]) last = x;
      if (x - last <= ring) horiz[y * bw + x] = 1;
    }
    last = 1e9;
    for (let x = bw - 1; x >= 0; x--) {
      if (text[row + x]) last = x;
      if (last - x <= ring) horiz[y * bw + x] = 1;
    }
  }
  const bg: number[] = [];
  const whiteL: number[] = [];
  const colourL: number[] = [];
  for (let x = 0; x < bw; x++) {
    let last = -1e9;
    const near = new Uint8Array(bh);
    for (let y = 0; y < bh; y++) {
      if (horiz[y * bw + x]) last = y;
      if (y - last <= ring) near[y] = 1;
    }
    last = 1e9;
    for (let y = bh - 1; y >= 0; y--) {
      if (horiz[y * bw + x]) last = y;
      if (last - y <= ring) near[y] = 1;
    }
    for (let y = 0; y < bh; y++) {
      const i = (by0 + y) * w + bx0 + x;
      const a = ov[i * 4 + 3] / 255;
      const c = (k: number) => Math.round(film[i * 3 + k] * (1 - a) + ov[i * 4 + k] * a);
      const L = lum(c(0), c(1), c(2));
      if (text[i] === 1) whiteL.push(L);
      else if (text[i] === 2) colourL.push(L);
      // A letter's own soft edge (its colour at partial opacity) is part of the letter, not what
      // it is read against: only the picture and the graphic's dark parts (scrim, plate, shadow)
      // make up the background.
      // And only inside the graphic's own footprint (its plate, scrim or the letters' shadow,
      // alpha ≥ ~10%): a decoration's outer edge against the picture (a plate's accent border) is
      // not what any word is read against.
      // Nor the graphic's own OPAQUE drawn parts (an icon, a disc, a bar): they are drawn things,
      // not what letters are read against — only the picture and the graphic's see-through layers
      // (plate, scrim, shadow, all under ~94% opacity) are.
      else if (near[y] && ov[i * 4 + 3] >= 24 && ov[i * 4 + 3] < 240 && !(lum(ov[i * 4], ov[i * 4 + 1], ov[i * 4 + 2]) >= 0.2)) bg.push(L);
    }
  }
  const Lb = percentile(bg, 0.95);
  const ratio = (letters: number[]) => {
    if (letters.length < 40 || bg.length < 20) return undefined; // a few stray pixels are not text
    const Lt = percentile(letters, 0.1);
    return Lt > Lb ? (Lt + 0.05) / (Lb + 0.05) : 1;
  };
  const white = ratio(whiteL);
  const colour = ratio(colourL);
  return {
    white,
    colour,
    box: { x0, y0, x1, y1 },
    pass: (white === undefined || white >= MIN_WHITE) && (colour === undefined || colour >= MIN_COLOUR),
  };
}

/** How readable text would be on this part of the picture: the brightest twentieth of the box's
 * luminance (lower is better). Used to choose where a movable graphic goes. */
export function boxBrightness(film: Uint8Array, w: number, box: { x0: number; y0: number; x1: number; y1: number }): number {
  const v: number[] = [];
  for (let y = box.y0; y <= box.y1; y += 2) for (let x = box.x0; x <= box.x1; x += 2) {
    const i = (y * w + x) * 3;
    v.push(lum(film[i], film[i + 1], film[i + 2]));
  }
  return percentile(v, 0.95);
}

/**
 * The picture's SUBJECT: where its detail is. Gradient energy on a coarse grid (16x9 cells), lightly
 * smoothed; the subject is the cell with the most, and its box every connected cell above half of
 * that. Pictures are framed on their subject, so the arrow lands on it and moved text avoids it.
 */
export function findSubject(film: Uint8Array, w: number, h: number): { x: number; y: number; box: { x0: number; y0: number; x1: number; y1: number } } {
  const GX = 16, GY = 9;
  const cw = w / GX, ch = h / GY;
  const e = new Float64Array(GX * GY);
  const g = (x: number, y: number) => {
    const i = (y * w + x) * 3;
    return 0.299 * film[i] + 0.587 * film[i + 1] + 0.114 * film[i + 2];
  };
  for (let y = 1; y < h - 1; y += 3) for (let x = 1; x < w - 1; x += 3) {
    const m = Math.abs(g(x + 1, y) - g(x - 1, y)) + Math.abs(g(x, y + 1) - g(x, y - 1));
    e[Math.min(GY - 1, (y / ch) | 0) * GX + Math.min(GX - 1, (x / cw) | 0)] += m;
  }
  const s = new Float64Array(GX * GY);
  for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) {
    let sum = 0, k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= GX || yy >= GY) continue;
      const wgt = dx === 0 && dy === 0 ? 2 : 1;
      sum += e[yy * GX + xx] * wgt;
      k += wgt;
    }
    // Frame edges are rarely the subject: a gentle centre weight.
    const cx = (x + 0.5) / GX - 0.5, cy = (y + 0.5) / GY - 0.5;
    s[y * GX + x] = (sum / k) * (1 - 0.6 * (cx * cx + cy * cy));
  }
  let best = 0;
  for (let i = 1; i < s.length; i++) if (s[i] > s[best]) best = i;
  const keep = new Uint8Array(GX * GY);
  const stack = [best];
  keep[best] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % GX, y = (i / GX) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= GX || yy >= GY) continue;
      const j = yy * GX + xx;
      if (!keep[j] && s[j] >= s[best] * 0.5) {
        keep[j] = 1;
        stack.push(j);
      }
    }
  }
  let bx0 = GX, by0 = GY, bx1 = 0, by1 = 0;
  for (let i = 0; i < keep.length; i++) if (keep[i]) {
    const x = i % GX, y = (i / GX) | 0;
    bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
  }
  return {
    x: Math.round(((best % GX) + 0.5) * cw),
    y: Math.round((((best / GX) | 0) + 0.5) * ch),
    box: { x0: Math.round(bx0 * cw), y0: Math.round(by0 * ch), x1: Math.round((bx1 + 1) * cw) - 1, y1: Math.round((by1 + 1) * ch) - 1 },
  };
}

/** Area of overlap between two boxes, px². */
export function overlap(a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }): number {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}

/** The subject map's grid: 16 x 9 cells, as `findSubject`'s. */
export const SUBJECT_COLS = 16;
export const SUBJECT_ROWS = 9;
/** The thumbnail the subject map is worked out on (a power of two, for the FFT). */
const SALIENCY_N = 64;

/**
 * WHERE THE PICTURE'S SUBJECT IS, cell by cell (16 x 9, the most subject-like cell 1, nothing 0): the
 * picture's spectral residual (Hou & Zhang, "Saliency detection: a spectral residual approach", 2007)
 * — what stands out from the rest of the picture — on a 64 x 64 greyscale thumbnail, softened and
 * gently weighted to the centre the way pictures are framed. Pure.
 *
 * Not `findSubject`'s detail energy: on the round-13 verification films that marked most of the frame
 * (its box 1080-1920 px wide on every picture checked), and a texture the eye passes over outscored
 * the subject — the asphalt round a market table (job 413, 1:40) read busier than the table of knives
 * standing on it. A repeated texture (asphalt, a fleece blanket, pegboard, a planked wall) is what the
 * spectral residual takes OUT, so a cat's face on a fleece (job 412, 1:44), the sleeper's head beside
 * it (0:36) and a phone held up to the camera (job 413, 2:04) stand out from what they lie on.
 */
export function subjectMap(film: Uint8Array, w: number, h: number): number[] {
  const N = SALIENCY_N;
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const x0 = Math.floor((x * w) / N), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / N));
    const y0 = Math.floor((y * h) / N), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / N));
    let s = 0, n = 0;
    for (let yy = y0; yy < y1; yy += 2) for (let xx = x0; xx < x1; xx += 2) {
      const i = (yy * w + xx) * 3;
      s += 0.299 * film[i] + 0.587 * film[i + 1] + 0.114 * film[i + 2];
      n++;
    }
    re[y * N + x] = n ? s / n : 0;
  }
  fft2(re, im, N, false);
  // The log spectrum less its local average is what is unusual in this picture; its phase keeps where.
  const amp = new Float64Array(N * N);
  const phase = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) {
    amp[i] = Math.log(Math.hypot(re[i], im[i]) + 1e-9);
    phase[i] = Math.atan2(im[i], re[i]);
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += amp[((y + dy + N) % N) * N + ((x + dx + N) % N)];
    const m = Math.exp(amp[y * N + x] - s / 9);
    re[y * N + x] = m * Math.cos(phase[y * N + x]);
    im[y * N + x] = m * Math.sin(phase[y * N + x]);
  }
  fft2(re, im, N, true);
  let sal = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) sal[i] = re[i] * re[i] + im[i] * im[i];
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float64Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= N || xx >= N) continue;
        s += sal[yy * N + xx];
        n++;
      }
      next[y * N + x] = s / n;
    }
    sal = next;
  }
  const cells = new Float64Array(SUBJECT_COLS * SUBJECT_ROWS);
  const count = new Float64Array(SUBJECT_COLS * SUBJECT_ROWS);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = Math.min(SUBJECT_ROWS - 1, Math.floor((y * SUBJECT_ROWS) / N)) * SUBJECT_COLS + Math.min(SUBJECT_COLS - 1, Math.floor((x * SUBJECT_COLS) / N));
    cells[c] += sal[y * N + x];
    count[c]++;
  }
  for (let i = 0; i < cells.length; i++) {
    // Frame edges are rarely the subject: the same gentle centre weight as `findSubject`.
    const cx = ((i % SUBJECT_COLS) + 0.5) / SUBJECT_COLS - 0.5, cy = (((i / SUBJECT_COLS) | 0) + 0.5) / SUBJECT_ROWS - 0.5;
    cells[i] = (count[i] ? cells[i] / count[i] : 0) * (1 - 0.6 * (cx * cx + cy * cy));
  }
  const top = cells.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), 0);
  return Array.from(cells, v => (top > 0 && Number.isFinite(v) ? v / top : 0));
}

/** How much of the picture's subject a box on the frame covers: the subject map's mean under it, each
 * cell weighted by the area the box covers (0 = clear of it, 1 = on the most subject-like part). */
export function onSubject(map: number[], box: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number): number {
  const cw = w / SUBJECT_COLS, ch = h / SUBJECT_ROWS;
  let sum = 0, area = 0;
  for (let y = 0; y < SUBJECT_ROWS; y++) for (let x = 0; x < SUBJECT_COLS; x++) {
    const a = overlap(box, { x0: x * cw, y0: y * ch, x1: (x + 1) * cw, y1: (y + 1) * ch });
    if (a <= 0) continue;
    sum += a * (map[y * SUBJECT_COLS + x] ?? 0);
    area += a;
  }
  return area > 0 ? sum / area : 0;
}

/** The box a graphic's drawing covers on its frame (RGBA, w*h*4): every pixel at least `minAlpha`
 * opaque — its plate, stamp and letters, not the faint edge of a shadow. Undefined when nothing is. */
export function footprint(ov: Uint8Array, w: number, h: number, minAlpha = 64): { x0: number; y0: number; x1: number; y1: number } | undefined {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (ov[(y * w + x) * 4 + 3] < minAlpha) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? undefined : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** In-place radix-2 FFT of one row (`re`, `im`, length a power of two); `inverse` scales by 1/n. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] /= n;
  }
}

/** In-place 2-D FFT of an N x N grid: every row, then every column. */
function fft2(re: Float64Array, im: Float64Array, N: number, inverse: boolean): void {
  const r = new Float64Array(N), q = new Float64Array(N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      r[x] = re[y * N + x];
      q[x] = im[y * N + x];
    }
    fft(r, q, inverse);
    for (let x = 0; x < N; x++) {
      re[y * N + x] = r[x];
      im[y * N + x] = q[x];
    }
  }
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      r[y] = re[y * N + x];
      q[y] = im[y * N + x];
    }
    fft(r, q, inverse);
    for (let y = 0; y < N; y++) {
      re[y * N + x] = r[y];
      im[y * N + x] = q[y];
    }
  }
}
