"""Pruebas unitarias para el módulo analítico de McHanaq."""

from pathlib import Path
import json

from src.analytics.anomalies import attach_historical_anomalies
from src.analytics.decision_rules import assess_conditions
from src.analytics.metrics import (
    aggregate_daily_env_monthly,
    build_daily_records,
    summarize_monthly_activity,
)
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
            "valid_land_pixels": 200,
            "expected_land_pixels_per_day": 400,
        },
        {
            "date": "2025-09-03",
            "territory_type": "province",
            "territory_id": "1501",
            "sensor": "MODIS_TERRA",
            "fire_pixels_low": 0,
            "fire_pixels_nominal_high": 1,
            "valid_land_pixels": 400,
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
    assert daily[0]["activity_rate"] == 2 / 200
    assert daily[1]["date"] == "2025-09-02"
    assert daily[1]["valid_land_pixels"] == 0
    assert daily[1]["observation_coverage"] == 0.0
    assert daily[1]["activity_rate"] is None

    summary = summarize_monthly_activity(daily)
    assert len(summary) == 1
    s = summary[0]
    assert s["fire_pixel_days_8_9"] == 3
    assert s["fire_pixel_days_7_9"] == 4
    assert s["valid_land_pixel_days"] == 600
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
