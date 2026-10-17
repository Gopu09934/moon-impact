#!/usr/bin/env bash
# Re-download the base maps that tools/bake_textures.py upsamples (three.js example textures, derived from NASA data).
# Want even better quality?  Replace these files (any resolution, same names) with NASA Blue Marble / LROC maps:
#   earth_atmos_2048.jpg (day)  earth_lights_2048.png (night)  earth_specular_2048.jpg (ocean mask)
#   earth_normal_2048.jpg       moon_1024.jpg (lunar albedo)
set -euo pipefail
mkdir -p assets/source && cd assets/source
B=https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets
for f in earth_atmos_2048.jpg earth_lights_2048.png earth_specular_2048.jpg earth_normal_2048.jpg earth_clouds_1024.png moon_1024.jpg; do
  [ -s "$f" ] || curl -fsSL -o "$f" "$B/$f"
done
echo "source textures ready"
