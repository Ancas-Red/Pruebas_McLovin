"""Pruebas unitarias para el módulo analítico de McHanaq."""

from pathlib import Path
import json

from src.analytics.anomalies import attach_historical_anomalies
from src.analytics.azure_sync import (
    DEFAULT_ARTIFACTS,
    build_blob_url,
    download_processed_snapshot,
    resolve_blob_base_url,
)
from src.analytics.decision_rules import assess_conditions
from src.analytics.metrics import (
    aggregate_daily_env_monthly,
    build_daily_records,
    summarize_monthly_activity,
)
from src.analytics.hotspots_geojson import write_hotspots_geojson
from src.analytics.run_pipeline import run_pipeline
from src.analytics.sensor_comparison import build_sensor_comparisons


def test_missing_days_become_zero_coverage_and_null_rate():
    activity = [
        {
            "date": "2025-09-01",
            "territory_type": "province",
            "territory_id": "1501",
            "sensor": "MODIS_TERRA",
            "fire_pixels_low": 1,
            "fire_pixels_nominal_high": 2,
            "valid_land_pixels": 320,  # >= 70% (<30% nubes)
            "expected_land_pixels_per_day": 400,
        },
        {
            "date": "2025-09-03",
            "territory_type": "province",
            "territory_id": "1501",
            "sensor": "MODIS_TERRA",
            "fire_pixels_low": 0,
            "fire_pixels_nominal_high": 1,
            "valid_land_pixels": 200,  # < 70% (>=30% nubes -> activity_rate null)
            "expected_land_pixels_per_day": 400,
        },
    ]
    env_daily = [
        {
            "date": "2025-09-01",
            "territory_type": "province",
            "territory_id": "1501",
            "t_amb_c": 20.0,
            "relative_humidity_2m_pct": 45.0,
            "t_suelo_c": 31.0,
            "lst_valid_pixel_pct": 60.0,  # >30% nubes -> debe anular t_suelo_c
            "wind_dir_deg": 90.0,
            "wind_speed_10m_ms": 3.0,
            "elevation_m": 850.0,
            "dem_source": "COPERNICUS_DEM_GLO30",
        }
    ]
    daily = build_daily_records(activity, env_daily)
    assert len(daily) == 3
    assert daily[0]["t_suelo_c"] is None  # Nubes >=30%
    assert daily[0]["cloud_ok_lt30pct"] is True
    assert daily[0]["activity_rate"] == 2 / 320
    assert daily[1]["date"] == "2025-09-02"
    assert daily[1]["valid_land_pixels"] == 0
    assert daily[1]["observation_coverage"] == 0.0
    assert daily[1]["cloud_ok_lt30pct"] is False
    assert daily[1]["activity_rate"] is None
    assert daily[2]["cloud_ok_lt30pct"] is False
    assert daily[2]["activity_rate"] is None

    summary = summarize_monthly_activity(daily)
    assert len(summary) == 1
    s = summary[0]
    assert s["fire_pixel_days_8_9"] == 3
    assert s["fire_pixel_days_7_9"] == 4
    assert s["valid_land_pixel_days"] == 520
    assert s["expected_land_pixel_days"] == 400 * 30
    assert s["active_days"] == 2
    assert s["max_consecutive_active_days"] == 1  # Día 2 sin obs rompe la racha


def test_historical_anomaly_mad_zero_and_estimated():
    # 6 años para septiembre (5 históricos + 1 actual)
    items = []
    rates = [0.001, 0.002, 0.003, 0.002, 0.004, 0.010]
    for idx, rate in enumerate(rates):
        items.append(
            {
                "period_id": f"{2020 + idx}-09",
                "territory_type": "province",
                "territory_id": "1501",
                "sensor": "MODIS_TERRA",
                "valid_land_pixel_days": 8000,
                "activity_rate": rate,
                "observation_coverage": 0.8,
            }
        )
    attach_historical_anomalies(items, min_baseline_years=5)
    last = items[-1]["historical_anomaly"]
    assert last["status"] == "estimated"
    assert last["baseline_years"] == 5
    assert last["value"] > 2.0

    # Caso MAD = 0 -> not_estimable
    flat = [
        {
            "period_id": f"{2020 + i}-09",
            "territory_type": "province",
            "territory_id": "1502",
            "sensor": "MODIS_TERRA",
            "valid_land_pixel_days": 8000,
            "activity_rate": 0.001,
            "observation_coverage": 0.8,
        }
        for i in range(6)
    ]
    attach_historical_anomalies(flat, min_baseline_years=5)
    assert flat[-1]["historical_anomaly"]["status"] == "not_estimable"


def test_sensor_comparison_never_sums_counts():
    summary = [
        {
            "period_id": "2025-09",
            "territory_type": "province",
            "territory_id": "1501",
            "sensor": "MODIS_TERRA",
            "valid_land_pixel_days": 9000,
            "activity_rate": 0.002,
            "observation_coverage": 0.75,
            "historical_anomaly": {"value": 2.5, "status": "estimated", "baseline_years": 6},
        },
        {
            "period_id": "2025-09",
            "territory_type": "province",
            "territory_id": "1501",
            "sensor": "MODIS_AQUA",
            "valid_land_pixel_days": 9000,
            "activity_rate": 0.001,
            "observation_coverage": 0.75,
            "historical_anomaly": {"value": 0.5, "status": "estimated", "baseline_years": 6},
        },
    ]
    comp = build_sensor_comparisons(summary)
    assert len(comp) == 1
    assert comp[0]["status"] == "discordant"
    assert comp[0]["sensors"]["VIIRS_SNPP"]["available"] is False


def test_decision_tree_branches_and_missing_gate():
    rows = []
    # 5 años previos de línea base + 1 año alto
    for idx, (p, w, t, rh) in enumerate(
        [
            (40.0, 2.0, 18.0, 60.0),
            (50.0, 2.5, 19.0, 55.0),
            (60.0, 3.0, 20.0, 50.0),
            (70.0, 3.5, 21.0, 48.0),
            (80.0, 4.0, 22.0, 45.0),
            (10.0, 6.0, 25.0, 30.0),  # 2025-09: seco + ventoso + cálido/seco -> HIGH
        ]
    ):
        rows.append(
            {
                "period_id": f"{2020 + idx}-09",
                "territory_type": "province",
                "territory_id": "1501",
                "landcover_year": 2024,
                "vegetation_area_pct": 60.0,
                "water_area_pct": 2.0,
                "precip_30d_mm": p,
                "soil_moisture_surface": 0.25,
                "wind_speed_10m_ms": w,
                "temperature_2m_c": t,
                "relative_humidity_2m_pct": rh,
                "slope_class_area_pct": 25.0,
                "dem_source": "COPERNICUS_DEM_GLO30",
            }
        )
    res = assess_conditions(rows, min_baseline_years=5)
    assert res[-1]["classification"] == "high"
    assert res[-1]["decision_path"] == ["N0:pass", "N1:yes", "N2:yes", "N3a:yes"]
    assert "steep_slope_share_high" in res[-1]["modifiers"]

    # Amortiguamiento por buffer de agua 150 m (>= 5%) atenúa high -> moderate
    buffered = [dict(r, water_buffer_150m_pct=8.5, effective_vegetation_area_pct=55.0) for r in rows]
    res_buf = assess_conditions(buffered, min_baseline_years=5)
    assert res_buf[-1]["classification"] == "moderate"
    assert "surface_water_buffer_150m" in res_buf[-1]["modifiers"]
    assert "water_buffer_150m_attenuation" in res_buf[-1]["rules_triggered"]

    # Sin bloques ambientales -> partial
    partial = assess_conditions(
        [{"period_id": "2025-09", "territory_type": "province", "territory_id": "1502", "vegetation_area_pct": 50.0}],
        min_baseline_years=5,
    )
    assert partial[0]["classification"] == "partial"
    assert partial[0]["decision_path"] == ["N0:fail"]


def test_end_to_end_pipeline_with_temp_dirs(tmp_path: Path):
    inter = tmp_path / "intermediate"
    proc = tmp_path / "processed"
    inter.mkdir()
    (inter / "daily_activity_2025.csv").write_text(
        "date,territory_type,territory_id,sensor,fire_pixels_low,fire_pixels_nominal_high,valid_land_pixels,expected_land_pixels_per_day,source_product\n"
        "2025-09-15,province,1501,MODIS_TERRA,1,2,360,400,MOD14A1\n",
        encoding="utf-8",
    )
    (inter / "environmental_daily_2025.csv").write_text(
        "date,territory_type,territory_id,t_amb_c,relative_humidity_2m_pct,t_suelo_c,lst_valid_pixel_pct,wind_dir_deg,wind_speed_10m_ms,elevation_m,dem_source\n"
        "2025-09-15,province,1501,19.2,44.5,30.1,85.0,140.0,3.6,2850.0,COPERNICUS_DEM_GLO30\n",
        encoding="utf-8",
    )
    (inter / "environmental_context_2025.csv").write_text(
        "period_id,territory_type,territory_id,landcover_year,vegetation_area_pct,water_area_pct,precip_30d_mm,soil_moisture_surface,slope_class_area_pct,dem_source\n"
        "2025-09,province,1501,2024,62.0,1.5,18.4,0.2,10.0,COPERNICUS_DEM_GLO30\n",
        encoding="utf-8",
    )
    stats = run_pipeline(inter, proc)
    assert stats["daily_items"] == 1
    assert stats["summary_items"] == 1
    meta = json.loads((proc / "metadata.json").read_text(encoding="utf-8"))
    assert meta["data_origin"] == "processed"
    assert "2025-09" in meta["available_periods_by_sensor"]["MODIS_TERRA"]


def test_ucayali_prefixed_exports_and_static_terrain(tmp_path: Path):
    inter = tmp_path / "intermediate"
    proc = tmp_path / "processed"
    inter.mkdir()
    (inter / "ucayali_daily_activity_VIIRS_SNPP_2024.csv").write_text(
        "date,territory_type,territory_id,sensor,fire_pixels_low,fire_pixels_nominal_high,valid_land_pixels,expected_land_pixels_per_day,source_product\n"
        "2024-09-15,province,2501,VIIRS_SNPP,0,3,800,1000,VNP14A1_001\n",
        encoding="utf-8",
    )
    (inter / "ucayali_environmental_daily_VIIRS_2024.csv").write_text(
        "date,territory_type,territory_id,t_amb_c,relative_humidity_2m_pct,t_suelo_c,lst_valid_pixel_pct,wind_dir_deg,wind_speed_10m_ms\n"
        "2024-09-15,province,2501,27.1,68.0,34.2,82.0,95.0,2.8\n",
        encoding="utf-8",
    )
    (inter / "ucayali_terrain_slope15_static.csv").write_text(
        "territory_type,territory_id,territory_name,elevation_m,slope_pct,slope_ge_15pct_fraction,slope_threshold_pct,dem_source\n"
        "province,2501,CORONEL PORTILLO,210.5,4.2,0.08,15,COPERNICUS_DEM_GLO30\n",
        encoding="utf-8",
    )
    (inter / "ucayali_districts_static.csv").write_text(
        "ubigeo,provincia,distrito,area_km2,vegetation_area_km2,water_area_km2\n"
        "250101,CORONEL PORTILLO,CALLERIA,1000.0,900.0,20.0\n",
        encoding="utf-8",
    )
    (inter / "ucayali_environmental_context_2024.csv").write_text(
        "period_id,territory_type,territory_id,precip_30d_mm,soil_moisture_surface,ndvi_median,source_product\n"
        "2024-09,province,2501,85.0,0.31,0.72,ERA5_LAND_DAILY_AGGR+MOD13A3\n",
        encoding="utf-8",
    )

    stats = run_pipeline(inter, proc)
    assert stats["daily_items"] == 1
    daily = json.loads((proc / "activity_daily.json").read_text(encoding="utf-8"))["items"][0]
    assert daily["elevation_m"] == 210.5
    assert daily["dem_source"] == "COPERNICUS_DEM_GLO30"

    assess = json.loads((proc / "conditions_assessment.json").read_text(encoding="utf-8"))["items"][0]
    ev_vars = {e["variable"]: e["value"] for e in assess["evidence"]}
    assert ev_vars["vegetation_area_pct"] == 90.0
    assert ev_vars["slope_class_area_pct"] == 8.0


def test_processed_territories_geojson_contract():
    terr_path = Path(__file__).resolve().parents[1] / "data" / "processed" / "territories.geojson"
    assert terr_path.exists(), "Falta data/processed/territories.geojson"
    assert terr_path.stat().st_size < 1024 * 1024, "territories.geojson debe pesar < 1 MB para Render"
    fc = json.loads(terr_path.read_text(encoding="utf-8"))
    feats = fc.get("features", [])
    types = {f["properties"]["territory_type"] for f in feats}
    assert types == {"province", "hydro_unit"}
    assert len(feats) == 24


def test_metadata_metrics_and_environmental_sources(tmp_path: Path):
    inter = tmp_path / "intermediate"
    proc = tmp_path / "processed"
    inter.mkdir()
    (inter / "daily_activity_2024.csv").write_text(
        "date,territory_type,territory_id,sensor,fire_pixels_low,fire_pixels_nominal_high,valid_land_pixels,expected_land_pixels_per_day\n"
        "2024-09-15,province,2501,VIIRS_SNPP,0,1,800,1000\n",
        encoding="utf-8",
    )
    run_pipeline(inter, proc)
    meta = json.loads((proc / "metadata.json").read_text(encoding="utf-8"))

    assert set(meta["metrics"].keys()) == {"activity", "environmental", "classification"}
    assert "activity_rate" in meta["metrics"]["activity"]
    assert "t_amb_c" in meta["metrics"]["environmental"]
    assert "elevation_m" in meta["metrics"]["environmental"]
    assert meta["metrics"]["classification"] == ["conditions_classification"]

    env_sources = meta["environmental_sources"]
    assert isinstance(env_sources, dict) and len(env_sources) >= 3
    assert "t_amb_c" in env_sources
    assert "t_suelo_c" in env_sources
    assert "wind" in env_sources
    assert all(isinstance(v, str) and v for v in env_sources.values())


def test_dem_epoch_separation_with_static_terrain(tmp_path: Path):
    inter = tmp_path / "intermediate"
    proc = tmp_path / "processed"
    inter.mkdir()
    (inter / "daily_activity.csv").write_text(
        "date,territory_type,territory_id,sensor,fire_pixels_low,fire_pixels_nominal_high,valid_land_pixels,expected_land_pixels_per_day\n"
        "2010-09-15,province,2501,MODIS_TERRA,0,2,800,1000\n"
        "2024-09-15,province,2501,VIIRS_SNPP,0,3,800,1000\n",
        encoding="utf-8",
    )
    (inter / "environmental_daily.csv").write_text(
        "date,territory_type,territory_id,t_amb_c,relative_humidity_2m_pct,t_suelo_c,lst_valid_pixel_pct,wind_dir_deg,wind_speed_10m_ms\n"
        "2010-09-15,province,2501,26.5,70.0,32.0,85.0,100.0,2.5\n"
        "2024-09-15,province,2501,27.1,68.0,34.2,82.0,95.0,2.8\n",
        encoding="utf-8",
    )
    (inter / "ucayali_terrain_slope15_static.csv").write_text(
        "territory_type,territory_id,territory_name,elevation_m,slope_pct,slope_ge_15pct_fraction,slope_threshold_pct,dem_source\n"
        "province,2501,CORONEL PORTILLO,210.5,4.2,0.08,15,COPERNICUS_DEM_GLO30\n",
        encoding="utf-8",
    )
    (inter / "environmental_context.csv").write_text(
        "period_id,territory_type,territory_id,vegetation_area_pct,water_area_pct,precip_30d_mm,soil_moisture_surface\n"
        "2010-09,province,2501,85.0,2.0,70.0,0.28\n"
        "2024-09,province,2501,85.0,2.0,60.0,0.25\n",
        encoding="utf-8",
    )

    run_pipeline(inter, proc)
    daily_items = json.loads((proc / "activity_daily.json").read_text(encoding="utf-8"))["items"]
    by_date = {r["date"]: r for r in daily_items}
    assert by_date["2010-09-15"]["elevation_m"] == 210.5
    assert by_date["2010-09-15"]["dem_source"] == "NASA_NASADEM_HGT_001"
    assert by_date["2024-09-15"]["elevation_m"] == 210.5
    assert by_date["2024-09-15"]["dem_source"] == "COPERNICUS_DEM_GLO30"

    assess = json.loads((proc / "conditions_assessment.json").read_text(encoding="utf-8"))["items"]
    by_period = {a["period_id"]: {e["variable"]: e for e in a["evidence"]} for a in assess}
    assert by_period["2010-09"]["slope_class_area_pct"]["source_product"] == "NASA_NASADEM_HGT_001"
    assert by_period["2024-09"]["slope_class_area_pct"]["source_product"] == "COPERNICUS_DEM_GLO30"


def test_hotspots_geojson_spatial_filter(tmp_path: Path):
    terr_path = tmp_path / "territories.geojson"
    terr_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"territory_type": "province", "territory_id": "2501"},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[-75.0, -9.0], [-74.0, -9.0], [-74.0, -8.0], [-75.0, -8.0], [-75.0, -9.0]]],
                        },
                    },
                    {
                        "type": "Feature",
                        "properties": {"territory_type": "hydro_unit", "territory_id": "4994"},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[-75.0, -9.0], [-74.5, -9.0], [-74.5, -8.5], [-75.0, -8.5], [-75.0, -9.0]]],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    firms_dir = tmp_path / "firms"
    (firms_dir / "modis").mkdir(parents=True)
    (firms_dir / "viirs-snpp").mkdir(parents=True)
    (firms_dir / "viirs-jpss1").mkdir(parents=True)

    (firms_dir / "modis" / "modis_2024_Peru.csv").write_text(
        "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type\n"
        "-8.75,-74.75,320.1,1.0,1.0,2024-09-15,1500,Terra,MODIS,85,61.03,290.0,18.4,D,0\n"
        "-8.25,-74.25,315.0,1.0,1.0,2024-09-15,1800,Aqua,MODIS,72,61.03,289.0,12.1,D,0\n"
        "-12.0,-77.0,310.0,1.0,1.0,2024-09-15,1500,Terra,MODIS,90,61.03,288.0,9.5,D,0\n",
        encoding="utf-8",
    )
    (firms_dir / "viirs-snpp" / "viirs-snpp_2024_Peru.csv").write_text(
        "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type\n"
        "-8.75,-74.75,335.2,0.5,0.5,2024-09-16,1815,N,VIIRS,n,2,291.0,5.2,D,0\n",
        encoding="utf-8",
    )
    (firms_dir / "viirs-jpss1" / "viirs-jpss1_2024_Peru.csv").write_text(
        "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type\n"
        "-8.75,-74.75,340.0,0.5,0.5,2024-09-16,1820,N20,VIIRS,h,2,292.0,6.1,D,0\n",
        encoding="utf-8",
    )

    out_path = tmp_path / "hotspots.geojson"
    stats = write_hotspots_geojson(firms_dir, terr_path, out_path)
    assert stats["features"] == 5  # Terra (prov+hu=2) + Aqua (prov=1) + VIIRS_SNPP (prov+hu=2); N20 y Lima excluidos

    fc = json.loads(out_path.read_text(encoding="utf-8"))
    assert fc["schema_version"] == "1.0"
    required_keys = {"territory_type", "territory_id", "date", "sensor", "confidence", "frp", "brightness", "source_product"}
    for feat in fc["features"]:
        assert required_keys.issubset(feat["properties"].keys())
        assert feat["properties"]["sensor"] in {"MODIS_TERRA", "MODIS_AQUA", "VIIRS_SNPP"}

    viirs_feat = [f for f in fc["features"] if f["properties"]["sensor"] == "VIIRS_SNPP"][0]
    assert viirs_feat["properties"]["confidence"] == "nominal"
    assert viirs_feat["properties"]["brightness"] == 335.2
    assert viirs_feat["properties"]["frp"] == 5.2

    # Verifica límite max_bytes
    try:
        write_hotspots_geojson(firms_dir, terr_path, out_path, max_bytes=10)
        assert False, "Debió fallar cuando excede max_bytes"
    except ValueError:
        pass


def test_metadata_excludes_unrecorded_and_cloudy_boundary_days_and_months(tmp_path: Path):
    inter = tmp_path / "intermediate"
    proc = tmp_path / "processed"
    inter.mkdir()
    (inter / "daily_activity.csv").write_text(
        "date,territory_type,territory_id,sensor,fire_pixels_low,fire_pixels_nominal_high,valid_land_pixels,expected_land_pixels_per_day\n"
        # Mes 2024-08 completamente nublado (< 70 %) -> debe excluirse de períodos y rangos
        "2024-08-31,province,2501,VIIRS_SNPP,0,0,200,1000\n"
        # Borde inicial nublado en septiembre (< 70 %) -> debe excluirse del rango
        "2024-09-01,province,2501,VIIRS_SNPP,0,0,500,1000\n"
        # Días útiles en septiembre (>= 70 %)
        "2024-09-02,province,2501,VIIRS_SNPP,0,2,800,1000\n"
        "2024-09-20,province,2501,VIIRS_SNPP,1,1,850,1000\n"
        # Borde final nublado en septiembre (< 70 %) -> debe excluirse del rango
        "2024-09-25,province,2501,VIIRS_SNPP,0,0,300,1000\n"
        # Mes 2024-10 sin píxeles válidos -> debe excluirse de períodos y partir el rango
        "2024-10-05,province,2501,VIIRS_SNPP,0,0,0,1000\n"
        # Nuevo mes útil en 2024-11
        "2024-11-02,province,2501,VIIRS_SNPP,0,1,900,1000\n"
        # Sensor con 100% días nublados -> sin rangos ni períodos útiles
        "2024-09-15,province,2501,MODIS_TERRA,0,0,200,1000\n",
        encoding="utf-8",
    )

    run_pipeline(inter, proc)
    meta = json.loads((proc / "metadata.json").read_text(encoding="utf-8"))

    assert meta["available_periods_by_sensor"]["VIIRS_SNPP"] == ["2024-09", "2024-11"]
    assert meta["available_date_ranges_by_sensor"]["VIIRS_SNPP"] == [
        {"from": "2024-09-02", "to": "2024-09-20"},
        {"from": "2024-11-02", "to": "2024-11-02"},
    ]
    assert meta["available_periods_by_sensor"]["MODIS_TERRA"] == []
    assert meta["available_date_ranges_by_sensor"]["MODIS_TERRA"] == []


def test_run_pipeline_common_window_bounds(tmp_path: Path):
    inter = tmp_path / "intermediate"
    proc = tmp_path / "processed"
    inter.mkdir()
    (inter / "daily_activity.csv").write_text(
        "date,territory_type,territory_id,sensor,fire_pixels_low,fire_pixels_nominal_high,valid_land_pixels,expected_land_pixels_per_day\n"
        "2012-01-18,province,2501,MODIS_TERRA,0,1,800,1000\n"
        "2012-01-19,province,2501,MODIS_TERRA,0,1,800,1000\n"
        "2026-11-02,province,2501,MODIS_TERRA,0,1,800,1000\n"
        "2026-11-03,province,2501,MODIS_TERRA,0,1,800,1000\n",
        encoding="utf-8",
    )

    run_pipeline(inter, proc, daily_from="common_window", daily_to="common_window")
    daily = json.loads((proc / "activity_daily.json").read_text(encoding="utf-8"))["items"]
    dates = [r["date"] for r in daily]
    assert dates[0] == "2012-01-19"
    assert dates[-1] == "2026-11-02"
    assert "2012-01-18" not in dates
    assert "2026-11-03" not in dates


def test_azure_sync_url_builder_and_if_missing(tmp_path: Path, monkeypatch):
    url = build_blob_url(
        "https://mchanaq.blob.core.windows.net/processed?sv=2022-11-02&sig=abc",
        "metadata.json",
        prefix="ucayali/v1",
    )
    assert url == "https://mchanaq.blob.core.windows.net/processed/ucayali/v1/metadata.json?sv=2022-11-02&sig=abc"

    monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "mchanaqacct")
    monkeypatch.setenv("AZURE_STORAGE_CONTAINER", "processed")
    monkeypatch.setenv("AZURE_STORAGE_SAS_TOKEN", "?sv=2022-11-02&sig=xyz")
    monkeypatch.delenv("AZURE_BLOB_SAS_BASE_URL", raising=False)
    assert resolve_blob_base_url() == "https://mchanaqacct.blob.core.windows.net/processed?sv=2022-11-02&sig=xyz"

    for name in DEFAULT_ARTIFACTS:
        (tmp_path / name).write_text("{}", encoding="utf-8")

    # No debe intentar ninguna descarga si todos los artefactos requeridos ya existen
    assert download_processed_snapshot(tmp_path, only_if_missing=True) == []

