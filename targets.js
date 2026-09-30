// Theme areas that can take a color and/or texture image, shared by
// extension.js (GNOME Shell side) and prefs.js (settings window + GTK side).
// Plain JS on purpose: no GI imports, so both processes can load it.
//
// An entry (stored as JSON in the `textures` setting, keyed by area id):
//   {colorMode, color, tone, source, image, dim, fit, text}
// colorMode: 'theme' | 'black' | 'custom' (uses `color`) | 'auto' (active
// window's app icon, adapted by `tone`). `source` is the image the user
// picked, `image` the processed copy that is actually used. Relative image
// paths resolve against the extension folder.

import {applyTone, contrastText, hexToRgb, shift} from './colors.js';

export const TARGETS = [
    {
        id: 'panel',
        title: 'Top bar',
        side: 'shell',
        selectors: ['#panel'],
        // stylesheet.css pins these panel states to black
        colorSelectors: [
            '#panel',
            '#panel:overview',
            '#panel.transparent-panel',
            '#panel.dark-panel',
            '#panel.light-panel',
            '#panel.contrasted-panel',
        ],
        textSelectors: ['#panel .panel-button'],
        tileSize: [3840, 128],
    },
    {
        id: 'quick-toggle',
        title: 'Quick settings buttons',
        subtitle: 'Toggles when off, and the top row of round buttons',
        side: 'shell',
        interactive: true,
        selectors: [
            '.quick-toggle',
            '.quick-toggle-has-menu .quick-toggle-menu-button',
            '.quick-settings-system-item .icon-button',
        ],
        tileSize: [640, 192],
    },
    {
        id: 'quick-toggle-on',
        title: 'Quick settings buttons (on)',
        subtitle: 'Toggles that are switched on. Theme: your accent color',
        side: 'shell',
        interactive: true,
        autoTone: 'vivid',
        selectors: [
            '.quick-toggle:checked',
            '.quick-toggle-has-menu .quick-toggle-menu-button:checked',
        ],
        tileSize: [640, 192],
    },
    {
        id: 'menus',
        title: 'Menus',
        subtitle: 'Quick settings panel, calendar, app and panel menus',
        side: 'shell',
        selectors: ['.popup-menu-content'],
        textSelectors: ['.popup-menu-content', '.popup-menu-item'],
        tileSize: [1024, 1600],
    },
    {
        id: 'cards',
        title: 'Cards',
        subtitle: 'Notifications, calendar events, weather, quick settings submenus',
        side: 'shell',
        interactive: true,
        selectors: [
            '.message',
            '.events-button',
            '.world-clocks-button',
            '.weather-button',
            '.quick-toggle-menu',
        ],
        tileSize: [1024, 512],
    },
    {
        id: 'dock',
        title: 'Dock',
        subtitle: 'Dash to Dock and the overview dash. For a color, turn off “Customize the dash color” in Dash to Dock',
        side: 'shell',
        selectors: ['#dash .dash-background'],
        textSelectors: [],
        tileSize: [2560, 1600],
    },
    {
        id: 'osd',
        title: 'Pop-ups',
        subtitle: 'Volume and brightness OSD, Alt+Tab, workspace switcher',
        side: 'shell',
        selectors: ['.osd-window', '.switcher-list', '.workspace-switcher'],
        tileSize: [1600, 640],
    },
    {
        id: 'files',
        title: 'Files',
        subtitle: 'File area of the Files app',
        side: 'gtk',
        selectors: ['.nautilus-grid-view', '.nautilus-list-view'],
        // Inner views paint their own solid background over ours
        clearSelectors: [
            '.nautilus-grid-view gridview',
            '.nautilus-list-view columnview',
            '.nautilus-list-view columnview > listview',
        ],
    },
];

export const TEXT_COLORS = {light: '#ffffff', dark: '#000000'};

export function resolveImage(path, extensionPath) {
    return path.startsWith('/') ? path : `${extensionPath}/${path}`;
}

export function parseTextures(json) {
    try {
        const value = JSON.parse(json);
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
}

export function usesAutoColor(textures) {
    return TARGETS.some(t => t.side === 'shell' && textures[t.id]?.colorMode === 'auto');
}

// Background color for an area, or null to leave the theme's
function backgroundFor(target, entry, autoColor) {
    switch (entry?.colorMode) {
    case 'black':
        return '#000000';
    case 'custom':
        return hexToRgb(entry.color) ? entry.color.toLowerCase() : null;
    case 'auto':
        return target.side === 'shell' && autoColor
            ? applyTone(autoColor, entry.tone ?? target.autoTone ?? 'dark') : null;
    default:
        return null;
    }
}

// Explicit Light/Dark wins; otherwise pick whichever reads on our color
function textFor(entry, background) {
    return TEXT_COLORS[entry?.text] ?? (background ? contrastText(background) : null);
}

// `#uiGroup` prefix: every shell chrome actor (top bar, menus, OSDs, dock)
// lives inside it, and the extra id outranks the theme and stylesheet.css
// whatever order St loads the stylesheets in. (`stage` would not work: the
// theme's root node has no element type, so it never matches.)
const shellSel = (list, pseudo = '') => list.map(s => `#uiGroup ${s}${pseudo}`).join(',\n');
const rule = (sel, body) => `${sel} {\n${body.map(l => `  ${l};`).join('\n')}\n}`;

export function buildShellCss(textures, uriFor, autoColor = null) {
    const rules = [];
    const backgrounds = {};
    for (const t of TARGETS.filter(x => x.side === 'shell')) {
        const e = textures[t.id];
        if (!e)
            continue;
        const bg = backgroundFor(t, e, autoColor);
        backgrounds[t.id] = bg;
        const colorSel = t.colorSelectors ?? t.selectors;
        if (bg) {
            rules.push(rule(shellSel(colorSel), [`background-color: ${bg} !important`]));
            // Overriding the base color with !important also overrides the
            // theme's hover/pressed colors, so supply our own
            if (t.interactive) {
                rules.push(rule(shellSel(colorSel, ':hover'), [`background-color: ${shift(bg, 0.08)} !important`]));
                rules.push(rule(shellSel(colorSel, ':active'), [`background-color: ${shift(bg, 0.16)} !important`]));
            }
        }
        if (e.image) {
            rules.push(rule(shellSel(t.selectors), [
                `background-image: url("${uriFor(e.image)}") !important`,
                `background-size: ${e.fit === 'tile' ? 'auto' : 'cover'} !important`,
            ]));
        }
        const text = textFor(e, bg);
        const textSel = t.textSelectors ?? t.selectors;
        if (text && textSel.length)
            rules.push(rule(shellSel(textSel), [`color: ${text} !important`]));
    }

    // The "off" selectors also match switched-on toggles. When "off" is
    // customized and "on" is not, put the theme's on-look back explicitly.
    const [toggle, menuButton] = TARGETS.find(x => x.id === 'quick-toggle-on').selectors;
    const offCustomized = backgrounds['quick-toggle'] || TEXT_COLORS[textures['quick-toggle']?.text];
    if (offCustomized && !backgrounds['quick-toggle-on']) {
        for (const [sel, base] of [
            [toggle, '-st-accent-color'],
            [menuButton, 'st-mix(-st-accent-color, #ffffff, 85%)'],
        ]) {
            rules.push(rule(shellSel([sel]), [
                `background-color: ${base} !important`,
                'color: -st-accent-fg-color !important',
            ]));
            rules.push(rule(shellSel([sel], ':hover'), [`background-color: st-lighten(${base}, 4%) !important`]));
            rules.push(rule(shellSel([sel], ':active'), [`background-color: st-lighten(${base}, 9%) !important`]));
        }
    }
    if (textures['quick-toggle']?.image && !textures['quick-toggle-on']?.image)
        rules.push(rule(shellSel([toggle, menuButton]), ['background-image: none !important']));

    return rules.join('\n\n');
}

export function buildGtkCss(textures, uriFor) {
    const rules = [];
    for (const t of TARGETS.filter(x => x.side === 'gtk')) {
        const e = textures[t.id];
        const bg = backgroundFor(t, e, null);
        if (!e?.image && !bg)
            continue;
        const body = [];
        if (bg)
            body.push(`background-color: ${bg}`);
        if (e.image) {
            const tile = e.fit === 'tile';
            body.push(
                `background-image: url("${uriFor(e.image)}")`,
                `background-size: ${tile ? 'auto' : 'cover'}`,
                `background-repeat: ${tile ? 'repeat' : 'no-repeat'}`,
                'background-position: center');
        }
        const text = textFor(e, bg);
        if (text)
            body.push(`color: ${text}`);
        rules.push(rule(t.selectors.join(',\n'), body));
        rules.push(rule(t.clearSelectors.join(',\n'), ['background: none']));
    }
    return rules.join('\n\n');
}

const MARK_START = '/* oled-black-panel:textures start */';
const MARK_END = '/* oled-black-panel:textures end */';

// Replace (or remove, when css is empty) our marked block in gtk.css,
// leaving everything else in the file as it was.
export function mergeGtkBlock(current, css) {
    const start = current.indexOf(MARK_START);
    const end = current.indexOf(MARK_END);
    const hasBlock = start !== -1 && end > start;
    if (!hasBlock && !css)
        return current;

    let rest = current;
    if (hasBlock) {
        const before = current.slice(0, start).trimEnd();
        const after = current.slice(end + MARK_END.length).trim();
        rest = [before, after].filter(Boolean).join('\n\n');
    }
    rest = rest.trimEnd();
    if (!css)
        return rest ? `${rest}\n` : '';
    return `${rest ? `${rest}\n\n` : ''}${MARK_START}\n${css}\n${MARK_END}\n`;
}
