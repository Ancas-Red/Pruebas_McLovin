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


def test_realtime_area_public_firms_fallback_and_disable_flag(monkeypatch):
    main._FIRMS_PUBLIC_CACHE.clear()
    main._REVERSE_GEOCODE_CACHE.clear()
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    monkeypatch.delenv("MCHANAQ_ENABLE_REALTIME", raising=False)

    modis_csv = (
        "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight\n"
        "-8.25,-75.15,318.2,1.0,1.0,2026-11-14,1510,T,85,6.1NRT,290.1,42.5,D\n"
        "-30.00,-60.00,310.0,1.0,1.0,2026-11-14,1510,T,70,6.1NRT,288.0,12.0,D\n"
    )
    noaa_csv = (
        "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight\n"
        "-8.40,-75.05,342.0,0.4,0.6,2026-11-14,1800,N20,high,2.0NRT,285.0,18.3,D\n"
    )
    snpp_csv = (
        "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight\n"
    )

    class _FakeResp:
        def __init__(self, *, text="", json_data=None):
            self.text = text
            self._json = json_data

        def raise_for_status(self):
            return None

        def json(self):
            return self._json

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, params=None, **kwargs):
            if "open-meteo.com" in url:
                return _FakeResp(
                    json_data={
                        "current": {
                            "time": "2026-11-15T17:00",
                            "temperature_2m": 28.4,
                            "relative_humidity_2m": 64,
                            "wind_speed_10m": 3.2,
                            "wind_direction_10m": 120,
                        }
                    }
                )
            if "nominatim.openstreetmap.org" in url:
                return _FakeResp(
                    json_data={
                        "address": {
                            "country": "Perú",
                            "country_code": "pe",
                            "state": "Ucayali",
                            "province": "Coronel Portillo",
                            "city": "Pucallpa",
                        }
                    }
                )
            if "MODIS_C6_1" in url:
                return _FakeResp(text=modis_csv)
            if "J1_VIIRS_C2" in url:
                return _FakeResp(text=noaa_csv)
            return _FakeResp(text=snpp_csv)

    monkeypatch.setattr(main.httpx, "Client", _FakeClient)
    r = client.get("/api/v1/realtime/area?south=-9.5&west=-76.0&north=-7.5&east=-74.0&days=3")
    assert r.status_code == 200
    body = r.json()
    assert body["hotspots_status"] == "ok"
    assert body["firms_mode"] == "public_nrt_csv"
    assert body["counts_by_sensor"] == {"MODIS": 1, "VIIRS_SNPP": 0, "VIIRS_NOAA20": 1}
    assert len(body["hotspots"]["features"]) == 2
    assert body["weather"]["status"] == "ok"
    assert body["location"]["country"] == "Perú"

    # Modo offline explícito con MCHANAQ_ENABLE_REALTIME=0
    monkeypatch.setenv("MCHANAQ_ENABLE_REALTIME", "0")
    r_off = client.get("/api/v1/realtime/area?south=-9.5&west=-76.0&north=-7.5&east=-74.0&days=3")
    assert r_off.status_code == 200
    assert r_off.json()["hotspots_status"] == "realtime_disabled"


def test_spread_simulate_uses_live_wind_unless_user_fixes_it(monkeypatch):
    import importlib.util

    import pytest

    if importlib.util.find_spec("geopandas") is not None:
        pytest.skip("camino liviano (sin geopandas) no aplica en este entorno")

    monkeypatch.delenv("MCHANAQ_ENABLE_REALTIME", raising=False)
    monkeypatch.setattr(
        main,
        "_fetch_open_meteo_wind_for_date",
        lambda lat, lon, date_str: {
            "status": "ok",
            "source": "Open-Meteo Archive",
            "wind_speed_10m_ms": 7.25,
            "wind_dir_deg": 222.0,
        },
    )
    monkeypatch.setattr(
        main,
        "_fetch_open_meteo_dem_slope_py",
        lambda lat, lon: (3.4, 6.1, "COPERNICUS_DEM_GLO90_OPEN_METEO"),
    )

    base = {"lat": -8.25, "lon": -75.15, "date": "2026-11-10", "horizon_h": 48, "use_open_meteo": True}

    r_live = client.post("/api/v1/spread-simulate", json=base)
    assert r_live.status_code == 200
    live = r_live.json()
    assert live["data_sources"]["wind_source"] == "Open-Meteo Archive"
    assert live["dominant_wind"] == {"wind_dir_deg": 222.0, "wind_speed_10m_ms": 7.25}
    assert live["slope_summary"]["dem_source"] == "COPERNICUS_DEM_GLO90_OPEN_METEO"

    r_fixed = client.post(
        "/api/v1/spread-simulate",
        json={**base, "wind_speed_10m_ms": 2.5, "wind_dir_deg": 45.0, "live_wind": False},
    )
    assert r_fixed.status_code == 200
    fixed = r_fixed.json()
    assert fixed["data_sources"]["wind_source"] == "era5_daily_diurnal_profile"
    assert fixed["dominant_wind"] == {"wind_dir_deg": 45.0, "wind_speed_10m_ms": 2.5}
