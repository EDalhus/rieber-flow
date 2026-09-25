"""
Trinn 1 av 2: rasteriserer land (Natural Earth 10m) til en sjø/land-maske over norskekysten.

  pip install pillow numpy
  curl -L -o ne_land.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson
  python3 lag-maske.py ne_land.geojson maske.bin
  node beregn.mjs maske.bin ../../web/public/sjovei.bin.gz
"""
import json, struct, sys
import numpy as np
from PIL import Image, ImageDraw

LAT1, LAT0 = 71.6, 57.5      # nord, sør
LON0, LON1 = 2.0, 32.0       # vest, øst
DLAT, DLON = 0.01, 0.02      # cellestørrelse (~1,1 km)
SS = 4                       # oversampling for å beholde smale sund
LAND_TERSKEL = 0.6           # andel land i cellen før den regnes som land

H = round((LAT1 - LAT0) / DLAT)
W = round((LON1 - LON0) / DLON)

def til_piksler(ring):
    a = np.asarray(ring, dtype=np.float64)
    x = (a[:, 0] - LON0) / DLON * SS
    y = (LAT1 - a[:, 1]) / DLAT * SS
    return list(zip(x.tolist(), y.tolist()))

def i_utsnitt(ring):
    a = np.asarray(ring)
    return not (a[:, 0].max() < LON0 or a[:, 0].min() > LON1 or a[:, 1].max() < LAT0 or a[:, 1].min() > LAT1)

data = json.load(open(sys.argv[1]))
img = Image.new('L', (W * SS, H * SS), 0)
d = ImageDraw.Draw(img)
for f in data['features']:
    g = f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for poly in polys:
        if not i_utsnitt(poly[0]):
            continue
        d.polygon(til_piksler(poly[0]), fill=1)
        for hull in poly[1:]:  # innsjøer/hull
            d.polygon(til_piksler(hull), fill=0)

land = np.asarray(img, dtype=np.float32).reshape(H, SS, W, SS).mean(axis=(1, 3))
maske = (land >= LAND_TERSKEL).astype(np.uint8)  # 1 = land
with open(sys.argv[2], 'wb') as ut:
    ut.write(struct.pack('<ffffHH', LAT1, LON0, DLAT, DLON, H, W))
    ut.write(maske.tobytes())
print(f'{W}x{H} celler, {100 * maske.mean():.1f} % land')
