// Color helpers shared by extension.js and prefs.js. Plain JS, no GI imports.
// Colors are '#rrggbb' strings or [r, g, b] arrays with 0-255 channels.

export function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
    if (!m)
        return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
    return `#${[r, g, b].map(c => Math.round(Math.min(255, Math.max(0, c)))
        .toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min)
        return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r)
        h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g)
        h = (b - r) / d + 2;
    else
        h = (r - g) / d + 4;
    return [h / 6, s, l];
}

export function hslToRgb([h, s, l]) {
    if (s === 0)
        return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = t => {
        t = (t + 1) % 1;
        if (t < 1 / 6)
            return p + (q - p) * 6 * t;
        if (t < 1 / 2)
            return q;
        if (t < 2 / 3)
            return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

// WCAG relative luminance
function luminance(rgb) {
    const [r, g, b] = rgb.map(c => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Black or white, whichever reads better on `hex`
export function contrastText(hex) {
    const L = luminance(hexToRgb(hex));
    return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#000000' : '#ffffff';
}

// Move lightness toward white (amount > 0) or black (amount < 0), 0-1
export function shift(hex, amount) {
    const [h, s, l] = rgbToHsl(hexToRgb(hex));
    const target = amount > 0 ? 1 : 0;
    return rgbToHex(hslToRgb([h, s, l + (target - l) * Math.abs(amount)]));
}

// How an auto (active window) color is adapted per area. Dark suits
// backgrounds behind white text; vivid suits switched-on toggles.
export const TONES = {
    dark: ([h, s]) => [h, Math.min(s, 0.55), 0.16],
    muted: ([h, s]) => [h, Math.min(s, 0.35), 0.30],
    vivid: ([h, s]) => [h, s < 0.12 ? s : Math.min(0.85, Math.max(s, 0.6)), 0.5],
};

export function applyTone(hex, tone) {
    const fn = TONES[tone] ?? TONES.dark;
    return rgbToHex(hslToRgb(fn(rgbToHsl(hexToRgb(hex)))));
}

// Dominant color of an icon's pixels (RGB or RGBA rows, as from GdkPixbuf).
// Picks the strongest hue family, weighted by saturation, so a small bright
// logo on a white tile still wins over the tile. Mostly-gray icons give gray.
export function dominantColor(bytes, width, height, rowstride, channels) {
    const BINS = 36;
    const bins = Array.from({length: BINS}, () => ({r: 0, g: 0, b: 0, w: 0}));
    const gray = {r: 0, g: 0, b: 0, n: 0};
    let opaque = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * rowstride + x * channels;
            if (channels === 4 && bytes[i + 3] < 128)
                continue;
            opaque++;
            const rgb = [bytes[i], bytes[i + 1], bytes[i + 2]];
            const [h, s, l] = rgbToHsl(rgb);
            if (s < 0.15 || l < 0.08 || l > 0.95) {
                gray.r += rgb[0]; gray.g += rgb[1]; gray.b += rgb[2]; gray.n++;
                continue;
            }
            const bin = bins[Math.floor(h * BINS) % BINS];
            bin.r += rgb[0] * s; bin.g += rgb[1] * s; bin.b += rgb[2] * s; bin.w += s;
        }
    }
    if (!opaque)
        return null;

    // Score each bin together with its neighbors (hues straddle bin edges)
    let best = -1, bestScore = 0;
    for (let i = 0; i < BINS; i++) {
        const score = [-1, 0, 1].reduce((t, d) => t + bins[(i + d + BINS) % BINS].w, 0);
        if (score > bestScore) {
            best = i;
            bestScore = score;
        }
    }
    if (best === -1 || bestScore < opaque * 0.05)
        return gray.n ? rgbToHex([gray.r / gray.n, gray.g / gray.n, gray.b / gray.n]) : null;

    const sum = {r: 0, g: 0, b: 0, w: 0};
    for (const d of [-1, 0, 1]) {
        const bin = bins[(best + d + BINS) % BINS];
        sum.r += bin.r; sum.g += bin.g; sum.b += bin.b; sum.w += bin.w;
    }
    return rgbToHex([sum.r / sum.w, sum.g / sum.w, sum.b / sum.w]);
}
