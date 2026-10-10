# OLED Black Panel

A GNOME Shell extension that keeps the top bar pure black and lets you
restyle the rest of the shell, one area at a time. Each area can get its own
background color, an image texture, or both.

Works with GNOME Shell 50.

## What it does

Out of the box it makes the top bar, menus and pop-ups black, which suits
OLED screens (black pixels are switched off). Everything else is set in the
extension's settings window.

For each area you can pick:

- **Background:** Theme (unchanged), Black, a custom color, or *Match active
  window*, which follows the color of the focused app's icon. A *Tone*
  setting (Dark, Muted or Vivid) adapts that color for the area.
- **Texture image:** any picture, as Fill or Tile. *Darken* keeps text
  readable on busy images.
- **Text color:** Automatic (black or white, whichever reads better on the
  background), Light, or Dark.

Areas:

| Area | Covers |
| --- | --- |
| Top bar | The panel |
| Quick settings buttons | Toggles when off, and the round buttons on top |
| Quick settings buttons (on) | Toggles that are switched on (Theme = your accent color) |
| Menus | Quick settings panel, calendar, app and panel menus |
| Cards | Notifications, calendar events, weather, quick settings submenus |
| Dock | Dash to Dock and the overview dash |
| Pop-ups | Volume and brightness OSD, Alt+Tab, workspace switcher |
| Files | The file area of the Files app |

## Install

```sh
git clone https://github.com/fqazzazee/oled-black-panel.git
cd oled-black-panel
make install
```

Then log out and back in, and enable it:

```sh
gnome-extensions enable oled-black-panel@fqazzazee.github.io
```

Open the settings from the Extensions app (the gear next to OLED Black
Panel).

## Good to know

- Changes in the settings window apply right away. You only need to log out
  after updating the extension itself.
- **Files** is a separate app, so its style goes into a marked block in
  `~/.config/gtk-4.0/gtk.css`. The rest of that file is left alone. Files
  reads it when it starts; use the *Restart Files* button in the settings.
- **Dock:** if Dash to Dock's "Customize the dash color" is on, it wins over
  the color set here. Turn it off to use this extension's dock color.
- **Match active window** reads the app's icon, not the window contents.
  Nothing is captured from the screen.
- Picked images are resized and copied to
  `~/.local/share/oled-black-panel/textures/`, so moving or deleting the
  original is fine.

## Development

```sh
make link   # run the extension from this checkout (symlink + compiled schema)
make test   # unit tests for the color and CSS code (needs gjs only)
make pack   # build a zip
```

On Wayland, GNOME Shell only loads new extension code at login. To try a
change without logging out, run a separate headless shell with its own
settings. For example:

```sh
dbus-run-session -- gnome-shell --headless --wayland --no-x11 \
  --virtual-monitor 1600x900 --wayland-display test-0
```

Set `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` to scratch
folders and `GSETTINGS_BACKEND=keyfile` so it doesn't touch your real
session.

Code layout:

- `extension.js`: runs in GNOME Shell. Builds and loads the generated
  stylesheet, and tracks the active window for *Match active window*.
- `prefs.js`: the settings window. Also writes the Files block in `gtk.css`.
- `targets.js`: the list of areas and their CSS selectors, and the CSS
  generation. Shared by both.
- `colors.js`: color math and icon color extraction. Shared by both.
- `imaging.js`: resizes, darkens and tiles texture images.
- `stylesheet.css`: the fixed OLED black styling.

## Support

If it helped you get a true black desktop, you can [buy me a coffee ☕](https://buymeacoffee.com/fqazzazee).

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
