#!/bin/zsh
# Renders the icon master and copies it to every place the repository uses an app icon.
# Run after any change to master.py.
set -e
here=${0:A:h}
root=${here:h:h}
cd $here
python3 master.py
light=master/lectern-light.svg

# v3 Electron app: the window and Dock icon, and the mark in Settings > About.
mkdir -p $root/packages/app/resources $root/packages/app/src/renderer/src/assets
rsvg-convert -w 1024 -h 1024 $light -o $root/packages/app/resources/icon.png
cp $light $root/packages/app/src/renderer/src/assets/icon.svg
cp master/lectern-dark.svg $root/packages/app/src/renderer/src/assets/icon-dark.svg
