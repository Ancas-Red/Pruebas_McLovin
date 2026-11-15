"""Genera `data/processed/territories.geojson` a escala nacional (Perú):
196 provincias (INEI 2023) + 231 unidades hidrográficas (ANA UH),
con simplificación topológica ligera para mantener el GeoJSON ágil en web y Azure/Render.
"""

from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parents[2]
REF_DIR = ROOT / "data" / "reference"
OUT_PROCESSED = ROOT / "data" / "processed"

SHP_DIST = REF_DIR / "Distrital INEI 2023 geogpsperu SuyoPomalia" / "Distrital INEI 2023 geogpsperu SuyoPomalia.shp"
SHP_UH = REF_DIR / "Cuencas Hidrograficas" / "UH.shp"

SIMPLIFY_TOL_DEG = 0.01  # ~1.1 km (escala MODIS/VIIRS), mantiene < 1 MB


def _round_coords(obj):
    if isinstance(obj, list):
        if obj and isinstance(obj[0], (int, float)):
            return [round(v, 4) for v in obj]
        return [_round_coords(item) for item in obj]
    return obj


def main() -> None:
    OUT_PROCESSED.mkdir(parents=True, exist_ok=True)

    # 1. Provincias INEI 2023 (disueltas desde distritos por CCDD+CCPP)
    dist = gpd.read_file(SHP_DIST).to_crs("EPSG:4326")
    dist["geometry"] = dist.geometry.make_valid()
    dist["prov_id"] = dist["CCDD"].astype(str).str.zfill(2) + dist["CCPP"].astype(str).str.zfill(2)
    prov = dist.dissolve(by=["prov_id", "PROVINCIA", "DEPARTAMEN"], as_index=False)
    prov["geometry"] = prov.geometry.simplify(SIMPLIFY_TOL_DEG, preserve_topology=True)

    # 2. Unidades Hidrográficas ANA (UH.shp)
    uh = gpd.read_file(SHP_UH).to_crs("EPSG:4326")
    uh["geometry"] = uh.geometry.make_valid()
    uh["geometry"] = uh.geometry.simplify(SIMPLIFY_TOL_DEG, preserve_topology=True)

    features = []
    for _, r in prov.sort_values("prov_id").iterrows():
        geom = json.loads(gpd.GeoSeries([r.geometry]).to_json())["features"][0]["geometry"]
        geom["coordinates"] = _round_coords(geom["coordinates"])
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "territory_type": "province",
                    "territory_id": str(r["prov_id"]),
                    "territory_name": f"{r['PROVINCIA']} ({r['DEPARTAMEN']})",
                    "pfafstetter_level": None,
                    "source": "INEI 2023 (Perú)",
                },
                "geometry": geom,
            }
        )

    for _, r in uh.sort_values("CODIGO").iterrows():
        geom = json.loads(gpd.GeoSeries([r.geometry]).to_json())["features"][0]["geometry"]
        geom["coordinates"] = _round_coords(geom["coordinates"])
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "territory_type": "hydro_unit",
                    "territory_id": str(r["CODIGO"]),
                    "territory_name": str(r["NOMBRE"]),
                    "pfafstetter_level": 4,
                    "source": "ANA UH (Perú)",
                },
                "geometry": geom,
            }
        )

    fc = {"type": "FeatureCollection", "data_origin": "processed", "features": features}
    out_path = OUT_PROCESSED / "territories.geojson"
    out_path.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")

    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"Generado {out_path}: {len(prov)} provincias + {len(uh)} UH = {len(features)} features ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
