// Builds the dot-matrix map once, offline: a coarse world grid plus a fine grid over Java.
// Only the dot coordinates (lon/lat x100, flattened) ship to the site.
import { readFileSync, writeFileSync } from "node:fs";
import { feature } from "topojson-client";
import { geoArea, geoBounds, geoContains } from "d3-geo";

const land = (res) => {
  const topo = JSON.parse(readFileSync(new URL(`node_modules/world-atlas/land-${res}.json`, import.meta.url)));
  return feature(topo, topo.objects.land).features[0];
};

function grid(geo, [lon0, lon1, lat0, lat1], step) {
  // Keep only polygons overlapping the box; testing every point against all of 10m land is slow.
  // A polygon with area over a hemisphere is wound inside-out (it would cover the sea); skip it.
  const polys = geo.geometry.coordinates.filter((c) => {
    const poly = { type: "Polygon", coordinates: c };
    const [[a, b], [c2, d]] = geoBounds(poly);
    return geoArea(poly) < 2 * Math.PI && a <= lon1 && c2 >= lon0 && b <= lat1 && d >= lat0;
  });
  geo = { type: "MultiPolygon", coordinates: polys };
  const out = [];
  for (let lat = lat1; lat >= lat0; lat -= step)
    for (let lon = lon0; lon <= lon1; lon += step)
      if (geoContains(geo, [lon, lat])) out.push(Math.round(lon * 100), Math.round(lat * 100));
  return out;
}

const dots = {
  world: grid(land("110m"), [-179, 179, -58, 82], 2),
  java: grid(land("10m"), [102, 117, -9, -3], 0.1),
};
writeFileSync(new URL("../site/data/dots.json", import.meta.url), JSON.stringify(dots));
console.log(`world ${dots.world.length / 2} dots, java ${dots.java.length / 2} dots`);
