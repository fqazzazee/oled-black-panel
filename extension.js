import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {dominantColor} from './colors.js';
import {buildShellCss, parseTextures, resolveImage, usesAutoColor} from './targets.js';

const ICON_SIZE = 48;
// Alt+Tab and quick focus hops fire several changes; restyle once it settles
const AUTO_DEBOUNCE_MS = 150;

// Fixed OLED styling lives in stylesheet.css; GNOME Shell loads/unloads it
// with the extension. Per-area colors and textures (set in the preferences
// window) become a second, generated stylesheet that is rebuilt whenever
// the setting, or the active window's color, changes.
export default class OledBlackPanel extends Extension {
    enable() {
        this._cssFile = null;
        this._loadedTheme = null;
        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), this.uuid]);
        this._removeStaleCss();
        this._autoColor = null;
        this._iconColors = new Map();
        this._iconTheme = null;
        this._autoTimeout = 0;
        this._tracking = false;

        this._settings = this.getSettings();
        this._settings.connectObject('changed::textures', () => this._apply(), this);
        // A theme reload (e.g. light/dark switch) drops custom stylesheets
        St.ThemeContext.get_for_stage(global.stage)
            .connectObject('changed', () => this._ensureLoaded(), this);
        this._apply();
    }

    disable() {
        this._setTracking(false);
        St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);
        this._settings.disconnectObject(this);
        this._settings = null;
        this._iconColors = null;
        this._iconTheme = null;
        this._unload();
    }

    _apply() {
        const textures = parseTextures(this._settings.get_string('textures'));
        this._setTracking(usesAutoColor(textures));
        const css = buildShellCss(textures,
            p => Gio.File.new_for_path(resolveImage(p, this.path)).get_uri(),
            this._autoColor);

        this._unload();
        if (!css)
            return;
        GLib.mkdir_with_parents(this._cacheDir, 0o755);
        // New name every time so St never reuses a stale parse
        const file = Gio.File.new_for_path(
            GLib.build_filenamev([this._cacheDir, `textures-${Date.now()}.css`]));
        try {
            file.replace_contents(new TextEncoder().encode(css), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            console.error(`${this.uuid}: could not write ${file.get_path()}: ${e.message}`);
            return;
        }
        this._cssFile = file;
        this._ensureLoaded();
    }

    _ensureLoaded() {
        if (!this._cssFile)
            return;
        // Tracked by hand: St.Theme.get_custom_stylesheets() hands JS a
        // list of nulls. Set before loading, because loading emits 'changed'
        // on the theme context, which calls back in here.
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        if (theme === this._loadedTheme)
            return;
        this._loadedTheme = theme;
        try {
            theme.load_stylesheet(this._cssFile);
        } catch (e) {
            this._loadedTheme = null;
            console.error(`${this.uuid}: could not load texture stylesheet: ${e.message}`);
        }
    }

    _unload() {
        if (!this._cssFile)
            return;
        this._loadedTheme?.unload_stylesheet(this._cssFile);
        this._loadedTheme = null;
        try {
            this._cssFile.delete(null);
        } catch {
            // already gone
        }
        this._cssFile = null;
    }

    // Left behind if the shell crashed or was killed while we were enabled
    _removeStaleCss() {
        try {
            const dir = Gio.File.new_for_path(this._cacheDir);
            const children = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            for (const info of children) {
                if (/^textures-\d+\.css$/.test(info.get_name()))
                    dir.get_child(info.get_name()).delete(null);
            }
        } catch {
            // no cache dir yet
        }
    }

    // ---- Auto color from the active window ----

    _setTracking(on) {
        if (on === this._tracking)
            return;
        this._tracking = on;
        const tracker = Shell.WindowTracker.get_default();
        if (on) {
            tracker.connectObject('notify::focus-app', () => this._queueAutoUpdate(), this);
            this._autoColor = this._focusColor() ?? this._autoColor;
        } else {
            tracker.disconnectObject(this);
            if (this._autoTimeout)
                GLib.source_remove(this._autoTimeout);
            this._autoTimeout = 0;
        }
    }

    _queueAutoUpdate() {
        if (this._autoTimeout)
            GLib.source_remove(this._autoTimeout);
        this._autoTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTO_DEBOUNCE_MS, () => {
            this._autoTimeout = 0;
            // Nothing focused (desktop, overview): keep the last color
            const color = this._focusColor();
            if (color && color !== this._autoColor) {
                this._autoColor = color;
                this._apply();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _focusColor() {
        const app = Shell.WindowTracker.get_default().focus_app;
        if (!app)
            return null;
        if (!this._iconColors.has(app.id))
            this._iconColors.set(app.id, this._iconColor(app));
        return this._iconColors.get(app.id);
    }

    _iconColor(app) {
        try {
            const gicon = app.get_icon();
            let pixbuf = null;
            if (gicon instanceof Gio.FileIcon) {
                pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(
                    gicon.get_file().get_path(), ICON_SIZE, ICON_SIZE);
            } else if (gicon) {
                this._iconTheme ??= new St.IconTheme();
                pixbuf = this._iconTheme.lookup_by_gicon(gicon, ICON_SIZE, 0)?.load_icon() ?? null;
            }
            if (!pixbuf)
                return null;
            return dominantColor(pixbuf.get_pixels(), pixbuf.width, pixbuf.height,
                pixbuf.rowstride, pixbuf.n_channels);
        } catch (e) {
            console.debug(`${this.uuid}: no icon color for ${app.id}: ${e.message}`);
            return null;
        }
    }
}
