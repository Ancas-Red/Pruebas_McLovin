"""Pruebas de humo multiplataforma para McHanaq API."""

import csv
import io
import os

os.environ.setdefault("MCHANAQ_DATA_DIR", "data/fixtures")
os.environ.setdefault("MCHANAQ_NO_CACHE", "1")

from fastapi.testclient import TestClient
from src.backend.app import main
from src.backend.app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["data_loaded"] is True


def test_health_partial_data_returns_false(monkeypatch):
    monkeypatch.setattr(main, "DAILY", [])
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["data_loaded"] is False


def test_territories_valid_and_invalid():
    assert client.get("/api/v1/territories?type=province").status_code == 200
    r_bad = client.get("/api/v1/territories?type=otro")
    assert r_bad.status_code == 400
    assert r_bad.json()["code"] == "INVALID_PARAMETER"


def test_date_validation_400_422_404():
    r_400 = client.get("/api/v1/territory-metrics?type=province&date=2026-02-30&sensor=MODIS_TERRA&metric=activity_rate")
    assert r_400.status_code == 400

    r_422 = client.get("/api/v1/territory-metrics?type=province&date=1999-01-01&sensor=MODIS_TERRA&metric=activity_rate")
    assert r_422.status_code == 422

    r_404 = client.get("/api/v1/territories/province/NO_EXISTE/summary?date=2026-09-15&sensor=MODIS_TERRA")
    assert r_404.status_code == 404


def test_daily_summary_activity_and_csv():
    r_sum = client.get("/api/v1/territories/province/1501/summary?date=2026-09-15&sensor=MODIS_TERRA")
    assert r_sum.status_code == 200
    body = r_sum.json()
    assert body["daily"]["t_suelo_c"] is not None
    assert body["data_quality"]["status"] in {"usable", "partial", "insufficient"}
    assert body["data_quality"]["valid_land_pixel_days"] == 9265
    assert body["data_quality"]["expected_land_pixel_days"] == 12000
    assert body["data_quality"]["observation_coverage"] == 0.7721
    assert body["provenance"]["source_product"] == "MOD14A1"
    assert "MOD14A1" in body["provenance"]["source_products"]
    assert body["provenance"]["processing_version"] == "fixture-0.1.0"
    assert body["provenance"]["data_origin"] == "fixture"
    assert body["provenance"]["dem_source"] == "COPERNICUS_DEM_GLO30"

    r_act = client.get("/api/v1/territories/province/1501/activity?from=2026-09-01&to=2026-09-30&sensor=MODIS_TERRA")
    assert r_act.status_code == 200
    act_body = r_act.json()
    assert act_body["territory"] == {"type": "province", "id": "1501"}
    assert act_body["from"] == "2026-09-01"
    assert act_body["to"] == "2026-09-30"
    assert act_body["period"] is None
    assert len(act_body["items"]) == 30

    r_csv = client.get("/api/v1/territories/province/1501/export.csv?from=2026-09-01&to=2026-09-30&sensor=MODIS_TERRA")
    assert r_csv.status_code == 200
    assert "t_suelo_c" in r_csv.text
    rows = list(csv.DictReader(io.StringIO(r_csv.text)))
    assert len(rows) == 30
    assert {"activity_rate", "source_product", "processing_version"}.issubset(rows[0].keys())
    day_10 = next(row for row in rows if row["date"] == "2026-09-10")
    assert day_10["activity_rate"] == ""
    assert day_10["t_suelo_c"] == ""


def test_metadata_metrics_env_and_comparison():
    r_meta = client.get("/api/v1/metadata")
    assert r_meta.status_code == 200
    assert "available_periods_by_sensor" in r_meta.json()

    r_env = client.get("/api/v1/territory-metrics?type=province&date=2026-09-15&metric=t_amb_c")
    assert r_env.status_code == 200
    assert r_env.json()["sensor"] is None
    assert len(r_env.json()["items"]) >= 1

    r_cls = client.get("/api/v1/territory-metrics?type=province&date=2026-09-15&metric=conditions_classification")
    assert r_cls.status_code == 200
    assert len(r_cls.json()["items"]) >= 1

    r_cmp = client.get("/api/v1/territories/province/1501/sensor-comparison?date=2026-09-15")
    assert r_cmp.status_code == 200
    assert r_cmp.json()["status"] in {"concordant_elevated", "concordant_not_elevated", "discordant", "single_sensor", "insufficient"}


def test_territory_metrics_sensor_monthly_summary_and_env_period(monkeypatch):
    r_sum_metric = client.get(
        "/api/v1/territory-metrics?type=province&date=2026-09-15&sensor=MODIS_TERRA&metric=fire_pixel_days_8_9"
    )
    assert r_sum_metric.status_code == 200
    body = r_sum_metric.json()
    assert body["sensor"] == "MODIS_TERRA"
    assert body["items"][0]["value"] == 13

    r_env_period = client.get("/api/v1/territory-metrics?type=province&period=2026-09&metric=t_amb_c")
    assert r_env_period.status_code == 200
    assert isinstance(r_env_period.json()["items"][0]["value"], float)

    r_wind_period = client.get("/api/v1/territory-metrics?type=province&period=2026-09&metric=wind_dir_deg")
    assert r_wind_period.status_code == 200
    wind_val = r_wind_period.json()["items"][0]["value"]
    assert wind_val is not None and 0.0 <= wind_val < 360.0

    # Null environmental values in period must stay None, never 0
    monkeypatch.setattr(
        main,
        "DAILY",
        [
            {
                "date": "2026-09-01",
                "territory_type": "province",
                "territory_id": "1501",
                "sensor": "MODIS_TERRA",
                "t_suelo_c": None,
                "wind_dir_deg": 350.0,
                "wind_speed_10m_ms": 2.0,
            },
            {
                "date": "2026-09-02",
                "territory_type": "province",
                "territory_id": "1501",
                "sensor": "MODIS_TERRA",
                "t_suelo_c": None,
                "wind_dir_deg": 10.0,
                "wind_speed_10m_ms": 2.0,
            },
        ],
    )
    r_null_env = client.get("/api/v1/territory-metrics?type=province&period=2026-09&metric=t_suelo_c")
    assert r_null_env.status_code == 200
    assert r_null_env.json()["items"] == [{"territory_type": "province", "territory_id": "1501", "value": None}]

    # Vector mean of 350 deg and 10 deg is 0.0 deg (north), not arithmetic mean 180.0
    r_vec_wind = client.get("/api/v1/territory-metrics?type=province&period=2026-09&metric=wind_dir_deg")
    assert r_vec_wind.status_code == 200
    assert r_vec_wind.json()["items"][0]["value"] == 0.0


def test_partial_boundary_period_validation(monkeypatch):
    meta_copy = {
        **main.META,
        "available_periods_by_sensor": {
            **main.META.get("available_periods_by_sensor", {}),
            "VIIRS_SNPP": ["2012-01"],
        },
        "available_date_ranges_by_sensor": {
            **main.META.get("available_date_ranges_by_sensor", {}),
            "VIIRS_SNPP": [{"from": "2012-01-19", "to": "2012-01-31"}],
        },
    }
    monkeypatch.setattr(main, "META", meta_copy)
    r_ok = client.get("/api/v1/territory-metrics?type=province&period=2012-01&sensor=VIIRS_SNPP&metric=activity_rate")
    assert r_ok.status_code == 200
    r_422 = client.get("/api/v1/territory-metrics?type=province&date=2012-01-01&sensor=VIIRS_SNPP&metric=activity_rate")
    assert r_422.status_code == 422


def test_activity_and_csv_range_validation_and_comparison_fallback(monkeypatch):
    r_bad_act = client.get(
        "/api/v1/territories/province/1501/activity?from=2026-09-20&to=2026-09-10&sensor=MODIS_TERRA"
    )
    assert r_bad_act.status_code == 400
    assert r_bad_act.json()["code"] == "INVALID_PARAMETER"

    r_bad_csv = client.get(
        "/api/v1/territories/province/1501/export.csv?from=2026-09-20&to=2026-09-10&sensor=MODIS_TERRA"
    )
    assert r_bad_csv.status_code == 400

    monkeypatch.setattr(main, "COMPARE", [])
    r_fb = client.get("/api/v1/territories/province/1501/sensor-comparison?date=2026-09-15")
    assert r_fb.status_code == 200
    fb = r_fb.json()
    assert fb["status"] == "insufficient"
    assert fb["date"] == "2026-09-15"
    assert fb["interpretation"]
    assert fb["method_version"] == "fixture-0.1.0"


def test_calendar_endpoint():
    r = client.get("/api/v1/territories/province/1501/calendar?sensor=MODIS_TERRA")
    assert r.status_code == 200
    body = r.json()
    assert body["schema_version"] == "1.0"
    assert body["territory"] == {"type": "province", "id": "1501"}
    assert body["sensor"] == "MODIS_TERRA"
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["period_id"] == "2026-09"
    assert item["fire_pixel_days_8_9"] == 13
    assert item["fire_pixel_days_7_9"] == 20
    assert item["active_days"] == 11
    assert item["max_consecutive_active_days"] == 4
    assert item["historical_anomaly"]["status"] == "estimated"
    assert item["source_product"] == "MOD14A1"
    assert item["processing_version"] == "fixture-0.1.0"

    r_filtered = client.get(
        "/api/v1/territories/province/1501/calendar?sensor=MODIS_TERRA&from_period=2026-10&to_period=2026-12"
    )
    assert r_filtered.status_code == 200
    assert r_filtered.json()["items"] == []

    r_bad_range = client.get(
        "/api/v1/territories/province/1501/calendar?sensor=MODIS_TERRA&from_period=2026-10&to_period=2026-09"
    )
    assert r_bad_range.status_code == 400

    r_404 = client.get("/api/v1/territories/province/NO_EXISTE/calendar?sensor=MODIS_TERRA")
    assert r_404.status_code == 404


def test_root_probe_and_cors_normalization(monkeypatch):
    r_root = client.get("/")
    assert r_root.status_code == 200
    assert r_root.json()["status"] == "ok"
    assert r_root.json()["health"] == "/api/v1/health"

    monkeypatch.setenv("MCHANAQ_CORS_ORIGINS", "https://mchanaq.pages.dev/, http://localhost:5173/")
    monkeypatch.setenv("MCHANAQ_CORS_ORIGIN_REGEX", r"^https://([a-z0-9-]+\.)*pages\.dev$")
    import importlib.util
    from pathlib import Path

    # Cargar en un nombre aislado para no invalidar la identidad de ApiError en src.backend.app.main.
    spec = importlib.util.spec_from_file_location("mchanaq_cors_probe", Path(main.__file__))
    assert spec and spec.loader
    probe_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(probe_mod)
    assert probe_mod.CORS_ORIGINS == ["https://mchanaq.pages.dev", "http://localhost:5173"]
    local_client = TestClient(probe_mod.app)
    pre = local_client.options(
        "/api/v1/health",
        headers={
            "Origin": "https://preview-123.mchanaq.pages.dev",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert pre.status_code == 200
    assert pre.headers.get("access-control-allow-origin") == "https://preview-123.mchanaq.pages.dev"


def test_reverse_geocode_normalizes_country_region_province_city(monkeypatch):
    main._REVERSE_GEOCODE_CACHE.clear()

    class _FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "address": {
                    "country": "Estados Unidos de América",
                    "country_code": "us",
                    "state": "California",
                    "county": "Butte County",
                    "town": "Paradise",
                }
            }

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, *args, **kwargs):
            return _FakeResp()

    monkeypatch.setattr(main.httpx, "Client", _FakeClient)
    r = client.get("/api/v1/reverse-geocode", params={"lat": 39.759, "lon": -121.622})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["country"] == "Estados Unidos"
    assert body["region"] == "California"
    assert body["province"] == "Butte County"
    assert body["city"] == "Paradise"
    assert body["header_primary"] == "Estados Unidos"
    assert body["header_sub"] == "Paradise · Butte County"
