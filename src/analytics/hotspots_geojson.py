"""Generador puro-Python (stdlib) de data/processed/hotspots.geojson desde CSVs FIRMS."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIRMS_DIR = ROOT / "src" / "gee" / "firms_peru"
DEFAULT_TERRITORIES = ROOT / "data" / "processed" / "territories.geojson"
DEFAULT_OUT = ROOT / "data" / "processed" / "hotspots.geojson"

CONTRACT_SENSORS = {"MODIS_TERRA", "MODIS_AQUA", "VIIRS_SNPP"}
_VIIRS_CONF_MAP = {"l": "low", "n": "nominal", "h": "high"}


_Y_BUCKETS = 64


def _bbox_of_coords(coords: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return min(xs), min(ys), max(xs), max(ys)


class _IndexedRing:
    """Anillo indexado por franjas horizontales para acelerar ray-casting puro-Python."""

    __slots__ = ("bbox", "buckets", "y_min", "inv_dy")

    def __init__(self, ring: list[list[float]], n_buckets: int = _Y_BUCKETS) -> None:
        self.bbox = _bbox_of_coords(ring)
        y_min, y_max = self.bbox[1], self.bbox[3]
        self.y_min = y_min
        dy = y_max - y_min
        self.inv_dy = (n_buckets / dy) if dy > 0 else 0.0
        self.buckets: list[list[tuple[float, float, float, float]]] = [[] for _ in range(n_buckets)]
        n = len(ring)
        if n < 3:
            return
        j = n - 1
        for i in range(n):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if yi != yj:
                lo_y, hi_y = (yi, yj) if yi < yj else (yj, yi)
                b0 = max(0, min(n_buckets - 1, int((lo_y - y_min) * self.inv_dy)))
                b1 = max(0, min(n_buckets - 1, int((hi_y - y_min) * self.inv_dy)))
                # Guardamos (lo_y, hi_y, x_at_lo, slope_dx_dy) -> x_intersect = x0 + (y - y0) * slope
                slope = (xj - xi) / (yj - yi)
                edge = (xi, yi, yj, slope) if yi < yj else (xj, yj, yi, slope)
                for b in range(b0, b1 + 1):
                    self.buckets[b].append(edge)
            j = i

    def contains(self, x: float, y: float) -> bool:
        bx0, by0, bx1, by1 = self.bbox
        if not (bx0 <= x <= bx1 and by0 <= y <= by1):
            return False
        if not self.buckets:
            return False
        b = int((y - self.y_min) * self.inv_dy)
        if b < 0:
            b = 0
        elif b >= len(self.buckets):
            b = len(self.buckets) - 1
        inside = False
        for x0, y0, y1, slope in self.buckets[b]:
            if y0 <= y < y1:
                if x < x0 + (y - y0) * slope:
                    inside = not inside
        return inside


def _point_in_polygon_rings(x: float, y: float, rings: list[_IndexedRing]) -> bool:
    if not rings[0].contains(x, y):
        return False
    for hole in rings[1:]:
        if hole.contains(x, y):
            return False
    return True


def _prepare_territories(
    territories_fc: dict[str, Any],
) -> tuple[
    tuple[float, float, float, float],
    list[tuple[str, str, tuple[float, float, float, float], list[list[_IndexedRing]]]],
]:
    """Precalcula bounding boxes globales, por territorio y anillos indexados."""
    prepared = []
    for feat in territories_fc.get("features", []):
        props = feat.get("properties") or {}
        t_type = props.get("territory_type")
        t_id = props.get("territory_id")
        if t_type not in {"province", "hydro_unit"} or t_id is None:
            continue
        geom = feat.get("geometry") or {}
        gtype = geom.get("type")
        raw_polys: list[list[list[list[float]]]]
        if gtype == "Polygon":
            raw_polys = [geom.get("coordinates") or []]
        elif gtype == "MultiPolygon":
            raw_polys = geom.get("coordinates") or []
        else:
            continue

        polys_prepped = []
        all_pts: list[list[float]] = []
        for poly in raw_polys:
            if not poly:
                continue
            rings_prepped = []
            for ring in poly:
                if not ring:
                    continue
                all_pts.extend(ring)
                rings_prepped.append(_IndexedRing(ring))
            if rings_prepped:
                polys_prepped.append(rings_prepped)
        if not all_pts:
            continue
        tbbox = _bbox_of_coords(all_pts)
        prepared.append((str(t_type), str(t_id), tbbox, polys_prepped))

    if not prepared:
        return (0.0, 0.0, -1.0, -1.0), []

    g_bbox = (
        min(p[2][0] for p in prepared),
        min(p[2][1] for p in prepared),
        max(p[2][2] for p in prepared),
        max(p[2][3] for p in prepared),
    )
    return g_bbox, prepared


def point_in_prepared_geometry(
    x: float,
    y: float,
    polys_prepped: list[list[_IndexedRing]],
) -> bool:
    return any(_point_in_polygon_rings(x, y, rings) for rings in polys_prepped)


def map_firms_sensor(instrument: str, satellite: str) -> str | None:
    """Mapea (instrument, satellite) de FIRMS al sensor del contrato o None si no aplica."""
    inst = (instrument or "").strip().upper()
    sat = (satellite or "").strip().upper()
    if inst == "MODIS":
        if sat == "TERRA" or sat == "T":
            return "MODIS_TERRA"
        if sat == "AQUA" or sat == "A":
            return "MODIS_AQUA"
    elif inst == "VIIRS":
        if sat in {"N", "SNPP", "SUOMI-NPP", "SUOMI NPP"}:
            return "VIIRS_SNPP"
    return None


def _parse_float(raw: str) -> float | None:
    s = (raw or "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_confidence(raw: str) -> int | str | None:
    s = (raw or "").strip()
    if not s:
        return None
    lower = s.lower()
    if lower in _VIIRS_CONF_MAP:
        return _VIIRS_CONF_MAP[lower]
    if s.isdigit():
        return int(s)
    return s


def build_hotspots_geojson(
    firms_dir: Path = DEFAULT_FIRMS_DIR,
    territories_path: Path = DEFAULT_TERRITORIES,
    *,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    """Lee CSVs FIRMS y devuelve FeatureCollection filtrado a territorios (province + hydro_unit)."""
    territories_fc = json.loads(territories_path.read_text(encoding="utf-8"))
    g_bbox, prepared = _prepare_territories(territories_fc)
    if not prepared:
        return {"schema_version": "1.0", "type": "FeatureCollection", "features": []}

    g_minx, g_miny, g_maxx, g_maxy = g_bbox
    csv_files = sorted(firms_dir.rglob("*.csv"))
    features: list[dict[str, Any]] = []

    for csv_path in csv_files:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as fh:
            reader = csv.reader(fh)
            try:
                header = next(reader)
            except StopIteration:
                continue
            idx = {col.strip(): i for i, col in enumerate(header)}
            lat_i = idx.get("latitude")
            lon_i = idx.get("longitude")
            date_i = idx.get("acq_date")
            inst_i = idx.get("instrument")
            sat_i = idx.get("satellite")
            conf_i = idx.get("confidence")
            frp_i = idx.get("frp")
            bright_i = idx.get("brightness") if "brightness" in idx else idx.get("bright_ti4")
            ver_i = idx.get("version")
            if lat_i is None or lon_i is None or date_i is None or inst_i is None or sat_i is None:
                continue

            for row in reader:
                if len(row) <= max(lat_i, lon_i, date_i, inst_i, sat_i):
                    continue
                try:
                    lat = float(row[lat_i])
                    lon = float(row[lon_i])
                except ValueError:
                    continue
                if not (g_minx <= lon <= g_maxx and g_miny <= lat <= g_maxy):
                    continue

                acq_date = row[date_i].strip()
                if date_from and acq_date < date_from:
                    continue
                if date_to and acq_date > date_to:
                    continue

                sensor = map_firms_sensor(row[inst_i], row[sat_i])
                if sensor not in CONTRACT_SENSORS:
                    continue

                matched_territories: list[tuple[str, str]] = []
                for t_type, t_id, (bx0, by0, bx1, by1), polys in prepared:
                    if bx0 <= lon <= bx1 and by0 <= lat <= by1 and point_in_prepared_geometry(lon, lat, polys):
                        matched_territories.append((t_type, t_id))

                if not matched_territories:
                    continue

                conf = _parse_confidence(row[conf_i]) if conf_i is not None and conf_i < len(row) else None
                frp = _parse_float(row[frp_i]) if frp_i is not None and frp_i < len(row) else None
                brightness = _parse_float(row[bright_i]) if bright_i is not None and bright_i < len(row) else None
                ver = row[ver_i].strip() if ver_i is not None and ver_i < len(row) else ""
                src_prod = f"FIRMS_{sensor}_{ver}" if ver else f"FIRMS_{sensor}"
                coords = [round(lon, 5), round(lat, 5)]

                for t_type, t_id in matched_territories:
                    features.append(
                        {
                            "type": "Feature",
                            "properties": {
                                "territory_type": t_type,
                                "territory_id": t_id,
                                "date": acq_date,
                                "sensor": sensor,
                                "confidence": conf,
                                "frp": frp,
                                "brightness": brightness,
                                "source_product": src_prod,
                            },
                            "geometry": {"type": "Point", "coordinates": coords},
                        }
                    )

    features.sort(
        key=lambda f: (
            f["properties"]["date"],
            f["properties"]["territory_type"],
            f["properties"]["territory_id"],
            f["properties"]["sensor"],
        )
    )
    return {"schema_version": "1.0", "type": "FeatureCollection", "features": features}


def write_hotspots_geojson(
    firms_dir: Path = DEFAULT_FIRMS_DIR,
    territories_path: Path = DEFAULT_TERRITORIES,
    out_path: Path = DEFAULT_OUT,
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    max_bytes: int | None = 5 * 1024 * 1024,
) -> dict[str, Any]:
    """Genera hotspots.geojson si cabe dentro de max_bytes (para proteger el presupuesto de Render)."""
    fc = build_hotspots_geojson(
        firms_dir,
        territories_path,
        date_from=date_from,
        date_to=date_to,
    )
    text = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    raw_bytes = len(text.encode("utf-8"))
    if max_bytes is not None and raw_bytes > max_bytes:
        raise ValueError(
            f"hotspots.geojson excede max_bytes ({raw_bytes / (1024 * 1024):.2f} MB > {max_bytes / (1024 * 1024):.2f} MB). "
            "Use --from / --to para acotar el rango."
        )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text, encoding="utf-8")
    return {
        "features": len(fc["features"]),
        "bytes": raw_bytes,
        "out_path": str(out_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera data/processed/hotspots.geojson desde FIRMS Perú")
    parser.add_argument("--firms-dir", type=Path, default=DEFAULT_FIRMS_DIR)
    parser.add_argument("--territories", type=Path, default=DEFAULT_TERRITORIES)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--from", dest="date_from", type=str, default=None)
    parser.add_argument("--to", dest="date_to", type=str, default=None)
    parser.add_argument("--max-mb", type=float, default=5.0)
    args = parser.parse_args()

    max_bytes = int(args.max_mb * 1024 * 1024) if args.max_mb and args.max_mb > 0 else None
    stats = write_hotspots_geojson(
        args.firms_dir,
        args.territories,
        args.out,
        date_from=args.date_from,
        date_to=args.date_to,
        max_bytes=max_bytes,
    )
    print(f"OK hotspots: {stats['features']} features | {stats['bytes'] / (1024 * 1024):.2f} MB -> {stats['out_path']}")


if __name__ == "__main__":
    main()
