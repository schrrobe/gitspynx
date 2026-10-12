#!/bin/sh
# Erzeugt die Analyse-Kopie unter .work/ (gitignored). Originalinstallation bleibt unverändert.
set -e
SRC=/Applications/GitKraken.app/Contents/Resources
cd "$(dirname "$0")/.."
mkdir -p .work
cp "$SRC/app.asar" .work/
cp -R "$SRC/app.asar.unpacked" .work/
npx -y @electron/asar extract .work/app.asar .work/app
cd .work/app/src/main/static && cat *.main.bundle.js main.bundle.js > ../../../../main-all.js
