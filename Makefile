UUID := oled-black-panel@fqazzazee.github.io
EXTENSIONS_DIR := $(HOME)/.local/share/gnome-shell/extensions
DEST := $(EXTENSIONS_DIR)/$(UUID)
EXTRA_SOURCES := targets.js colors.js imaging.js

.PHONY: pack install link test clean

# Zip for sharing or uploading to extensions.gnome.org
pack:
	gnome-extensions pack --force $(addprefix --extra-source=,$(EXTRA_SOURCES)) --schema=schemas/org.gnome.shell.extensions.oled-black-panel.gschema.xml .

# Copies the files and compiles the settings schema (`gnome-extensions
# install` of the packed zip fails on GNOME 50 with "Can't recursively copy
# directory", so this does not go through it)
install:
	rm -rf $(DEST)
	mkdir -p $(DEST)/schemas
	cp metadata.json extension.js prefs.js stylesheet.css $(EXTRA_SOURCES) $(DEST)/
	cp schemas/*.gschema.xml $(DEST)/schemas/
	glib-compile-schemas $(DEST)/schemas
	@echo "Log out and back in, then: gnome-extensions enable $(UUID)"

# Development: run the extension straight from this checkout
link:
	glib-compile-schemas schemas
	mkdir -p $(EXTENSIONS_DIR)
	ln -sfn $(CURDIR) $(DEST)
	@echo "Log out and back in, then: gnome-extensions enable $(UUID)"

test:
	gjs -m tests/unit.js

clean:
	rm -f $(UUID).shell-extension.zip schemas/gschemas.compiled
