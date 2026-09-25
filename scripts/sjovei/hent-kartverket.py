"""
Trinn 2 av 3: bygger to sjø/land-masker fra Kartverkets kartdata (WMS «topo», vannflater):

  A  hele kysten, ~500 m celler, fra N250 Vannflate (60 m/px)      → maske-a.bin
  B  detaljvindu rundt terminalen, 50 m celler, fra N50 Vannflate (12 m/px) → maske-b.bin

Utenfor Kartverkets dekning og langt fra kysten (>15 km) brukes Natural Earth-masken fra trinn 1.

  python3 -m pip install pillow numpy pyproj
  python3 hent-kartverket.py maske.bin maske-a.bin maske-b.bin [cache-mappe]
"""
import concurrent.futures as cf, hashlib, io, struct, sys, time, urllib.request
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from pyproj import Transformer

WMS = 'https://wms.geonorge.no/skwms1/wms.topo'
til_utm = Transformer.from_crs(4326, 25833, always_xy=True)
til_ll = Transformer.from_crs(25833, 4326, always_xy=True)
cache = Path(sys.argv[4] if len(sys.argv) > 4 else 'wms-cache')
cache.mkdir(exist_ok=True)

# Rutenett A (hele kysten) og B (rundt terminalen på Flatholmen, Ålesund)
A = dict(lat1=71.6, lon0=2.0, dlat=0.0045, dlon=0.009)
A['H'] = round((71.6 - 57.5) / A['dlat']); A['W'] = round((32.0 - 2.0) / A['dlon'])
B = dict(lat1=62.95, lon0=5.0, dlat=0.00045, dlon=0.00095)
B['H'] = round((62.95 - 62.05) / B['dlat']); B['W'] = round((7.4 - 5.0) / B['dlon'])


def hent(lag, x0, y0, x1, y1, w, h):
    url = f'{WMS}?service=WMS&version=1.3.0&request=GetMap&layers={lag}&styles=&crs=EPSG:25833&bbox={x0:.1f},{y0:.1f},{x1:.1f},{y1:.1f}&width={w}&height={h}&format=image/png'
    fil = cache / (hashlib.md5(url.encode()).hexdigest() + '.png')
    if not fil.exists():
        for forsok in range(5):
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    fil.write_bytes(r.read())
                break
            except Exception as e:
                if forsok == 4: raise
                time.sleep(3 * (forsok + 1))
    r = np.asarray(Image.open(fil).convert('RGB'))[..., 0]
    return r < 240  # vann tegnes lyseblått (R≈224), land er hvitt (R=255)


def akkumuler(grid, lag, res_m, tile_px, bokser, steg, verdi_kilde):
    """Henter tiles og summerer vann-/totalpiksler inn i rutenettet."""
    N = grid['H'] * grid['W']
    vann = np.zeros(N, np.float32); tot = np.zeros(N, np.float32)
    tiles = []
    for (x0, y0) in bokser:
        tiles.append((x0, y0, x0 + tile_px * res_m, y0 + tile_px * res_m))

    def jobb(t):
        x0, y0, x1, y1 = t
        return t, hent(lag, x0, y0, x1, y1, tile_px, tile_px)

    dekket = 0
    with cf.ThreadPoolExecutor(6) as ex:
        for k, (t, m) in enumerate(ex.map(jobb, tiles)):
            if not m.any():
                continue  # ingen vann i tilen → utenfor dekning (eller ren land)
            dekket += 1
            x0, y0, x1, y1 = t
            xs = x0 + (np.arange(0, tile_px, steg) + 0.5) * res_m
            ys = y1 - (np.arange(0, tile_px, steg) + 0.5) * res_m
            X, Y = np.meshgrid(xs, ys)
            lon, lat = til_ll.transform(X.ravel(), Y.ravel())
            i = np.floor((grid['lat1'] - lat) / grid['dlat']).astype(np.int64)
            j = np.floor((lon - grid['lon0']) / grid['dlon']).astype(np.int64)
            ok = (i >= 0) & (j >= 0) & (i < grid['H']) & (j < grid['W'])
            idx = i[ok] * grid['W'] + j[ok]
            if idx.size == 0:
                continue
            v = m[::steg, ::steg].ravel()[ok]
            lo, hi = idx.min(), idx.max() + 1
            tot[lo:hi] += np.bincount(idx - lo, minlength=hi - lo).astype(np.float32)
            vann[lo:hi] += np.bincount(idx - lo, weights=v, minlength=hi - lo).astype(np.float32)
            print(f'  {lag}: tile {k + 1}/{len(tiles)} ok', flush=True)
    print(f'{lag}: {dekket}/{len(tiles)} tiles med data')
    return vann, tot


def les_ne(fil):
    b = Path(fil).read_bytes()
    lat1, lon0, dlat, dlon, H, W = struct.unpack('<ffffHH', b[:20])
    return dict(lat1=lat1, lon0=lon0, dlat=dlat, dlon=dlon, H=H, W=W), np.frombuffer(b, np.uint8, offset=20).reshape(H, W)


def skriv(fil, g, land):
    with open(fil, 'wb') as ut:
        ut.write(struct.pack('<ffffHH', g['lat1'], g['lon0'], g['dlat'], g['dlon'], g['H'], g['W']))
        ut.write(land.astype(np.uint8).tobytes())
    print(f'{fil}: {g["W"]}x{g["H"]}, {100 * land.mean():.1f} % land')


ne, ne_land = les_ne(sys.argv[1])
# «Nær kysten»: innenfor ~15 km fra Natural Earth-land (der stoler vi på Kartverket)
nar = np.asarray(Image.fromarray(ne_land * 255).filter(ImageFilter.MaxFilter(31))) > 0

# ---------- Rutenett A ----------
def ne_ved(lat, lon, kart):
    i = np.clip(((ne['lat1'] - lat) / ne['dlat']).astype(int), 0, ne['H'] - 1)
    j = np.clip(((lon - ne['lon0']) / ne['dlon']).astype(int), 0, ne['W'] - 1)
    return kart[i, j]

RES_A, PX_A = 60.0, 2000
x_min, y_min = til_utm.transform(2.0, 57.5); x_max, y_max = til_utm.transform(32.0, 71.6)
kandidater = []
xs0 = np.floor(min(x_min, 0) / (RES_A * PX_A)) * RES_A * PX_A
for x in np.arange(-150000, 1300000, RES_A * PX_A):
    for y in np.arange(6300000, 8000000, RES_A * PX_A):
        # bruk bare tiles som inneholder kystnær sjø
        xx = np.linspace(x, x + RES_A * PX_A, 12); yy = np.linspace(y, y + RES_A * PX_A, 12)
        X, Y = np.meshgrid(xx, yy)
        lon, lat = til_ll.transform(X.ravel(), Y.ravel())
        inn = (lat >= 57.5) & (lat <= 71.6) & (lon >= 2) & (lon <= 32)
        if inn.any() and (ne_ved(lat[inn], lon[inn], nar & (ne_land == 0))).any():
            kandidater.append((x, y))
print(f'A: {len(kandidater)} tiles')
vA, tA = akkumuler(A, 'N250Vannflate', RES_A, PX_A, kandidater, 2, None)

latA = A['lat1'] - (np.arange(A['H']) + 0.5) * A['dlat']
lonA = A['lon0'] + (np.arange(A['W']) + 0.5) * A['dlon']
LA, LO = np.meshgrid(latA, lonA, indexing='ij')
ne_land_A = ne_ved(LA, LO, ne_land).astype(bool)
nar_A = ne_ved(LA, LO, nar).astype(bool)
tA = tA.reshape(A['H'], A['W']); vA = vA.reshape(A['H'], A['W'])
dekket = tA > 0
sjo_kv = np.divide(vA, np.maximum(tA, 1)) >= 0.35
land_A = np.where(dekket & nar_A, ~sjo_kv, ne_land_A)
skriv(sys.argv[2], A, land_A)

# ---------- Rutenett B ----------
RES_B, PX_B = 12.0, 1400
xa, ya = til_utm.transform(B['lon0'], B['lat1'] - B['H'] * B['dlat'])
xb, yb = til_utm.transform(B['lon0'] + B['W'] * B['dlon'], B['lat1'])
xa2, ya2 = til_utm.transform(B['lon0'], B['lat1']); xb2, yb2 = til_utm.transform(B['lon0'] + B['W'] * B['dlon'], B['lat1'] - B['H'] * B['dlat'])
xlo, xhi = min(xa, xa2, xb, xb2), max(xa, xa2, xb, xb2); ylo, yhi = min(ya, ya2, yb, yb2), max(ya, ya2, yb, yb2)
boks = [(x, y) for x in np.arange(xlo, xhi, RES_B * PX_B) for y in np.arange(ylo, yhi, RES_B * PX_B)]
print(f'B: {len(boks)} tiles')
vB, tB = akkumuler(B, 'N50Vannflate', RES_B, PX_B, boks, 1, None)
tB = tB.reshape(B['H'], B['W']); vB = vB.reshape(B['H'], B['W'])
land_B = ~((tB > 0) & (vB / np.maximum(tB, 1) >= 0.5))
# celler uten data i B (utenfor tilene) regnes som land
skriv(sys.argv[3], B, land_B)
