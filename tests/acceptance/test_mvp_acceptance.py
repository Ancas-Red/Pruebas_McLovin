"""Pruebas automatizadas de aceptación del MVP (checklist de 18 puntos, v1.7 §13).

Cubre los criterios verificables automáticamente contra la API (`MCHANAQ_DATA_DIR=data/fixtures`),
el motor analítico (`src/analytics/`) y los artefactos territoriales/metadatos del repositorio.
"""

from __future__ import annotations

import csv
import io
import json
import os
from pathlib import Path

os.environ.setdefault("MCHANAQ_DATA_DIR", "data/fixtures")
os.environ.setdefault("MCHANAQ_NO_CACHE", "1")

from fastapi.testclient import TestClient

from src.analytics.anomalies import attach_historical_anomalies
from src.analytics.decision_rules import assess_conditions
from src.analytics.metrics import build_daily_records, summarize_monthly_activity
from src.analytics.run_pipeline import build_metadata
from src.analytics.sensor_comparison import build_sensor_comparisons
from src.backend.app.main import app

ROOT = Path(__file__).resolve().parents[2]
client = TestClient(app)

SPREAD_PREDICTION_FORBIDDEN_KEYS = {
    "isochrones",
    "spread_forecast",
    "spread_forecasts",
    "heuristic_wind_slope_spread_v1",
    "ignition_probability",
    "burned_area_forecast",
}
SPREAD_PREDICTION_FORBIDDEN_PHRASES = (
    "predicción de propagación",
    "prediccion de propagacion",
    "el incendio avanzará",
    "probabilidad de ignición",
    "probabilidad de incendio",
)


def test_province_and_hydro_unit_separation():
    """Provincias y unidades hidrográficas se consultan por separado y no se mezclan."""
    r_prov = client.get("/api/v1/territories?type=province")
    r_hu = client.get("/api/v1/territories?type=hydro_unit")
    assert r_prov.status_code == 200
    assert r_hu.status_code == 200

    prov_feats = r_prov.json()["features"]
    hu_feats = r_hu.json()["features"]
    assert len(prov_feats) >= 1
    assert len(hu_feats) >= 1
    assert all(f["properties"]["territory_type"] == "province" for f in prov_feats)
    assert all(f["properties"]["territory_type"] == "hydro_unit" for f in hu_feats)

    r_m_prov = client.get("/api/v1/territory-metrics?type=province&date=2026-09-15&sensor=MODIS_TERRA&metric=activity_rate")
    r_m_hu = client.get("/api/v1/territory-metrics?type=hydro_unit&date=2026-09-15&sensor=MODIS_TERRA&metric=activity_rate")
    assert r_m_prov.status_code == 200
    assert r_m_hu.status_code == 200
    assert r_m_prov.json()["sensor"] == "MODIS_TERRA"
    assert r_m_hu.json()["sensor"] == "MODIS_TERRA"
    assert all(i["territory_type"] == "province" for i in r_m_prov.json()["items"])
    assert all(i["territory_type"] == "hydro_unit" for i in r_m_hu.json()["items"])

    assert client.get("/api/v1/territories?type=district").status_code == 400
    assert client.get("/api/v1/territories/province/1501/activity?from=2026-09-20&to=2026-09-10&sensor=MODIS_TERRA").status_code == 400

    # Verificar también territories.geojson procesado de Ucayali (4 provincias + 20 UH Pfafstetter nivel 4)
    proc_terr = ROOT / "data" / "processed" / "territories.geojson"
    assert proc_terr.exists()
    fc = json.loads(proc_terr.read_text(encoding="utf-8"))
    proc_provs = [f for f in fc["features"] if f["properties"]["territory_type"] == "province"]
    proc_hus = [f for f in fc["features"] if f["properties"]["territory_type"] == "hydro_unit"]
    assert len(proc_provs) == 4
    assert len(proc_hus) == 20
    assert {f["properties"]["pfafstetter_level"] for f in proc_hus} == {4}


def test_no_cross_sensor_summing():
    """Cada sensor mantiene su propio denominador/anomalía; nunca se suman conteos entre sensores."""
    r_meta = client.get("/api/v1/metadata")
    assert r_meta.status_code == 200
    sensor_ids = {s["id"] for s in r_meta.json()["sensors"]}
    assert sensor_ids == {"MODIS_TERRA", "MODIS_AQUA", "VIIRS_SNPP"}

    # Métrica de actividad sin sensor -> 400 INVALID_PARAMETER
    r_missing_sensor = client.get("/api/v1/territory-metrics?type=province&date=2026-09-15&metric=activity_rate")
    assert r_missing_sensor.status_code == 400
    assert r_missing_sensor.json()["code"] == "INVALID_PARAMETER"

    # Comparación multisensor expone cada sensor separado sin totales sumados
    r_cmp = client.get("/api/v1/territories/province/1501/sensor-comparison?date=2026-09-15")
    assert r_cmp.status_code == 200
    body = r_cmp.json()
    assert body["status"] == "discordant"
    assert set(body["sensors"].keys()) == {"MODIS_TERRA", "MODIS_AQUA", "VIIRS_SNPP"}
    for forbidden in ("total_fire_pixels", "combined_count", "summed_activity_rate"):
        assert forbidden not in body

    # Verificación analítica directa: señales divergentes producen discordant sin sumar conteos
    comp = build_sensor_comparisons([
        {
            "period_id": "2025-09",
            "territory_type": "province",
            "territory_id": "2501",
            "sensor": "MODIS_TERRA",
            "valid_land_pixel_days": 8000,
            "activity_rate": 0.004,
            "observation_coverage": 0.85,
            "historical_anomaly": {"value": 2.6, "status": "estimated", "baseline_years": 6},
        },
        {
            "period_id": "2025-09",
            "territory_type": "province",
            "territory_id": "2501",
            "sensor": "VIIRS_SNPP",
            "valid_land_pixel_days": 32000,
            "activity_rate": 0.0002,
            "observation_coverage": 0.82,
            "historical_anomaly": {"value": 0.3, "status": "estimated", "baseline_years": 6},
        },
    ])
    assert len(comp) == 1
    assert comp[0]["status"] == "discordant"
    assert comp[0]["sensors"]["MODIS_TERRA"]["signal_status"] == "elevated"
    assert comp[0]["sensors"]["VIIRS_SNPP"]["signal_status"] == "not_elevated"


def test_null_never_becomes_zero_and_csv_preserves_empty_nulls():
    """Días sin observación o métricas sin dato permanecen null (no 0) en JSON y vacíos en CSV."""
    # Día 2026-09-10 en fixtures es día sin observación
    r_act = client.get("/api/v1/territories/province/1501/activity?from=2026-09-01&to=2026-09-30&sensor=MODIS_TERRA")
    assert r_act.status_code == 200
    day_10 = next(row for row in r_act.json()["items"] if row["date"] == "2026-09-10")
    assert day_10["valid_land_pixels"] == 0
    assert day_10["observation_coverage"] == 0.0
    assert day_10["activity_rate"] is None
    assert day_10["t_suelo_c"] is None

    # Sensor sin datos en cuenca FX13755 (MODIS_AQUA)
    r_sum = client.get("/api/v1/territories/hydro_unit/FX13755/summary?date=2026-09-15&sensor=MODIS_AQUA")
    assert r_sum.status_code == 200
    act = r_sum.json()["activity"]
    assert act["fire_pixel_days_8_9"] is None
    assert act["activity_rate"] is None
    assert act["observation_coverage"] == 0.0

    # Exportación CSV no convierte null en "0"
    r_csv = client.get("/api/v1/territories/province/1501/export.csv?from=2026-09-10&to=2026-09-10&sensor=MODIS_TERRA")
    assert r_csv.status_code == 200
    rows = list(csv.DictReader(io.StringIO(r_csv.text)))
    assert len(rows) == 1
    assert rows[0]["t_suelo_c"] == ""


def test_cloud_filter_under_30_percent():
    """El filtro diario <30% de nubes anula activity_rate y t_suelo_c cuando cobertura/LST < 70%."""
    daily = build_daily_records(
        activity_rows=[
            {
                "date": "2025-08-01",
                "territory_type": "province",
                "territory_id": "2501",
                "sensor": "VIIRS_SNPP",
                "fire_pixels_low": 0,
                "fire_pixels_nominal_high": 3,
                "valid_land_pixels": 750,  # 75% >= 70% (<30% nubes)
                "expected_land_pixels_per_day": 1000,
                "source_product": "VNP14A1",
            },
            {
                "date": "2025-08-02",
                "territory_type": "province",
                "territory_id": "2501",
                "sensor": "VIIRS_SNPP",
                "fire_pixels_low": 0,
                "fire_pixels_nominal_high": 3,
                "valid_land_pixels": 690,  # 69% < 70% (>30% nubes)
                "expected_land_pixels_per_day": 1000,
                "source_product": "VNP14A1",
            },
        ],
        env_daily_rows=[
            {
                "date": "2025-08-01",
                "territory_type": "province",
                "territory_id": "2501",
                "t_amb_c": 26.5,
                "relative_humidity_2m_pct": 62.0,
                "t_suelo_c": 33.4,
                "lst_valid_pixel_pct": 72.0,  # >= 70% -> conserva LST
                "wind_dir_deg": 110.0,
                "wind_speed_10m_ms": 2.4,
            },
            {
                "date": "2025-08-02",
                "territory_type": "province",
                "territory_id": "2501",
                "t_amb_c": 25.0,
                "relative_humidity_2m_pct": 70.0,
                "t_suelo_c": 31.0,
                "lst_valid_pixel_pct": 69.9,  # < 70% -> anula t_suelo_c
                "wind_dir_deg": 115.0,
                "wind_speed_10m_ms": 2.1,
            },
        ],
    )
    by_date = {r["date"]: r for r in daily}
    assert by_date["2025-08-01"]["cloud_ok_lt30pct"] is True
    assert by_date["2025-08-01"]["activity_rate"] == round(3 / 750, 6)
    assert by_date["2025-08-01"]["t_suelo_c"] == 33.4

    assert by_date["2025-08-02"]["cloud_ok_lt30pct"] is False
    assert by_date["2025-08-02"]["activity_rate"] is None
    assert by_date["2025-08-02"]["t_suelo_c"] is None


def test_calendar_endpoint_and_anomaly_baseline_years():
    """El endpoint /calendar entrega serie mensual con historical_anomaly y exige >=5 años de línea base."""
    r_cal = client.get("/api/v1/territories/province/1501/calendar?sensor=MODIS_TERRA")
    assert r_cal.status_code == 200
    payload = r_cal.json()
    assert payload["schema_version"] == "1.0"
    assert payload["sensor"] == "MODIS_TERRA"
    assert len(payload["items"]) >= 1

    item = payload["items"][0]
    for required_field in (
        "period_id",
        "fire_pixel_days_8_9",
        "fire_pixel_days_7_9",
        "activity_rate",
        "observation_coverage",
        "active_days",
        "max_consecutive_active_days",
        "historical_anomaly",
        "source_product",
        "processing_version",
    ):
        assert required_field in item

    anom = item["historical_anomaly"]
    assert anom["status"] == "estimated"
    assert anom["baseline_years"] >= 5

    # Caso con historial insuficiente (<5 años) en fixture FX13755
    r_cal_hu = client.get("/api/v1/territories/hydro_unit/FX13755/calendar?sensor=MODIS_TERRA")
    assert r_cal_hu.status_code == 200
    hu_anom = r_cal_hu.json()["items"][0]["historical_anomaly"]
    assert hu_anom["status"] == "insufficient_baseline"
    assert hu_anom["baseline_years"] == 3
    assert hu_anom["value"] is None

    # Validación directa del mínimo de 5 años en attach_historical_anomalies
    short_series = [
        {
            "period_id": f"{2021 + i}-09",
            "territory_type": "province",
            "territory_id": "2501",
            "sensor": "VIIRS_SNPP",
            "valid_land_pixel_days": 10000,
            "activity_rate": r,
            "observation_coverage": 0.85,
        }
        for i, r in enumerate([0.001, 0.002, 0.003, 0.004, 0.010])  # 4 previos + 1 actual
    ]
    attach_historical_anomalies(short_series, min_baseline_years=5)
    assert short_series[-1]["historical_anomaly"]["status"] == "insufficient_baseline"
    assert short_series[-1]["historical_anomaly"]["baseline_years"] == 4


def test_decision_tree_n0_to_n3b_and_150m_water_buffer_attenuation():
    """Cubre todas las ramas N0..N3b y la atenuación high -> moderate por buffer de agua 150 m."""
    # 5 años base para septiembre + año objetivo
    base_rows = []
    for idx, (p, sm, w, t, rh) in enumerate([
        (60.0, 0.30, 2.0, 24.0, 68.0),
        (70.0, 0.32, 2.5, 25.0, 65.0),
        (80.0, 0.34, 3.0, 26.0, 62.0),
        (90.0, 0.36, 3.5, 27.0, 60.0),
        (100.0, 0.38, 4.0, 28.0, 58.0),
    ]):
        base_rows.append({
            "period_id": f"{2020 + idx}-09",
            "territory_type": "province",
            "territory_id": "2501",
            "landcover_year": 2015,
            "vegetation_area_pct": 85.0,
            "water_area_pct": 2.0,
            "water_buffer_150m_pct": 2.0,
            "precip_30d_mm": p,
            "soil_moisture_surface": sm,
            "wind_speed_10m_ms": w,
            "temperature_2m_c": t,
            "relative_humidity_2m_pct": rh,
            "slope_class_area_pct": 20.0,
        })

    # N1:no -> low (vegetación < 20%)
    n1_no = assess_conditions(base_rows + [{**base_rows[-1], "period_id": "2025-09", "vegetation_area_pct": 15.0}], min_baseline_years=5)
    assert n1_no[-1]["classification"] == "low"
    assert n1_no[-1]["decision_path"] == ["N0:pass", "N1:no"]

    # N2:yes + N3a:no -> moderate (seco pero sin viento alto ni cálido-seco)
    n3a_no = assess_conditions(base_rows + [{**base_rows[-1], "period_id": "2025-09", "precip_30d_mm": 10.0, "wind_speed_10m_ms": 2.0, "temperature_2m_c": 24.0, "relative_humidity_2m_pct": 68.0}], min_baseline_years=5)
    assert n3a_no[-1]["classification"] == "moderate"
    assert n3a_no[-1]["decision_path"] == ["N0:pass", "N1:yes", "N2:yes", "N3a:no"]

    # N2:no + N3b:yes -> moderate (no seco, pero viento > p75 y pendiente >= 15%)
    n3b_yes = assess_conditions(base_rows + [{**base_rows[-1], "period_id": "2025-09", "precip_30d_mm": 120.0, "soil_moisture_surface": 0.40, "wind_speed_10m_ms": 6.0, "slope_class_area_pct": 18.0}], min_baseline_years=5)
    assert n3b_yes[-1]["classification"] == "moderate"
    assert n3b_yes[-1]["decision_path"] == ["N0:pass", "N1:yes", "N2:no", "N3b:yes"]

    # N2:no + N3b:no -> low (no seco y pendiente < 15%)
    n3b_no = assess_conditions(base_rows + [{**base_rows[-1], "period_id": "2025-09", "precip_30d_mm": 120.0, "soil_moisture_surface": 0.40, "wind_speed_10m_ms": 6.0, "slope_class_area_pct": 10.0}], min_baseline_years=5)
    assert n3b_no[-1]["classification"] == "low"
    assert n3b_no[-1]["decision_path"] == ["N0:pass", "N1:yes", "N2:no", "N3b:no"]

    # N2:yes + N3a:yes sin buffer -> high; con buffer 150 m (>=5%) -> atenúa a moderate
    high_row = {**base_rows[-1], "period_id": "2025-09", "precip_30d_mm": 10.0, "wind_speed_10m_ms": 6.0, "temperature_2m_c": 31.0, "relative_humidity_2m_pct": 40.0}
    res_high = assess_conditions(base_rows + [high_row], min_baseline_years=5)
    assert res_high[-1]["classification"] == "high"
    assert res_high[-1]["decision_path"] == ["N0:pass", "N1:yes", "N2:yes", "N3a:yes"]

    res_att = assess_conditions(base_rows + [{**high_row, "water_buffer_150m_pct": 7.5}], min_baseline_years=5)
    assert res_att[-1]["classification"] == "moderate"
    assert "surface_water_buffer_150m" in res_att[-1]["modifiers"]
    assert "water_buffer_150m_attenuation" in res_att[-1]["rules_triggered"]
    assert res_att[-1]["decision_path"] == ["N0:pass", "N1:yes", "N2:yes", "N3a:yes", "buffer_150m:attenuate"]

    # N0:fail sin variables suficientes -> not_evaluable / partial
    res_ne = assess_conditions([{"period_id": "2025-09", "territory_type": "province", "territory_id": "2502"}], min_baseline_years=5)
    assert res_ne[0]["classification"] == "not_evaluable"
    assert res_ne[0]["decision_path"] == ["N0:fail"]


def test_fixtures_vs_processed_separation():
    """Fixtures llevan data_origin='fixture'; el pipeline procesado emite data_origin='processed'."""
    fixture_meta = json.loads((ROOT / "data" / "fixtures" / "metadata.json").read_text(encoding="utf-8"))
    assert fixture_meta["data_origin"] == "fixture"
    assert "fixture" in fixture_meta["notice"].lower()

    r_meta = client.get("/api/v1/metadata")
    assert r_meta.status_code == 200
    assert r_meta.json()["data_origin"] == "fixture"

    proc_terr = json.loads((ROOT / "data" / "processed" / "territories.geojson").read_text(encoding="utf-8"))
    assert proc_terr["data_origin"] == "processed"

    daily = build_daily_records(
        [{"date": "2025-09-15", "territory_type": "province", "territory_id": "2501", "sensor": "VIIRS_SNPP", "fire_pixels_low": 0, "fire_pixels_nominal_high": 1, "valid_land_pixels": 800, "expected_land_pixels_per_day": 1000}],
        [],
    )
    summary = summarize_monthly_activity(daily)
    proc_meta = build_metadata(daily, summary, [])
    assert proc_meta["data_origin"] == "processed"


def test_no_spread_prediction_language_on_phase1_endpoints():
    """Los endpoints de Fase 1 no exponen simulación de propagación ni lenguaje predictivo."""
    r_meta = client.get("/api/v1/metadata")
    r_sum = client.get("/api/v1/territories/province/1501/summary?date=2026-09-15&sensor=MODIS_TERRA")
    r_cmp = client.get("/api/v1/territories/province/1501/sensor-comparison?date=2026-09-15")
    assert r_meta.status_code == 200
    assert r_sum.status_code == 200
    assert r_cmp.status_code == 200

    meta_json = r_meta.json()
    sum_json = r_sum.json()
    cmp_json = r_cmp.json()

    limitations_text = " ".join(meta_json.get("limitations", [])).lower()
    assert "probabilidad de incendio" in limitations_text
    assert "no se suman conteos" in limitations_text
    assert "cualitativa" in limitations_text

    for resp in (meta_json, sum_json, cmp_json):
        serialized = json.dumps(resp, ensure_ascii=False).lower()
        for key in SPREAD_PREDICTION_FORBIDDEN_KEYS:
            assert key not in resp
            assert key not in serialized
        # Permitir únicamente la negación en limitaciones de metadata; prohibir afirmaciones en summary/comparison
        if resp is not meta_json:
            for phrase in SPREAD_PREDICTION_FORBIDDEN_PHRASES:
                assert phrase not in serialized
