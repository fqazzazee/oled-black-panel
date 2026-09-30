// Turns a user-picked image into the texture file that the CSS points at.
// Used by prefs.js only (GdkPixbuf is not something the shell process needs).
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Big photos are scaled down; nothing on screen needs more than this
const MAX_SIDE = 2048;

export function textureDir() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'oled-black-panel', 'textures']);
}

// Returns the path of a new PNG. `tileSize` pre-tiles the image onto a canvas
// of that size, because GNOME Shell's CSS has no background-repeat.
export function renderTexture(source, id, {dim = 0, fit = 'cover', tileSize = null}) {
    let pb = GdkPixbuf.Pixbuf.new_from_file(source);
    const longSide = Math.max(pb.width, pb.height);
    if (longSide > MAX_SIDE) {
        const s = MAX_SIDE / longSide;
        pb = pb.scale_simple(Math.round(pb.width * s), Math.round(pb.height * s),
            GdkPixbuf.InterpType.BILINEAR);
    }
    pb = pb.add_alpha(false, 0, 0, 0); // also makes a copy that is safe to draw on

    if (dim > 0) {
        const shade = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, pb.width, pb.height);
        shade.fill(0x000000ff);
        shade.composite(pb, 0, 0, pb.width, pb.height, 0, 0, 1, 1,
            GdkPixbuf.InterpType.NEAREST, Math.round(255 * dim / 100));
    }

    if (fit === 'tile' && tileSize)
        pb = tile(pb, ...tileSize);

    GLib.mkdir_with_parents(textureDir(), 0o755);
    // Unique name per render: GNOME Shell caches images by URI
    const out = GLib.build_filenamev([textureDir(), `${id}-${Date.now()}.png`]);
    pb.savev(out, 'png', [], []);
    return out;
}

function tile(pb, width, height) {
    const canvas = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, width, height);
    canvas.fill(0);
    for (let y = 0; y < height; y += pb.height) {
        for (let x = 0; x < width; x += pb.width) {
            pb.copy_area(0, 0, Math.min(pb.width, width - x), Math.min(pb.height, height - y),
                canvas, x, y);
        }
    }
    return canvas;
}

// Only ever deletes our own processed copies, never the user's originals.
export function removeTexture(path) {
    if (!path?.startsWith(`${textureDir()}/`))
        return;
    try {
        Gio.File.new_for_path(path).delete(null);
    } catch {
        // already gone
    }
}
