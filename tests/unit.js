// Unit tests for the pure modules. Run with `make test` (needs gjs only,
// no running GNOME Shell).
import System from 'system';

import {applyTone, contrastText, dominantColor, hexToRgb, hslToRgb, rgbToHex, rgbToHsl, shift} from '../colors.js';
import {buildGtkCss, buildShellCss, mergeGtkBlock, usesAutoColor} from '../targets.js';

let failed = 0;
function check(ok, name) {
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok)
        failed++;
}
const uri = p => `file://${p}`;

// colors.js
check(rgbToHex(hslToRgb(rgbToHsl(hexToRgb('#3a7bd5')))) === '#3a7bd5', 'hex -> hsl -> hex round trip');
check(contrastText('#000000') === '#ffffff' && contrastText('#ffeb3b') === '#000000', 'contrastText picks the readable color');
check(shift('#000000', 0.08) === '#141414', 'shift lightens black for hover');
check(rgbToHsl(hexToRgb(applyTone('#ff5500', 'dark')))[2] < 0.2, 'dark tone is dark');

const red = new Uint8Array(4 * 4 * 4).map((_, i) => [230, 30, 30, 255][i % 4]);
check(hexToRgb(dominantColor(red, 4, 4, 16, 4))[0] > 200, 'dominantColor of a red icon is red');
check(dominantColor(new Uint8Array(4 * 4 * 4), 4, 4, 16, 4) === null, 'fully transparent icon gives null');

// targets.js: shell CSS
let css = buildShellCss({'quick-toggle': {colorMode: 'black'}}, uri);
check(css.includes('#uiGroup .quick-toggle') && !css.includes('stage '), 'rules use the #uiGroup prefix');
check(css.includes('background-color: #000000 !important') && css.includes('color: #ffffff !important'), 'black background gets white text');
check(css.includes('#uiGroup .quick-toggle:hover'), 'hover color supplied');
check(css.includes('-st-accent-color') && css.indexOf('-st-accent-color') > css.indexOf(':hover'), 'on toggles fall back to the accent color, after the off rules');

css = buildShellCss({'quick-toggle-on': {colorMode: 'custom', color: '#ffeb3b'}}, uri);
check(css.includes('#ffeb3b') && css.includes('color: #000000 !important') && !css.includes('-st-accent-color'), 'custom on color gets dark text and no accent fallback');

const auto = {panel: {colorMode: 'auto'}};
check(usesAutoColor(auto) && buildShellCss(auto, uri, null) === '', 'auto color waits for a window color');
check(buildShellCss(auto, uri, '#3a7bd5').includes('#uiGroup #panel.transparent-panel'), 'auto panel color covers all panel states');
check(buildShellCss({menus: {colorMode: 'custom', color: 'bogus'}}, uri) === '', 'invalid custom color is ignored');

css = buildShellCss({menus: {image: '/t/m.png', fit: 'tile'}}, uri);
check(css.includes('url("file:///t/m.png")') && css.includes('background-size: auto'), 'texture rule with tile size');

// targets.js: GTK CSS and gtk.css merging
const gtk = buildGtkCss({files: {colorMode: 'custom', color: '#101820'}}, uri);
check(gtk.includes('background-color: #101820') && gtk.includes('background: none'), 'Files color without a texture');
const user = '/* user rules */\n.a { color: red; }\n';
check(mergeGtkBlock(user, '') === user, 'no block and no css leaves gtk.css untouched');
const added = mergeGtkBlock(user, gtk);
check(added.startsWith(user.trimEnd()), 'block is appended after existing rules');
check(mergeGtkBlock(added, gtk).split('textures start').length === 2, 'block is replaced, not duplicated');
check(mergeGtkBlock(added, '') === user, 'removing the block restores the file');

print(failed ? `\n${failed} failed` : '\nall passed');
if (failed)
    System.exit(1);
