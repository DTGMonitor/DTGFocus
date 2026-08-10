#!/usr/bin/env python3
"""
fog_open.py - Pantau stasiun publik AWN (tanpa API key) dan hitung indeks kabut.

Endpoint publik hanya memberi kondisi terkini, bukan riwayat. Karena itu skrip
ini menumpuk riwayatnya sendiri di cache lokal, lalu menghitung indeks dari
cache tersebut. Jalankan berkala; kualitas indeks meningkat seiring cache terisi.

Prasyarat:
    pip install aioambient requests
    fog_report.py harus ada di folder yang sama.

Alur:
    py fog_open.py --scan --lat -2.5 --lon 121.5 --radius 40
    py fog_open.py --mac C8:C9:A3:0F:C7:FD --probe
    py fog_open.py --mac C8:C9:A3:0F:C7:FD --lat -2.5034 --lon 121.5176 --tz-offset 8
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone

try:
    from aioambient import OpenAPI
except ImportError:
    sys.exit("Pustaka belum ada. Jalankan:  pip install aioambient")

try:
    import fog_report as fr
except ImportError:
    sys.exit("fog_report.py harus berada di folder yang sama dengan fog_open.py")

OPEN_BASE = "https://lightning.ambientweather.net"
MAX_AGE_DAYS = 4


# --------------------------------------------------------------- normalisasi

def flatten(obj, found=None):
    """Kumpulkan record pengukuran sebenarnya.

    Respons AWN menyisipkan blok ringkasan 24 jam bernama 'hl' yang juga punya
    'dateutc', tapi nilainya berupa dict {h, l, c, s}. Sebuah dict hanya dianggap
    record kalau 'tempf'-nya benar-benar angka. Begitu diterima, isinya tidak
    ditelusuri lagi supaya blok 'hl' di dalamnya tidak ikut terjaring.
    """
    if found is None:
        found = []
    if isinstance(obj, dict):
        if isinstance(obj.get("dateutc"), (int, float)) and \
           isinstance(obj.get("tempf"), (int, float)):
            found.append(obj)
            return found
        for v in obj.values():
            flatten(v, found)
    elif isinstance(obj, list):
        for v in obj:
            flatten(v, found)
    return found


def slim(rec):
    """Buang nilai bersarang sebelum disimpan; cache cukup berisi skalar."""
    return {k: v for k, v in rec.items() if isinstance(v, (int, float, str, type(None)))}


def station_label(dev):
    for path in (("info", "name"), ("info", "coords", "location"), ("macAddress",)):
        cur = dev
        for k in path:
            cur = cur.get(k) if isinstance(cur, dict) else None
            if cur is None:
                break
        if isinstance(cur, str) and cur.strip():
            return cur.strip()
    return "(tanpa nama)"


# --------------------------------------------------------------- pengambilan

async def get_current(mac):
    """Kondisi terkini lewat aioambient. Balikan: list record ternormalisasi."""
    api = OpenAPI()
    try:
        data = await api.get_device_details(mac)
    except Exception as e:
        if "204" in str(e):
            sys.exit(f"Stasiun {mac} tidak ditemukan (HTTP 204). "
                     "Periksa MAC address-nya lewat --scan.")
        sys.exit(f"Gagal mengambil data: {e}")
    return flatten(data)


def try_bulk(mac, limit=288):
    """Coba minta riwayat sekaligus. Tidak terdokumentasi, sering gagal.

    Kalau berhasil, cache langsung terisi penuh dan indeks bisa dipakai
    seketika. Kalau gagal, tidak apa-apa: kita kembali ke mode akumulasi.
    """
    try:
        import requests
        r = requests.get(f"{OPEN_BASE}/devices/{mac}",
                         params={"$publicOrMac": "true", "$limit": limit},
                         timeout=25)
        if r.status_code != 200 or not r.content:
            return []
        return flatten(r.json())
    except Exception:
        return []


# ------------------------------------------------------------------- cache

def cache_path(mac):
    return f"cache_{mac.replace(':', '')}.jsonl"


def cache_load(path):
    if not os.path.exists(path):
        return {}
    out = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                out[int(r["dateutc"])] = r
            except Exception:
                continue
    return out


def cache_save(path, recs):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)).timestamp() * 1000
    keep = {k: v for k, v in recs.items() if k >= cutoff}
    with open(path, "w") as f:
        for k in sorted(keep):
            f.write(json.dumps(keep[k]) + "\n")
    return keep


# ------------------------------------------------------------------ perintah

async def cmd_scan(lat, lon, radius_km):
    api = OpenAPI()
    devices = await api.get_devices_by_location(lat, lon, radius_km / 1.609344)
    if not devices:
        print(f"Tidak ada stasiun publik dalam radius {radius_km:.0f} km.")
        return
    print(f"{len(devices)} stasiun ditemukan:\n")
    for d in devices:
        c = ((d.get("info") or {}).get("coords") or {}).get("coords") or {}
        pos = f"{c.get('lat'):.4f}, {c.get('lon'):.4f}" if c.get("lat") is not None else "-"
        print(f"  {station_label(d):<28} {d.get('macAddress','?'):<20} {pos}")


async def cmd_probe(mac):
    recs = await get_current(mac)
    if not recs:
        print("Respons tidak berisi record beriket waktu.")
        return
    latest = max(recs, key=lambda r: r["dateutc"])
    ts = datetime.fromtimestamp(latest["dateutc"] / 1000, tz=timezone.utc)
    age = (datetime.now(timezone.utc) - ts).total_seconds() / 60

    print(f"Pembacaan terakhir: {ts:%Y-%m-%d %H:%M} UTC  ({age:.0f} menit lalu)\n")
    print("Field yang tersedia:")
    for k, v in sorted(slim(latest).items()):
        print(f"  {k:<24} {v}")

    print("\nKesiapan untuk indeks kabut:")
    for key, label, wajib in [
        ("tempf", "suhu", True), ("dewPoint", "titik embun", True),
        ("humidity", "kelembapan", True), ("windspeedmph", "angin", True),
        ("solarradiation", "radiasi matahari (Indeks B)", False),
        ("hourlyrainin", "hujan", False),
    ]:
        ada = latest.get(key) is not None
        print(f"  {'ada   ' if ada else ('HILANG' if wajib else '-     ')} {label}")

    n = len(try_bulk(mac))
    print(f"\nRiwayat massal: {'tersedia, ' + str(n) + ' record' if n > 3 else 'tidak tersedia'}")
    if n <= 3:
        print("  Riwayat akan dikumpulkan bertahap tiap kali skrip dijalankan.")


async def cmd_report(mac, lat, lon, tz_offset, out, log, hours):
    path = cache_path(mac)
    cache = cache_load(path)
    baru_awal = len(cache)

    if not cache:
        for r in try_bulk(mac):
            cache[int(r["dateutc"])] = slim(r)

    for r in await get_current(mac):
        cache[int(r["dateutc"])] = slim(r)

    cache = cache_save(path, cache)
    print(f"Cache: {len(cache)} record (+{len(cache)-baru_awal} baru)")

    cutoff = max(cache) - hours * 3_600_000
    recs = [cache[k] for k in sorted(cache) if k >= cutoff]

    hist = [d for d in (fr.derive(r, lat, lon) for r in recs) if d]
    hist.sort(key=lambda r: r["dt"])

    if len(hist) < 8:
        span = (hist[-1]["dt"] - hist[0]["dt"]).total_seconds() / 60 if len(hist) > 1 else 0
        print(f"\nBaru {len(hist)} titik data ({span:.0f} menit). Belum cukup untuk menilai.")
        print("Jalankan lagi berkala; butuh minimal ~40 menit riwayat.")
        if hist:
            n = hist[-1]
            print(f"Sementara ini: suhu {n['t']:.1f} C, titik embun {n['td']:.1f} C, "
                  f"DPD {n['dpd']:.2f} C")
        return

    res = fr.score(hist)
    with open(out, "w") as f:
        f.write(fr.render(f"ASBSAR1 {mac}", res, hist, tz_offset))
    fr.append_log(log, res)

    n = res["now"]
    span = (hist[-1]["dt"] - hist[0]["dt"]).total_seconds() / 3600
    w = f"{n['wind']:.1f} km/j" if n["wind"] is not None else "n/a"
    print(f"\n{res['verdict']}  (indeks A {res['total']}/100, riwayat {span:.1f} jam)")
    print(f"  DPD {n['dpd']:.2f} C | angin {w}")
    if span < 2:
        print("  catatan: riwayat masih pendek, komponen persistensi dan plateau belum andal")
    if n["solar"] is None:
        print("  catatan: tanpa radiasi matahari, Indeks B nonaktif")
    print(f"  -> {out}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--scan", action="store_true")
    p.add_argument("--probe", action="store_true")
    p.add_argument("--mac")
    p.add_argument("--lat", type=float, default=-2.5034)
    p.add_argument("--lon", type=float, default=121.5176)
    p.add_argument("--radius", type=float, default=40.0)
    p.add_argument("--hours", type=int, default=24)
    p.add_argument("--tz-offset", type=float, default=8.0, help="WITA = 8")
    p.add_argument("--out", default="laporan_kabut.html")
    p.add_argument("--log", default="log_kabut.csv")
    a = p.parse_args()

    if a.scan:
        asyncio.run(cmd_scan(a.lat, a.lon, a.radius))
    elif a.probe and a.mac:
        asyncio.run(cmd_probe(a.mac))
    elif a.mac:
        asyncio.run(cmd_report(a.mac, a.lat, a.lon, a.tz_offset, a.out, a.log, a.hours))
    else:
        p.print_help()


if __name__ == "__main__":
    main()