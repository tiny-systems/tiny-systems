# dmgbuild settings for the release disk image: the app on the left, a link
# to Applications on the right, over build/darwin/dmg-background.tiff.
# Positions must match scripts/dmg-background.py.
#
#   dmgbuild -s scripts/dmg-settings.py -D app="build/bin/Tiny Systems.app" \
#     -D background=build/darwin/dmg-background.tiff "Tiny Systems" out.dmg
import os

app = defines["app"]  # noqa: F821 (dmgbuild provides defines)
background = defines["background"]  # noqa: F821

format = "UDZO"
filesystem = "HFS+"
files = [app]
symlinks = {"Applications": "/Applications"}
icon_locations = {os.path.basename(app): (170, 170), "Applications": (470, 170)}

window_rect = ((200, 160), (640, 400))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
icon_size = 112
text_size = 13
include_icon_view_settings = True
