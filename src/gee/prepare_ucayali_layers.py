"""Prepara capas locales de Ucayali (INEI 2023, ANA UH, CobVeg 2015) y calcula
fracción de vegetación por distrito (umbral 0.20) y buffer de agua (150 m).
"""

from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
REF_DIR = ROOT / "data" / "reference"
OUT_INTERM = ROOT / "data" / "intermediate" / "ucayali"
OUT_PROCESSED = ROOT / "data" / "processed"

SHP_DIST = REF_DIR / "Distrital INEI 2023 geogpsperu SuyoPomalia" / "Distrital INEI 2023 geogpsperu SuyoPomalia.shp"
SHP_UH = REF_DIR / "Cuencas Hidrograficas" / "UH.shp"
SHP_COBVEG = REF_DIR / "mapa_cobertura_vegetal_2015" / "CobVeg_180615.shp"

UTM_CRS = "EPSG:32718"
WGS84_CRS = "EPSG:4326"

WATER_CLASSES = {"Río", "Lagunas, lagos y cochas"}
NON_VEG_CLASSES = {
    "Area urbana",
    "Area altoandina con escasa y sin vegetación",
    "Glaciar",
}

UMBRAL_VEG = 0.20
UMBRAL_PEND = 0.15
WATER_BUFFER_M = 150.0


def main() -> None:
    OUT_INTERM.mkdir(parents=True, exist_ok=True)
    OUT_PROCESSED.mkdir(parents=True, exist_ok=True)

    # 1. Distritos INEI 2023 -> Ucayali
    dist = gpd.read_file(SHP_DIST).to_crs(UTM_CRS)
    uca_dist = dist[dist["DEPARTAMEN"].str.upper() == "UCAYALI"].copy()
    uca_dist["geometry"] = uca_dist.geometry.make_valid()
    uca_union = unary_union(uca_dist.geometry)

    # Provincias de Ucayali (disueltas desde distritos)
    uca_prov = uca_dist.dissolve(by=["CCDD", "CCPP", "PROVINCIA"], as_index=False)
    uca_prov["territory_id"] = uca_prov["CCDD"].astype(str) + uca_prov["CCPP"].astype(str)

    # 2. Unidades Hidrográficas ANA -> intersección con Ucayali
    uh = gpd.read_file(SHP_UH).to_crs(UTM_CRS)
    uh["geometry"] = uh.geometry.make_valid()
    uca_uh = uh[uh.geometry.intersects(uca_union)].copy()

    # 3. Cobertura Vegetal 2015 (bbox + clip a Ucayali)
    cob = gpd.read_file(SHP_COBVEG, bbox=tuple(uca_dist.total_bounds))
    cob["geometry"] = cob.geometry.make_valid()
    cob_uca = gpd.clip(cob, uca_union)

    water_gdf = cob_uca[cob_uca["CobVeg2013"].isin(WATER_CLASSES)].copy().reset_index(drop=True)
    veg_gdf = cob_uca[~cob_uca["CobVeg2013"].isin(WATER_CLASSES | NON_VEG_CLASSES)].copy().reset_index(drop=True)

    water_buf_gdf = water_gdf.copy()
    water_buf_gdf["geometry"] = water_buf_gdf.geometry.buffer(WATER_BUFFER_M)

    water_sindex = water_gdf.sindex
    water_buf_sindex = water_buf_gdf.sindex
    veg_sindex = veg_gdf.sindex

    # 4. Cálculo por distrito usando índice espacial (rápido y exacto)
    rows = []
    for _, r in uca_dist.sort_values("UBIGEO").iterrows():
        geom = r.geometry
        area_m2 = geom.area

        w_idx = water_sindex.query(geom, predicate="intersects")
        if len(w_idx):
            w_local = unary_union(water_gdf.geometry.iloc[w_idx]).intersection(geom)
            water_area_m2 = w_local.area
        else:
            water_area_m2 = 0.0

        wb_idx = water_buf_sindex.query(geom, predicate="intersects")
        if len(wb_idx):
            wb_local = unary_union(water_buf_gdf.geometry.iloc[wb_idx]).intersection(geom)
            buf_area_m2 = wb_local.area
        else:
            wb_local = None
            buf_area_m2 = 0.0

        v_idx = veg_sindex.query(geom, predicate="intersects")
        if len(v_idx):
            v_geoms = veg_gdf.geometry.iloc[v_idx].intersection(geom)
            veg_area_m2 = float(v_geoms.area.sum())
            if wb_local is not None and not wb_local.is_empty:
                veg_outside_buf_m2 = float(v_geoms.difference(wb_local).area.sum())
            else:
                veg_outside_buf_m2 = veg_area_m2
        else:
            veg_area_m2 = 0.0
            veg_outside_buf_m2 = 0.0

        veg_frac = veg_area_m2 / area_m2 if area_m2 > 0 else 0.0
        buf_frac = buf_area_m2 / area_m2 if area_m2 > 0 else 0.0
        eff_veg_frac = veg_outside_buf_m2 / area_m2 if area_m2 > 0 else 0.0

        rows.append(
            {
                "ubigeo": r["UBIGEO"],
                "provincia": r["PROVINCIA"],
                "distrito": r["DISTRITO"],
                "area_km2": round(area_m2 / 1e6, 4),
                "vegetation_area_km2": round(veg_area_m2 / 1e6, 4),
                "vegetation_fraction": round(veg_frac, 4),
                "meets_veg_threshold_0_20": bool(veg_frac >= UMBRAL_VEG),
                "water_area_km2": round(water_area_m2 / 1e6, 4),
                "water_buffer_150m_area_km2": round(buf_area_m2 / 1e6, 4),
                "water_buffer_150m_fraction": round(buf_frac, 4),
                "veg_outside_water_buffer_km2": round(veg_outside_buf_m2 / 1e6, 4),
                "effective_veg_fraction": round(eff_veg_frac, 4),
                "slope_threshold_pct": round(UMBRAL_PEND * 100, 1),
            }
        )

    df_stats = pd.DataFrame(rows)
    df_stats.to_csv(OUT_PROCESSED / "ucayali_districts_static.csv", index=False)

    # 5. Exportar capas intermedias en WGS84
    uca_dist_wgs = uca_dist.merge(df_stats, left_on="UBIGEO", right_on="ubigeo").to_crs(WGS84_CRS)
    uca_dist_wgs.to_file(OUT_INTERM / "ucayali_districts.geojson", driver="GeoJSON")

    uca_uh.to_crs(WGS84_CRS).to_file(OUT_INTERM / "ucayali_hydro_units.geojson", driver="GeoJSON")

    if len(water_buf_gdf):
        water_buf_gdf[["CobVeg2013", "geometry"]].to_crs(WGS84_CRS).to_file(
            OUT_INTERM / "ucayali_water_buffer_150m.geojson", driver="GeoJSON"
        )

    # 6. GeoJSON unificado de territorios para GEE (province + district + hydro_unit)
    features = []
    for _, r in uca_prov.to_crs(WGS84_CRS).iterrows():
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "territory_type": "province",
                    "territory_id": str(r["territory_id"]),
                    "territory_name": str(r["PROVINCIA"]),
                    "pfafstetter_level": None,
                    "source": "INEI 2023 (Ucayali)",
                },
                "geometry": json.loads(gpd.GeoSeries([r.geometry]).to_json())["features"][0]["geometry"],
            }
        )
    for _, r in uca_dist_wgs.iterrows():
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "territory_type": "district",
                    "territory_id": str(r["UBIGEO"]),
                    "territory_name": f"{r['DISTRITO']} ({r['PROVINCIA']})",
                    "vegetation_fraction": float(r["vegetation_fraction"]),
                    "water_buffer_150m_fraction": float(r["water_buffer_150m_fraction"]),
                    "pfafstetter_level": None,
                    "source": "INEI 2023 + CobVeg 2015 (Ucayali)",
                },
                "geometry": json.loads(gpd.GeoSeries([r.geometry]).to_json())["features"][0]["geometry"],
            }
        )
    for _, r in uca_uh.to_crs(WGS84_CRS).iterrows():
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "territory_type": "hydro_unit",
                    "territory_id": str(r["CODIGO"]),
                    "territory_name": str(r["NOMBRE"]),
                    "pfafstetter_level": 4,
                    "source": "ANA UH (Ucayali)",
                },
                "geometry": json.loads(gpd.GeoSeries([r.geometry]).to_json())["features"][0]["geometry"],
            }
        )

    fc = {"type": "FeatureCollection", "data_origin": "processed_ucayali", "features": features}
    (OUT_PROCESSED / "ucayali_territories.geojson").write_text(
        json.dumps(fc, ensure_ascii=False), encoding="utf-8"
    )

    api_features = [f for f in features if f["properties"]["territory_type"] in {"province", "hydro_unit"}]
    fc_api = {"type": "FeatureCollection", "data_origin": "processed", "features": api_features}
    (OUT_PROCESSED / "territories.geojson").write_text(
        json.dumps(fc_api, ensure_ascii=False), encoding="utf-8"
    )

    print(f"Distritos Ucayali: {len(df_stats)} | Provincias: {len(uca_prov)} | UH ANA: {len(uca_uh)}")
    print(df_stats[["ubigeo", "distrito", "area_km2", "vegetation_fraction", "water_buffer_150m_fraction", "effective_veg_fraction"]].to_string(index=False))


if __name__ == "__main__":
    main()
