"""Pruebas unitarias e integración para Fase 2 (simulación espacial 48 h y endpoints)."""

from __future__ import annotations

import os
from pathlib import Path
import zipfile

import geopandas as gpd
import numpy as np
from fastapi.testclient import TestClient

os.environ.setdefault("MCHANAQ_DATA_DIR", "data/fixtures")
os.environ.setdefault("MCHANAQ_NO_CACHE", "1")

from src.analytics.spread_model import (
    SPREAD_MODEL_NAME,
    compute_savi,
    export_all_phase2_products,
    export_animation_gif_mp4,
    export_impact_infographics,
    export_qgis_shapefiles,
    get_hourly_wind_series,
    simulate_spread_48h,
)
from src.backend.app import main


def test_compute_savi_range_and_behavior():
    nir = np.array([[0.65, 0.12], [0.50, 0.05]], dtype=np.float32)
    red = np.array([[0.08, 0.14], [0.10, 0.15]], dtype=np.float32)
    savi = compute_savi(nir, red, l_factor=0.5)
    assert savi.shape == (2, 2)
    assert float(savi[0, 0]) > 0.65  # vegetación densa
    assert float(savi[0, 1]) < 0.0   # agua / suelo húmedo
    assert np.all((savi >= -1.0) & (savi <= 1.0))


def test_simulate_48h_and_exports(tmp_path: Path):
    wind = get_hourly_wind_series(-8.19833, -75.26669, "2024-09-25", horizon_h=48)
    assert len(wind) == 48
    assert all(0.0 <= w["wind_dir_deg"] < 360.0 for w in wind)

    res = simulate_spread_48h(
        territory_type="province",
        territory_id="2501",
        territory_name="CORONEL PORTILLO",
        date_str="2024-09-25",
        ignition_lat=-8.19833,
        ignition_lon=-75.26669,
        horizon_h=48,
        side_max=56,
    )
    assert res.horizon_h == 48
    assert len(res.hourly_progression) == 48
    assert [b["hours"] for b in res.bands] == [6, 12, 24, 36, 48]
    areas = [b["area_ha"] for b in res.bands]
    assert areas == sorted(areas)
    assert res.total_area_ha > 0
    assert 0.0 < res.savi_mean <= 1.0

    shp_out = export_qgis_shapefiles(res, tmp_path)
    assert shp_out["isocronas_shp"].exists()
    assert shp_out["celdas_shp"].exists()
    assert shp_out["qgis_zip"].exists()
    gdf_iso = gpd.read_file(shp_out["isocronas_shp"])
    assert len(gdf_iso) >= 4
    assert "step_h" in gdf_iso.columns
    with zipfile.ZipFile(shp_out["qgis_zip"], "r") as zf:
        names = zf.namelist()
        assert "isocronas_48h.shp" in names
        assert "isocronas_48h.prj" in names

    media_out = export_animation_gif_mp4(res, tmp_path, fps=6)
    assert media_out["gif"].exists() and media_out["gif"].stat().st_size > 10_000
    assert media_out["mp4"].exists() and media_out["mp4"].stat().st_size > 10_000

    info_out = export_impact_infographics(res, tmp_path)
    assert info_out["panel"].exists() and info_out["panel"].stat().st_size > 20_000
    assert info_out["infografia"].exists() and info_out["infografia"].stat().st_size > 20_000

    all_out = export_all_phase2_products(res, tmp_path / "all")
    assert all_out["timings_s"]["total_export_s"] > 0
    for key in ("gif", "mp4", "qgis_zip", "infografia", "panel"):
        assert all_out["files"][key].exists()


def test_phase2_api_endpoints(tmp_path: Path, monkeypatch):
    client = TestClient(main.app)

    r_fc = client.get("/api/v1/territories/province/1501/spread-forecast?date=2026-09-15&horizon_h=48")
    assert r_fc.status_code == 200
    body = r_fc.json()
    assert body["schema_version"] == "1.0"
    assert body["phase"] == "phase_2_optional"
    assert body["horizon_h"] == 48
    assert body["model_metadata"]["model_name"] == SPREAD_MODEL_NAME
    assert len(body["hourly_wind"]) == 48
    assert len(body["isochrones"]["features"]) >= 1

    r_sim = client.post(
        "/api/v1/spread-simulate",
        json={
            "lat": -8.19833,
            "lon": -75.26669,
            "date": "2024-09-25",
            "horizon_h": 48,
            "wind_speed_10m_ms": 5.2,
            "wind_dir_deg": 120.0,
        },
    )
    assert r_sim.status_code == 200
    sim_body = r_sim.json()
    assert sim_body["horizon_h"] == 48
    assert sim_body["savi_summary"]["mean"] > 0
    assert "simulation_s" in sim_body["timings_s"]
    assert "data_sources" in sim_body
    assert "outputs" in sim_body

    # Archivos precomputados en data/processed/spread_outputs/
    for fname in (
        "simulacion_48h.gif",
        "pronostico_48h.mp4",
        "mchanaq_propagacion_48h_qgis.zip",
        "infografia_impacto_48h.png",
        "panel_modelo_48h.png",
    ):
        r_file = client.get(f"/api/v1/spread-outputs/{fname}")
        assert r_file.status_code == 200
        assert len(r_file.content) > 1000

    # Paso 2 bajo demanda en directorio temporal sin sobreescribir data/processed/spread_outputs/
    monkeypatch.setattr(main, "SPREAD_OUTPUTS_DIR", tmp_path)
    r_exp = client.post(
        "/api/v1/spread-export",
        json={
            "lat": -8.19833,
            "lon": -75.26669,
            "date": "2024-09-25",
            "horizon_h": 12,
            "wind_speed_10m_ms": 4.8,
            "wind_dir_deg": 115.0,
        },
    )
    assert r_exp.status_code == 200
    exp_body = r_exp.json()
    assert exp_body["horizon_h"] == 12
    assert exp_body["timings_s"]["total_export_s"] > 0
    for fname in (
        "simulacion_48h.gif",
        "pronostico_48h.mp4",
        "mchanaq_propagacion_48h_qgis.zip",
        "infografia_impacto_48h.png",
        "panel_modelo_48h.png",
    ):
        assert (tmp_path / fname).exists()
        r_file = client.get(f"/api/v1/spread-outputs/{fname}")
        assert r_file.status_code == 200
        assert len(r_file.content) > 1000

    assert client.get("/api/v1/spread-outputs/no_existe.exe").status_code == 404
