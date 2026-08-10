#!/usr/bin/env python3
"""
fog_report.py - Laporan indikasi kabut dari data stasiun Ambient Weather.

Menghitung dua indeks:
  Indeks A (Fog Potential)     - berlaku 24 jam, skor 0-100
  Indeks B (Fog Confirmation)  - hanya saat elevasi matahari > 8 derajat

Keluaran: laporan HTML mandiri + log CSV harian.

Pakai:
  python3 fog_report.py --demo
  python3 fog_report.py --api-key XXX --app-key YYY --lat -7.61 --lon 109.51
"""

import argparse
import csv
import json
import math
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone

API_BASE = "https://api.ambientweather.net/v1"

# ---------------------------------------------------------------- konversi

def f_to_c(f):
    return None if f is None else (f - 32.0) * 5.0 / 9.0


def mph_to_kmh(v):
    return None if v is None else v * 1.609344


def inhg_to_hpa(v):
    return None if v is None else v * 33.86389


def in_to_mm(v):
    return None if v is None else v * 25.4


# ------------------------------------------------------- posisi matahari

def solar_elevation(dt_utc, lat, lon):
    """Elevasi matahari (derajat) dan cos(zenith). Algoritma NOAA ringkas."""
    doy = dt_utc.timetuple().tm_yday
    hour = dt_utc.hour + dt_utc.minute / 60.0 + dt_utc.second / 3600.0
    g = 2.0 * math.pi / 365.25 * (doy - 1 + (hour - 12) / 24.0)

    eqtime = 229.18 * (
        0.000075
        + 0.001868 * math.cos(g)
        - 0.032077 * math.sin(g)
        - 0.014615 * math.cos(2 * g)
        - 0.040849 * math.sin(2 * g)
    )
    decl = (
        0.006918
        - 0.399912 * math.cos(g)
        + 0.070257 * math.sin(g)
        - 0.006758 * math.cos(2 * g)
        + 0.000907 * math.sin(2 * g)
        - 0.002697 * math.cos(3 * g)
        + 0.001480 * math.sin(3 * g)
    )

    tst = hour * 60.0 + eqtime + 4.0 * lon
    ha = math.radians(tst / 4.0 - 180.0)
    latr = math.radians(lat)

    cosz = math.sin(latr) * math.sin(decl) + math.cos(latr) * math.cos(decl) * math.cos(ha)
    cosz = max(-1.0, min(1.0, cosz))
    return math.degrees(math.asin(cosz)), cosz


def haurwitz_ghi(cosz):
    """Iradiansi global horizontal langit-cerah, W/m2."""
    if cosz <= 0.02:
        return 0.0
    return 1098.0 * cosz * math.exp(-0.059 / cosz)


# ------------------------------------------------------------- turunan

def derive(rec, lat, lon):
    """Ubah satu record mentah API jadi besaran turunan SI."""
    ts_ms = rec.get("dateutc")
    if ts_ms is None:
        return None
    dt = datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc)

    t = f_to_c(rec.get("tempf"))
    td = f_to_c(rec.get("dewPoint"))
    if t is None or td is None:
        return None

    elev, cosz = solar_elevation(dt, lat, lon)
    ghi_clear = haurwitz_ghi(cosz)
    solar = rec.get("solarradiation")
    kt = (solar / ghi_clear) if (solar is not None and ghi_clear > 20) else None

    wind = mph_to_kmh(rec.get("windspdmph_avg10m"))
    if wind is None:
        wind = mph_to_kmh(rec.get("windspeedmph"))

    return {
        "dt": dt,
        "t": t,
        "td": td,
        "dpd": t - td,
        "rh": rec.get("humidity"),
        "wind": wind,
        "gust": mph_to_kmh(rec.get("windgustmph")),
        "solar": solar,
        "ghi_clear": ghi_clear,
        "kt": kt,
        "elev": elev,
        "pres": inhg_to_hpa(rec.get("baromrelin")),
        "rain_hr": in_to_mm(rec.get("hourlyrainin") or 0.0),
        "rain_24h": in_to_mm(rec.get("24hourrainin") or rec.get("dailyrainin") or 0.0),
        "pm25": rec.get("pm25"),
    }


# ------------------------------------------------------------- penilaian

DPD_SAT = 1.0          # ambang jenuh, derajat C
WIND_LO, WIND_HI = 2.0, 7.0   # band angin optimal, km/jam
WIND_VETO = 12.0       # di atas ini, kabut radiasi tidak terbentuk


def score(hist):
    """hist: list turunan urut naik menurut waktu. Terbaru di akhir."""
    now = hist[-1]
    parts = []
    total = 0

    # --- gate ---
    gates = []
    if now["rain_hr"] > 0.2:
        gates.append("sedang hujan")
    if now["dpd"] > DPD_SAT:
        gates.append(f"udara belum jenuh (DPD {now['dpd']:.2f} C)")
    if now["wind"] is not None and now["wind"] > WIND_VETO:
        gates.append(f"angin terlalu kencang ({now['wind']:.1f} km/jam)")

    # --- persistensi kejenuhan ---
    minutes_sat = 0
    for r in reversed(hist):
        if r["dpd"] <= DPD_SAT:
            minutes_sat = (now["dt"] - r["dt"]).total_seconds() / 60.0
        else:
            break

    # --- laju perubahan suhu, jendela 40 menit ---
    dtdt = None
    ref = None
    for r in reversed(hist):
        gap = (now["dt"] - r["dt"]).total_seconds() / 60.0
        if gap >= 35:
            ref = r
            break
    if ref:
        span_h = (now["dt"] - ref["dt"]).total_seconds() / 3600.0
        if span_h > 0:
            dtdt = (now["t"] - ref["t"]) / span_h

    # --- prasyarat radiatif: kt siang tertinggi dalam 24 jam ---
    kt_day = [r["kt"] for r in hist if r["elev"] > 20 and r["kt"] is not None]
    kt_peak = max(kt_day) if kt_day else None

    # --- tekanan datar ---
    p_flat = None
    pref = None
    for r in reversed(hist):
        if (now["dt"] - r["dt"]).total_seconds() / 3600.0 >= 3:
            pref = r
            break
    if pref and pref["pres"] and now["pres"]:
        p_flat = abs(now["pres"] - pref["pres"])

    # --- reservoir kelembapan ---
    rain_before = any(
        r["rain_hr"] > 0.2
        for r in hist
        if 6 <= (now["dt"] - r["dt"]).total_seconds() / 3600.0 <= 24
    )

    def add(label, pts, maxpts, detail, ok):
        nonlocal total
        total += pts
        parts.append({"label": label, "pts": pts, "max": maxpts, "detail": detail, "ok": ok})

    # Saturasi (30)
    d = now["dpd"]
    p = 30 if d <= 0.3 else 20 if d <= 0.8 else 10 if d <= 1.5 else 0
    add("Kejenuhan", p, 30, f"DPD {d:.2f} C  (RH {now['rh']}%)", p >= 20)

    # Persistensi (15)
    p = 15 if minutes_sat >= 90 else 10 if minutes_sat >= 60 else 5 if minutes_sat >= 30 else 0
    add("Persistensi", p, 15, f"jenuh {minutes_sat:.0f} menit berturut-turut", p >= 10)

    # Angin (20)
    w = now["wind"]
    if w is None:
        p, det = 0, "data angin tidak tersedia"
    elif WIND_LO <= w <= WIND_HI:
        p, det = 20, f"{w:.1f} km/jam - dalam band optimal"
    elif 7 < w <= 11:
        p, det = 10, f"{w:.1f} km/jam - agak kencang"
    elif w < WIND_LO:
        p, det = 5, f"{w:.1f} km/jam - terlalu tenang, cenderung embun"
    else:
        p, det = 0, f"{w:.1f} km/jam - di luar rentang"
    add("Angin", p, 20, det, p >= 20)

    # Plateau termal (20)
    if dtdt is None:
        p, det = 0, "riwayat belum cukup"
    elif now["dpd"] <= DPD_SAT and abs(dtdt) < 0.2:
        p, det = 20, f"dT/dt {dtdt:+.2f} C/jam - pendinginan berhenti"
    elif now["dpd"] <= DPD_SAT and abs(dtdt) < 0.4:
        p, det = 10, f"dT/dt {dtdt:+.2f} C/jam - mulai mendatar"
    else:
        p, det = 0, f"dT/dt {dtdt:+.2f} C/jam - masih mendingin"
    add("Plateau termal", p, 20, det, p >= 20)

    # Prasyarat radiatif (10)
    ok_kt = kt_peak is not None and kt_peak > 0.6
    ok_p = p_flat is not None and p_flat < 0.5
    p = 10 if (ok_kt and ok_p) else 5 if (ok_kt or ok_p) else 0
    bits = []
    bits.append(f"kt puncak {kt_peak:.2f}" if kt_peak is not None else "kt puncak n/a")
    bits.append(f"dp/3jam {p_flat:.2f} hPa" if p_flat is not None else "dp n/a")
    add("Prasyarat radiatif", p, 10, " | ".join(bits), p >= 10)

    # Reservoir (5)
    p = 5 if rain_before else 0
    add("Reservoir lembap", p, 5, "hujan 6-24 jam lalu" if rain_before else "tidak ada hujan sebelumnya", p > 0)

    if gates:
        total = 0

    # --- Indeks B ---
    conf = None
    if now["elev"] > 8 and now["kt"] is not None:
        if now["kt"] < 0.25 and now["dpd"] < 0.5:
            conf = ("KABUT TERKONFIRMASI", f"kt {now['kt']:.2f} < 0.25 dengan DPD {now['dpd']:.2f} C")
        elif now["kt"] < 0.30 and now["dpd"] > 2.0:
            conf = ("BUKAN KABUT", f"kt rendah tapi DPD {now['dpd']:.2f} C - stratus atau mendung")
        elif now["kt"] > 0.4 and minutes_sat > 0:
            conf = ("KABUT BUYAR", f"kt naik ke {now['kt']:.2f} - lapisan terangkat")

    # --- verdict ---
    if gates:
        verdict, tone = "TIDAK ADA KABUT", "clear"
        note = "; ".join(gates)
    elif conf and conf[0] == "KABUT TERKONFIRMASI":
        verdict, tone = "KABUT", "fog"
        note = conf[1]
    elif conf and conf[0] == "BUKAN KABUT":
        verdict, tone = "BUKAN KABUT", "clear"
        note = conf[1]
    elif total >= 70:
        verdict, tone = "KABUT SANGAT MUNGKIN", "fog"
        note = "seluruh prasyarat radiasi-kabut terpenuhi"
    elif total >= 45:
        verdict, tone = "AMBIGU", "maybe"
        note = "jenuh tapi tanda pembeda lemah"
        if now["wind"] is not None and now["wind"] < WIND_LO:
            note += " - angin sangat tenang, kemungkinan besar embun"
    else:
        verdict, tone = "TIDAK ADA KABUT", "clear"
        note = "skor di bawah ambang"

    return {
        "total": total,
        "parts": parts,
        "verdict": verdict,
        "tone": tone,
        "note": note,
        "confirm": conf,
        "minutes_sat": minutes_sat,
        "dtdt": dtdt,
        "kt_peak": kt_peak,
        "now": now,
    }


# ----------------------------------------------------------- pengambilan

def fetch(api_key, app_key, mac=None, limit=288):
    import requests

    r = requests.get(
        f"{API_BASE}/devices",
        params={"apiKey": api_key, "applicationKey": app_key},
        timeout=30,
    )
    r.raise_for_status()
    devices = r.json()
    if not devices:
        raise SystemExit("Tidak ada perangkat pada akun ini.")

    dev = next((d for d in devices if d["macAddress"] == mac), devices[0]) if mac else devices[0]
    name = dev.get("info", {}).get("name", dev["macAddress"])

    time.sleep(1.2)  # batas API: 1 permintaan per detik per apiKey

    r = requests.get(
        f"{API_BASE}/devices/{dev['macAddress']}",
        params={"apiKey": api_key, "applicationKey": app_key, "limit": limit},
        timeout=30,
    )
    r.raise_for_status()
    return name, r.json()  # urut menurun


def demo_records(hours=24, end_local_hour=None, tz_offset=7.0):
    """Data sintetis: malam cerah tenang yang berkabut menjelang subuh."""
    out = []
    end = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    if end_local_hour is not None:
        cur = (end + timedelta(hours=tz_offset))
        cur_h = cur.hour + cur.minute / 60.0
        end -= timedelta(hours=(cur_h - end_local_hour) % 24)
    n = hours * 12
    for i in range(n):
        dt = end - timedelta(minutes=5 * (n - 1 - i))
        local_h = (dt.hour + 7) % 24 + dt.minute / 60.0

        if 6 <= local_h < 15:
            t = 22 + 7 * math.sin(math.pi * (local_h - 6) / 12)
        elif local_h >= 15:
            t = 29 - 1.35 * (local_h - 15)
        else:
            t = 16.9 - 0.30 * local_h
        td = 19.4 + 0.25 * math.sin(local_h / 3.0)
        t = max(t, td - 0.05)
        if 1.5 <= local_h <= 7.0:
            t = td + max(0.0, 0.35 - 0.05 * (local_h - 1.5)) + random.uniform(-0.03, 0.03)

        rh = 100.0 * math.exp(-(t - td) / 15.0) if t > td else 99.0
        rh = min(99.0, max(45.0, rh * 0.99 + 1))

        wind = 3.4 + random.uniform(-1.0, 1.0) if local_h < 7 or local_h > 18 else 9 + random.uniform(-3, 5)
        elev, cosz = solar_elevation(dt, -7.61, 109.51)
        clear = haurwitz_ghi(cosz)
        foggy = 1.5 <= local_h <= 7.0
        solar = clear * (0.16 if foggy else 0.74) * random.uniform(0.95, 1.05)

        out.append({
            "dateutc": int(dt.timestamp() * 1000),
            "tempf": t * 9 / 5 + 32,
            "dewPoint": td * 9 / 5 + 32,
            "humidity": round(rh),
            "windspdmph_avg10m": wind / 1.609344,
            "windspeedmph": wind / 1.609344,
            "windgustmph": (wind + 2.5) / 1.609344,
            "solarradiation": round(solar, 1),
            "baromrelin": (1011.4 + 0.9 * math.sin(local_h / 4)) / 33.86389,
            "hourlyrainin": 0.0,
            "24hourrainin": 0.0,
        })
    out.reverse()
    return out


# --------------------------------------------------------------- render

CSS = """
:root{--ink:#E9EEF3;--dim:#8FA0B0;--faint:#5C6B7A;--line:#243040;
--bg:#0E141B;--panel:#161F2A;--mist:#79D6C4;--warm:#E8895F;--cool:#6BA8DF;--amber:#E8B55C}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:15px;line-height:1.55;
padding:32px 20px 56px}
.wrap{max-width:860px;margin:0 auto}
.eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.16em;
text-transform:uppercase;color:var(--faint)}
h1{font-size:15px;font-weight:600;margin:6px 0 26px;letter-spacing:.01em}
.verdict{border:1px solid var(--line);border-radius:3px;padding:22px 24px;background:var(--panel)}
.verdict .big{font-family:'IBM Plex Mono',monospace;font-size:30px;font-weight:600;
letter-spacing:-.01em;line-height:1.1}
.fog .big{color:var(--mist)} .maybe .big{color:var(--amber)} .clear .big{color:var(--dim)}
.note{color:var(--dim);font-size:13.5px;margin-top:8px}
.meter{height:5px;background:#0B1118;border-radius:3px;margin-top:18px;overflow:hidden}
.meter i{display:block;height:100%;background:var(--mist)}
.maybe .meter i{background:var(--amber)} .clear .meter i{background:var(--faint)}
.scoreline{display:flex;justify-content:space-between;font-family:'IBM Plex Mono',monospace;
font-size:11px;color:var(--faint);margin-top:7px;letter-spacing:.08em}
h2{font-size:11px;font-family:'IBM Plex Mono',monospace;letter-spacing:.16em;
text-transform:uppercase;color:var(--faint);font-weight:500;margin:38px 0 12px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-weight:500;color:var(--faint);font-size:11px;
font-family:'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;
padding:0 0 8px;border-bottom:1px solid var(--line)}
td{padding:9px 0;border-bottom:1px solid var(--line);vertical-align:top}
td.d{color:var(--dim);font-size:13px}
td.p{font-family:'IBM Plex Mono',monospace;text-align:right;white-space:nowrap;width:64px}
.on{color:var(--mist)} .off{color:var(--faint)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(122px,1fr));gap:1px;
background:var(--line);border:1px solid var(--line)}
.cell{background:var(--panel);padding:13px 14px}
.cell b{display:block;font-family:'IBM Plex Mono',monospace;font-size:19px;font-weight:500;
letter-spacing:-.01em}
.cell span{font-size:10.5px;font-family:'IBM Plex Mono',monospace;letter-spacing:.11em;
text-transform:uppercase;color:var(--faint)}
.legend{font-size:12px;color:var(--faint);margin-top:10px;
font-family:'IBM Plex Mono',monospace;letter-spacing:.04em}
.legend i{display:inline-block;width:16px;height:2px;vertical-align:middle;margin:0 5px 0 16px}
.legend i:first-child{margin-left:0}
footer{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);
color:var(--faint);font-size:12px;line-height:1.7}
@media(max-width:520px){.verdict .big{font-size:23px}}
"""


def svg_chart(hist, tz_offset):
    """Grafik 24 jam: T dan Td, dengan pita jam berkabut."""
    W, H = 820, 220
    L, R, TOP, BOT = 44, 14, 16, 30
    pw, ph = W - L - R, H - TOP - BOT

    ts = [r["dt"].timestamp() for r in hist]
    t0, t1 = ts[0], ts[-1]
    span = max(t1 - t0, 1)

    vals = [r["t"] for r in hist] + [r["td"] for r in hist]
    lo, hi = min(vals), max(vals)
    pad = max((hi - lo) * 0.12, 0.6)
    lo, hi = lo - pad, hi + pad

    def X(r):
        return L + (r["dt"].timestamp() - t0) / span * pw

    def Y(v):
        return TOP + (hi - v) / (hi - lo) * ph

    def path(key, col):
        pts = " ".join(f"{X(r):.1f},{Y(r[key]):.1f}" for r in hist)
        return (f'<polyline fill="none" stroke="{col}" stroke-width="1.6" '
                f'stroke-linejoin="round" stroke-linecap="round" points="{pts}"/>')

    # pita jenuh
    bands, start = [], None
    for r in hist:
        sat = r["dpd"] <= DPD_SAT and (r["wind"] is None or r["wind"] <= WIND_VETO)
        if sat and start is None:
            start = r
        elif not sat and start is not None:
            bands.append((start, r)); start = None
    if start is not None:
        bands.append((start, hist[-1]))

    parts = [f'<svg viewBox="0 0 {W} {H}" width="100%" '
             f'style="display:block;font-family:\'IBM Plex Mono\',monospace">']

    for a, b in bands:
        x0, x1 = X(a), X(b)
        if x1 - x0 > 1:
            parts.append(f'<rect x="{x0:.1f}" y="{TOP}" width="{x1-x0:.1f}" '
                         f'height="{ph}" fill="#79D6C4" opacity="0.10"/>')

    for frac in (0, .5, 1):
        y = TOP + frac * ph
        v = hi - frac * (hi - lo)
        parts.append(f'<line x1="{L}" y1="{y:.1f}" x2="{W-R}" y2="{y:.1f}" '
                     f'stroke="#243040" stroke-width="1"/>')
        parts.append(f'<text x="{L-8}" y="{y+4:.1f}" text-anchor="end" fill="#5C6B7A" '
                     f'font-size="10">{v:.0f}</text>')

    parts.append(path("td", "#6BA8DF"))
    parts.append(path("t", "#E8895F"))

    seen = set()
    for r in hist:
        lh = (r["dt"] + timedelta(hours=tz_offset)).hour
        if lh % 6 == 0 and lh not in seen:
            seen.add(lh)
            parts.append(f'<text x="{X(r):.1f}" y="{H-10}" text-anchor="middle" '
                         f'fill="#5C6B7A" font-size="10">{lh:02d}:00</text>')

    parts.append("</svg>")
    return "".join(parts)


def render(name, res, hist, tz_offset):
    n = res["now"]
    local = n["dt"] + timedelta(hours=tz_offset)

    rows = "".join(
        f'<tr><td class="{"on" if p["ok"] else "off"}">{p["label"]}</td>'
        f'<td class="d">{p["detail"]}</td>'
        f'<td class="p">{p["pts"]}/{p["max"]}</td></tr>'
        for p in res["parts"]
    )

    def cell(v, unit, lab):
        return f'<div class="cell"><b>{v}<span style="font-size:11px"> {unit}</span></b><span>{lab}</span></div>'

    cells = "".join([
        cell(f'{n["dpd"]:.2f}', "&deg;C", "dew pt depression"),
        cell(f'{n["t"]:.1f}', "&deg;C", "suhu"),
        cell(f'{n["td"]:.1f}', "&deg;C", "titik embun"),
        cell(f'{n["wind"]:.1f}' if n["wind"] is not None else "&mdash;", "km/j", "angin 10 mnt"),
        cell(f'{n["kt"]:.2f}' if n["kt"] is not None else "&mdash;", "", "clearness kt"),
        cell(f'{n["elev"]:.0f}', "&deg;", "elevasi surya"),
    ])

    return f"""<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Laporan kabut &mdash; {name}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body><div class="wrap">

<div class="eyebrow">{name} &nbsp;&middot;&nbsp; {local:%d %b %Y  %H:%M} WIB</div>
<h1>Indikasi kabut</h1>

<div class="verdict {res['tone']}">
  <div class="big">{res['verdict']}</div>
  <div class="note">{res['note']}</div>
  <div class="meter"><i style="width:{res['total']}%"></i></div>
  <div class="scoreline"><span>INDEKS A</span><span>{res['total']} / 100</span></div>
</div>

<h2>Kondisi saat ini</h2>
<div class="grid">{cells}</div>

<h2>Rincian skor</h2>
<table><tr><th>Komponen</th><th>Pembacaan</th><th style="text-align:right">Poin</th></tr>
{rows}</table>

<h2>24 jam terakhir</h2>
{svg_chart(hist, tz_offset)}
<div class="legend"><i style="background:#E8895F"></i>suhu<i style="background:#6BA8DF"></i>titik embun<i style="background:#79D6C4;height:8px"></i>jendela jenuh</div>

<footer>
Indeks A menilai potensi kabut dari kejenuhan, angin, dan plateau termal &mdash; berlaku sepanjang hari.
Indeks B mengonfirmasi lewat penekanan radiasi matahari, dan hanya aktif saat elevasi surya di atas 8&deg;.
Sebelum dipercaya, sandingkan keluaran ini dengan METAR bandara terdekat selama 2&ndash;3 bulan, lalu setel ulang ambangnya.
</footer>
</div></body></html>"""


# ------------------------------------------------------------------ main

def append_log(path, res):
    n = res["now"]
    new = not os.path.exists(path)
    with open(path, "a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["waktu_utc", "t_c", "td_c", "dpd_c", "rh", "wind_kmh",
                        "solar_wm2", "kt", "elev_deg", "menit_jenuh", "dtdt_c_per_h",
                        "skor_a", "verdict"])
        w.writerow([
            n["dt"].isoformat(), f'{n["t"]:.2f}', f'{n["td"]:.2f}', f'{n["dpd"]:.3f}',
            n["rh"], f'{n["wind"]:.2f}' if n["wind"] is not None else "",
            n["solar"], f'{n["kt"]:.3f}' if n["kt"] is not None else "",
            f'{n["elev"]:.1f}', f'{res["minutes_sat"]:.0f}',
            f'{res["dtdt"]:.3f}' if res["dtdt"] is not None else "",
            res["total"], res["verdict"],
        ])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-key")
    ap.add_argument("--app-key")
    ap.add_argument("--mac")
    ap.add_argument("--lat", type=float, default=-7.61)
    ap.add_argument("--lon", type=float, default=109.51)
    ap.add_argument("--tz-offset", type=float, default=7.0)
    ap.add_argument("--out", default="laporan_kabut.html")
    ap.add_argument("--log", default="log_kabut.csv")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--demo-hour", type=float, default=None,
                    help="jam lokal untuk pratinjau demo, mis. 5.5")
    a = ap.parse_args()

    if a.demo:
        name, raw = "Stasiun demo", demo_records(end_local_hour=a.demo_hour, tz_offset=a.tz_offset)
    else:
        if not (a.api_key and a.app_key):
            sys.exit("Butuh --api-key dan --app-key, atau jalankan dengan --demo.")
        name, raw = fetch(a.api_key, a.app_key, a.mac)

    hist = [d for d in (derive(r, a.lat, a.lon) for r in raw) if d]
    hist.sort(key=lambda r: r["dt"])
    if len(hist) < 8:
        sys.exit("Riwayat terlalu pendek untuk dinilai.")

    res = score(hist)

    with open(a.out, "w") as f:
        f.write(render(name, res, hist, a.tz_offset))
    append_log(a.log, res)

    print(f"{res['verdict']}  (indeks A {res['total']}/100)  -> {a.out}")


if __name__ == "__main__":
    main()
