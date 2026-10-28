# dmgbuild settings for popMind's disk image: the app and a link to /Applications side by side over a
# background (packaging/dmg-background.tiff, drawn by TestRenderDMGBackground) with an arrow between them.
# scripts/package-mac.sh runs: dmgbuild -s packaging/dmg-settings.py -D app=<popMind.app> -D background=<tiff> ...
import os.path

app = defines["app"]
appname = os.path.basename(app)

format = "ULMO"
filesystem = "HFS+"
files = [app]
symlinks = {"Applications": "/Applications"}
icon = os.path.join(app, "Contents", "Resources", "AppIcon.icns")

background = defines["background"]
window_rect = ((200, 140), (640, 400))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
show_icon_preview = False

# Same centers as TestRenderDMGBackground (dmgAppX, dmgLinkX, dmgIconY).
icon_size = 112
text_size = 13
icon_locations = {appname: (170, 200), "Applications": (470, 200)}
arrange_by = None
# The .app extension stays as it is: hiding it with the Finder flag would break the signature's strict check.
