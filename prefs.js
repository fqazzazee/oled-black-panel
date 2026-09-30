import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {hexToRgb, rgbToHex} from './colors.js';
import {TARGETS, buildGtkCss, mergeGtkBlock, parseTextures, resolveImage} from './targets.js';
import {removeTexture, renderTexture} from './imaging.js';

const COLOR_MODES = [
    ['theme', 'Theme'],
    ['black', 'Black'],
    ['custom', 'Custom color'],
    ['auto', 'Match active window'],
];
const TONES = [['dark', 'Dark'], ['muted', 'Muted'], ['vivid', 'Vivid']];
const FITS = [['cover', 'Fill'], ['tile', 'Tile']];
const TEXTS = [['default', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']];

// GTK 4 apps (Files) read this file at startup; we own one marked block in it
const GTK_CSS = GLib.build_filenamev([GLib.get_user_config_dir(), 'gtk-4.0', 'gtk.css']);

const DIM_DEBOUNCE_MS = 400;

const indexOf = (list, key) => Math.max(0, list.findIndex(x => x[0] === key));

export default class OledBlackPanelPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        this._settings = this.getSettings();
        this._timeouts = new Set();
        this._settingsIds = [];

        const page = new Adw.PreferencesPage({
            title: 'Colors & Textures',
            icon_name: 'applications-graphics-symbolic',
        });
        const desktop = new Adw.PreferencesGroup({
            title: 'Desktop',
            description: 'Give each area its own background color, an image texture, or both. ' +
                '“Match active window” follows the color of the focused app’s icon.',
        });
        const apps = new Adw.PreferencesGroup({
            title: 'Apps',
            description: 'Apps read their style when they start. Restart Files to see changes.',
        });
        for (const t of TARGETS)
            (t.side === 'gtk' ? apps : desktop).add(this._targetRow(t));

        const restart = new Adw.ActionRow({
            title: 'Restart Files',
            subtitle: 'Closes all Files windows',
        });
        const restartButton = new Gtk.Button({label: 'Restart', valign: Gtk.Align.CENTER});
        restartButton.connect('clicked', () => {
            try {
                Gio.Subprocess.new(['nautilus', '-q'], Gio.SubprocessFlags.NONE);
            } catch (e) {
                this._toast(`Could not restart Files: ${e.message}`);
            }
        });
        restart.add_suffix(restartButton);
        apps.add(restart);

        const resetGroup = new Adw.PreferencesGroup();
        const reset = new Adw.ActionRow({
            title: 'Reset everything',
            subtitle: 'Removes every color and texture',
        });
        const resetButton = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER});
        resetButton.add_css_class('destructive-action');
        resetButton.connect('clicked', () => this._resetAll());
        reset.add_suffix(resetButton);
        resetGroup.add(reset);

        page.add(desktop);
        page.add(apps);
        page.add(resetGroup);
        window.add(page);

        window.connect('close-request', () => {
            this._timeouts.forEach(id => GLib.source_remove(id));
            this._timeouts.clear();
            this._settingsIds.forEach(id => this._settings.disconnect(id));
            this._settingsIds = [];
            return false;
        });
    }

    _load() {
        return parseTextures(this._settings.get_string('textures'));
    }

    _save(all) {
        this._settings.set_string('textures', JSON.stringify(all));
        this._writeGtkCss(all);
    }

    // Merge `patch` into one area's entry; re-render the image when needed
    _update(target, patch, rerender) {
        const all = this._load();
        const old = all[target.id];
        const entry = {
            colorMode: 'theme',
            tone: target.autoTone ?? 'dark',
            dim: 0,
            fit: 'cover',
            text: 'default',
            ...old,
            ...patch,
        };
        if (rerender && entry.source) {
            try {
                entry.image = renderTexture(resolveImage(entry.source, this.path), target.id, {
                    ...entry,
                    tileSize: target.side === 'shell' ? target.tileSize : null,
                });
            } catch (e) {
                this._toast(`Could not use this image: ${e.message}`);
                return;
            }
            if (old?.image !== entry.image)
                removeTexture(old?.image);
        }
        all[target.id] = entry;
        this._save(all);
    }

    _clearImage(target) {
        const all = this._load();
        const entry = all[target.id];
        if (!entry)
            return;
        removeTexture(entry.image);
        delete entry.image;
        delete entry.source;
        this._save(all);
    }

    _resetAll() {
        Object.values(this._load()).forEach(e => removeTexture(e.image));
        this._settings.reset('textures');
        this._writeGtkCss(this._load());
    }

    _targetRow(target) {
        const row = new Adw.ExpanderRow({title: target.title, subtitle: target.subtitle ?? ''});

        // Prefix preview: the texture if there is one, else the color
        const thumb = new Gtk.Picture({
            content_fit: Gtk.ContentFit.COVER,
            width_request: 64,
            height_request: 36,
            valign: Gtk.Align.CENTER,
        });
        const swatch = new Gtk.DrawingArea({
            content_width: 64,
            content_height: 36,
            valign: Gtk.Align.CENTER,
        });
        let swatchRgb = null;
        swatch.set_draw_func((_area, cr, width, height) => {
            if (swatchRgb) {
                cr.setSourceRGB(...swatchRgb.map(c => c / 255));
                cr.rectangle(0, 0, width, height);
                cr.fill();
            }
            cr.$dispose();
        });
        for (const w of [thumb, swatch]) {
            w.add_css_class('card');
            w.set_overflow(Gtk.Overflow.HIDDEN);
            row.add_prefix(w);
        }

        // ---- Color ----
        const modes = target.side === 'gtk' ? COLOR_MODES.filter(m => m[0] !== 'auto') : COLOR_MODES;
        const mode = new Adw.ComboRow({
            title: 'Background',
            model: Gtk.StringList.new(modes.map(m => m[1])),
        });
        row.add_row(mode);

        const colorRow = new Adw.ActionRow({title: 'Color'});
        const colorButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            valign: Gtk.Align.CENTER,
        });
        colorRow.add_suffix(colorButton);
        row.add_row(colorRow);

        const tone = new Adw.ComboRow({
            title: 'Tone',
            subtitle: 'How the window’s color is adapted',
            model: Gtk.StringList.new(TONES.map(x => x[1])),
        });
        row.add_row(tone);

        // ---- Texture ----
        const imageRow = new Adw.ActionRow({title: 'Texture image'});
        const choose = new Gtk.Button({label: 'Choose…', valign: Gtk.Align.CENTER});
        const clear = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            tooltip_text: 'Remove texture',
            valign: Gtk.Align.CENTER,
        });
        clear.add_css_class('flat');
        imageRow.add_suffix(choose);
        imageRow.add_suffix(clear);
        row.add_row(imageRow);

        const dim = new Adw.SpinRow({
            title: 'Darken',
            subtitle: 'Percent',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 90, step_increment: 5, page_increment: 10}),
        });
        row.add_row(dim);

        const fit = new Adw.ComboRow({
            title: 'Fit',
            subtitle: 'Tile repeats small seamless patterns',
            model: Gtk.StringList.new(FITS.map(f => f[1])),
        });
        row.add_row(fit);

        let text = null;
        if (target.textSelectors?.length !== 0) {
            text = new Adw.ComboRow({
                title: 'Text color',
                subtitle: 'Automatic: readable on the background color, otherwise the theme’s',
                model: Gtk.StringList.new(TEXTS.map(x => x[1])),
            });
            row.add_row(text);
        }

        let syncing = false;
        const sync = () => {
            syncing = true;
            const e = this._load()[target.id];
            const colorMode = e?.colorMode ?? 'theme';
            const image = e?.image ? resolveImage(e.image, this.path) : null;

            thumb.set_filename(image);
            thumb.visible = !!image;
            swatchRgb = colorMode === 'black' ? [0, 0, 0]
                : colorMode === 'custom' ? hexToRgb(e?.color) : null;
            swatch.visible = !image && !!swatchRgb;
            swatch.queue_draw();

            mode.selected = indexOf(modes, colorMode);
            colorRow.visible = colorMode === 'custom';
            const rgba = new Gdk.RGBA();
            rgba.parse(e?.color ?? '#000000');
            colorButton.rgba = rgba;
            tone.visible = colorMode === 'auto';
            tone.selected = indexOf(TONES, e?.tone ?? target.autoTone ?? 'dark');

            imageRow.subtitle = e?.source ? GLib.path_get_basename(e.source) : 'None';
            clear.visible = dim.visible = fit.visible = !!image;
            dim.value = e?.dim ?? 0;
            fit.selected = indexOf(FITS, e?.fit);
            if (text)
                text.selected = indexOf(TEXTS, e?.text);
            syncing = false;
        };
        // Also picks up resets and edits from other windows
        this._settingsIds.push(this._settings.connect('changed::textures', sync));

        mode.connect('notify::selected', () => {
            if (syncing)
                return;
            const patch = {colorMode: modes[mode.selected][0]};
            // First pick of Custom starts from black, like the old OLED look
            if (patch.colorMode === 'custom' && !this._load()[target.id]?.color)
                patch.color = '#000000';
            this._update(target, patch, false);
        });
        colorButton.connect('notify::rgba', () => {
            if (syncing)
                return;
            const {red, green, blue} = colorButton.rgba;
            this._update(target, {color: rgbToHex([red * 255, green * 255, blue * 255])}, false);
        });
        tone.connect('notify::selected', () => {
            if (!syncing)
                this._update(target, {tone: TONES[tone.selected][0]}, false);
        });

        choose.connect('clicked', () => this._pickImage(path =>
            this._update(target, {source: path}, true)));
        clear.connect('clicked', () => this._clearImage(target));

        // Spin buttons fire on every step; render once the value settles
        let dimTimeout = 0;
        dim.connect('notify::value', () => {
            if (syncing)
                return;
            if (dimTimeout) {
                GLib.source_remove(dimTimeout);
                this._timeouts.delete(dimTimeout);
            }
            dimTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DIM_DEBOUNCE_MS, () => {
                this._timeouts.delete(dimTimeout);
                dimTimeout = 0;
                this._update(target, {dim: dim.value}, true);
                return GLib.SOURCE_REMOVE;
            });
            this._timeouts.add(dimTimeout);
        });
        fit.connect('notify::selected', () => {
            if (!syncing)
                this._update(target, {fit: FITS[fit.selected][0]}, true);
        });
        text?.connect('notify::selected', () => {
            if (!syncing)
                this._update(target, {text: TEXTS[text.selected][0]}, false);
        });

        sync();
        return row;
    }

    _pickImage(onPicked) {
        const filter = new Gtk.FileFilter({name: 'Images'});
        filter.add_mime_type('image/*');
        const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
        filters.append(filter);
        const dialog = new Gtk.FileDialog({
            title: 'Choose a Texture Image',
            filters,
            default_filter: filter,
            modal: true,
        });
        dialog.open(this._window, null, (d, res) => {
            let file;
            try {
                file = d.open_finish(res);
            } catch {
                return; // cancelled
            }
            const path = file?.get_path();
            if (path)
                onPicked(path);
            else
                this._toast('Pick a local file');
        });
    }

    _writeGtkCss(all) {
        const css = buildGtkCss(all, p => Gio.File.new_for_path(resolveImage(p, this.path)).get_uri());
        let current = '';
        try {
            const [, bytes] = GLib.file_get_contents(GTK_CSS);
            current = new TextDecoder().decode(bytes);
        } catch {
            // no gtk.css yet
        }

        const next = mergeGtkBlock(current, css);
        if (next === current)
            return;

        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(GTK_CSS), 0o755);
            GLib.file_set_contents(GTK_CSS, next);
        } catch (e) {
            this._toast(`Could not update ${GTK_CSS}: ${e.message}`);
        }
    }

    _toast(title) {
        this._window.add_toast(new Adw.Toast({title, timeout: 5}));
    }
}
