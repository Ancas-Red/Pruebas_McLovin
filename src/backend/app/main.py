"""McHanaq API — Backend de solo lectura (Fase 1, resolución diaria por defecto)."""

import calendar
import csv
import io
import json
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date as dt_date, datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import Body, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

ROOT = Path(__file__).resolve().parents[3]
DATA = Path(os.getenv("MCHANAQ_DATA_DIR", ROOT / "data" / "processed"))
if not DATA.is_absolute():
    DATA = ROOT / DATA
NO_CACHE = os.getenv("MCHANAQ_NO_CACHE", "0") == "1"
CORS_ORIGINS = [
    o.strip().rstrip("/")
    for o in os.getenv("MCHANAQ_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]
CORS_ORIGIN_REGEX = os.getenv("MCHANAQ_CORS_ORIGIN_REGEX", "").strip() or None

TYPES = {"province", "hydro_unit"}
SENSORS = {"MODIS_TERRA", "MODIS_AQUA", "VIIRS_SNPP"}

# Piso histórico del complemento en vivo: 2012-01-19, el inicio de la ventana multisensor
# verificada en GEE (MODIS_TERRA + MODIS_AQUA + VIIRS_SNPP + ERA5-Land) documentada en
# AGENTS.md. Aunque MODIS Terra/Aqua tienen cobertura real desde 2000-02/2002-07, esos años
# (2000-2011) quedan retirados explícitamente como "fuera de alcance operativo" del
# proyecto — no se habilita el complemento en vivo ahí para no exponer una ventana más
# amplia de la que el proyecto reclama cubrir.
_SENSOR_HISTORICAL_SINCE = {
    "MODIS_TERRA": "2012-01-19",
    "MODIS_AQUA": "2012-01-19",
    "VIIRS_SNPP": "2012-01-19",
}
# NASA FIRMS Area API expone MODIS Terra/Aqua bajo una sola fuente "MODIS_SP" (Standard
# Processing, histórico completo) distinguida por la columna satellite=Terra|Aqua; VIIRS
# S-NPP tiene su propia fuente histórica.
_FIRMS_HIST_SOURCE_BY_SENSOR = {
    "MODIS_TERRA": ("MODIS_SP", "Terra"),
    "MODIS_AQUA": ("MODIS_SP", "Aqua"),
    "VIIRS_SNPP": ("VIIRS_SNPP_SP", None),
}
ACTIVITY_METRICS = {
    "activity_rate",
    "fire_pixels_nominal_high",
    "fire_pixels_low",
    "observation_coverage",
    "fire_pixel_days_8_9",
    "active_days",
    "max_consecutive_active_days",
}
MONTHLY_SUMMARY_METRICS = {
    "fire_pixel_days_8_9",
    "active_days",
    "max_consecutive_active_days",
}
ENV_METRICS = {
    "t_amb_c",
    "relative_humidity_2m_pct",
    "t_suelo_c",
    "lst_valid_pixel_pct",
    "wind_dir_deg",
    "wind_speed_10m_ms",
    "elevation_m",
    "conditions_classification",
}


def load_json(name: str):
    """Carga un JSON/GeoJSON desde DATA si existe."""
    path = DATA / name
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


META = load_json("metadata.json") or {}
TERR = (
    load_json("peru_territories.geojson")
    or load_json("territories.geojson")
    or {"type": "FeatureCollection", "features": []}
)
DAILY = (load_json("activity_daily.json") or {}).get("items", [])
SUMMARY = (load_json("activity_summary.json") or {}).get("items", [])
COMPARE = (load_json("sensor_comparison.json") or {}).get("items", [])
ASSESS = (load_json("conditions_assessment.json") or {}).get("items", [])
HOTSPOTS = load_json("hotspots.geojson")

# Índice por (territory_type, territory_id, sensor, date) construido una sola vez al
# arrancar. Sin esto, cada /summary hacía un pick(DAILY, ...) por fecha exacta: con la
# ventana FIRMS 2020-2025 cargada (427 territorios x ~3 sensores x ~2190 días, ver
# AGENTS.md sobre el tamaño de activity_daily.json), un pick() que no encuentra fila
# (p. ej. cualquier fecha fuera de la tabla, que es justo cuando se activa el
# complemento en vivo de NASA FIRMS) recorre TODA la lista, millones de filas, en cada
# petición. Medido en producción: ~3 s por /summary sin esto, pase lo que pase con FIRMS.
_DAILY_INDEX: dict[tuple, dict] = {
    (r.get("territory_type"), str(r.get("territory_id")), r.get("sensor"), r.get("date")): r
    for r in DAILY
}
# Mismo problema para el fallback de dem_source en _build_summary_provenance: agrupado
# por (territory_type, territory_id, sensor, period) para no recorrer DAILY completo.
_DAILY_BY_TERRITORY_SENSOR_PERIOD: dict[tuple, list[dict]] = {}
for _r in DAILY:
    _k = (_r.get("territory_type"), str(_r.get("territory_id")), _r.get("sensor"), (_r.get("date") or "")[:7])
    _DAILY_BY_TERRITORY_SENSOR_PERIOD.setdefault(_k, []).append(_r)

# Mismo problema en SUMMARY/ASSESS/COMPARE (uno por territorio x sensor x mes, ~209 000
# filas con la ventana 2012-2025): pick() con next()+generador escanea toda la lista
# cuando no hay match. Se indexan igual, también construido una sola vez al arrancar.
_SUMMARY_INDEX: dict[tuple, dict] = {
    (r.get("territory_type"), str(r.get("territory_id")), r.get("sensor"), r.get("period_id")): r
    for r in SUMMARY
}
_ASSESS_INDEX: dict[tuple, dict] = {
    (r.get("territory_type"), str(r.get("territory_id")), r.get("period_id")): r for r in ASSESS
}
_COMPARE_INDEX: dict[tuple, dict] = {
    (r.get("territory_type"), str(r.get("territory_id")), r.get("period_id")): r for r in COMPARE
}


def _is_useful_daily_record(record: dict) -> bool:
    """Replica el criterio de src/analytics/run_pipeline.py: >=70% cobertura o tasa valida."""
    valid = record.get("valid_land_pixels")
    if valid is None or valid <= 0:
        return False
    cov = record.get("observation_coverage")
    if cov is not None and cov < 0.70:
        return False
    return bool(record.get("cloud_ok_lt30pct")) or (record.get("activity_rate") is not None)


def _contiguous_date_ranges(dates: list[str]) -> list[dict[str, str]]:
    """Agrupa fechas en rangos continuos por meses calendario consecutivos (igual que run_pipeline.py)."""
    if not dates:
        return []
    uniq = sorted(set(dates))

    def _next_month(period: str) -> str:
        y, m = int(period[:4]), int(period[5:7])
        return f"{y + 1}-01" if m == 12 else f"{y}-{m + 1:02d}"

    ranges: list[dict[str, str]] = []
    span_start = uniq[0]
    span_end = uniq[0]
    prev_period = uniq[0][:7]
    for d in uniq[1:]:
        cur_period = d[:7]
        if cur_period == prev_period or cur_period == _next_month(prev_period):
            span_end = d
        else:
            ranges.append({"from": span_start, "to": span_end})
            span_start = d
            span_end = d
        prev_period = cur_period
    ranges.append({"from": span_start, "to": span_end})
    return ranges


def _reconcile_metadata_with_daily(meta: dict, daily: list[dict]) -> dict:
    """Recalcula available_periods_by_sensor / available_date_ranges_by_sensor desde la
    tabla DAILY realmente cargada en memoria, en vez de confiar en el metadata.json estatico.

    Por que: metadata.json y activity_daily.json se generan (y suben a R2) en corridas
    independientes del pipeline, y pueden desincronizarse (p. ej. metadata.json sigue
    anunciando 2012-2025 mientras activity_daily.json solo trae filas desde una fecha mas
    reciente por el limite de RAM del backend, ver AGENTS.md). Sin esto, el calendario deja
    elegir meses "disponibles" segun metadata para los que /activity no tiene ninguna fila,
    y la ficha diaria sale "no disponible" sin explicacion.
    """
    if not daily:
        return meta
    dates_by_sensor: dict[str, set] = {}
    for r in daily:
        s = r.get("sensor")
        d = r.get("date")
        if not s or not d or not _is_useful_daily_record(r):
            continue
        dates_by_sensor.setdefault(s, set()).add(d)
    if not any(dates_by_sensor.values()):
        return meta
    meta = dict(meta)
    meta["available_periods_by_sensor"] = {
        s: sorted({d[:7] for d in dates}) for s, dates in dates_by_sensor.items()
    }
    meta["available_date_ranges_by_sensor"] = {
        s: _contiguous_date_ranges(sorted(dates)) for s, dates in dates_by_sensor.items()
    }
    return meta


META = _reconcile_metadata_with_daily(META, DAILY)

# Piso histórico "en vivo" (NASA FIRMS Area API, Standard Processing): separado a
# propósito de available_periods_by_sensor/available_date_ranges_by_sensor, que deben
# seguir reflejando únicamente días útiles validados offline (ver AGENTS.md, "Integridad
# científica"). Este campo solo existe para que el frontend sepa que una fecha fuera de la
# tabla diaria local todavía se puede consultar (más lento la primera vez, luego en caché)
# en vez de bloquearla. Vacío si no hay FIRMS_MAP_KEY configurada.
if os.getenv("FIRMS_MAP_KEY", "").strip():
    META = dict(META)
    META["firms_live_available_since_by_sensor"] = dict(_SENSOR_HISTORICAL_SINCE)


class ApiError(Exception):
    """Error de dominio con formato uniforme para el cliente."""

    def __init__(self, status: int, code: str, detail: str):
        self.status = status
        self.code = code
        self.detail = detail


app = FastAPI(title="McHanaq API", version="1.2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_cache_header(request: Request, call_next):
    response = await call_next(request)
    if request.method == "GET" and response.status_code == 200 and not request.url.path.endswith("/health"):
        response.headers["Cache-Control"] = "no-store" if NO_CACHE else "public, max-age=300"
    return response


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status, content={"code": exc.code, "detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, __: RequestValidationError):
    return JSONResponse(status_code=400, content={"code": "INVALID_PARAMETER", "detail": "Parámetros inválidos"})


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, __: Exception):
    return JSONResponse(status_code=500, content={"code": "INTERNAL_ERROR", "detail": "Error interno del servidor"})


def check_type(t: str) -> None:
    if t not in TYPES:
        raise ApiError(400, "INVALID_PARAMETER", f"type debe ser uno de {sorted(TYPES)}")


def check_sensor(s: str) -> None:
    if s not in SENSORS:
        raise ApiError(400, "INVALID_PARAMETER", f"sensor debe ser uno de {sorted(SENSORS)}")


def check_date_syntax(d: str) -> None:
    if len(d) != 10 or d[4] != "-" or d[7] != "-":
        raise ApiError(400, "INVALID_PARAMETER", f"Formato de fecha inválido: {d} (usar YYYY-MM-DD)")
    try:
        dt_date.fromisoformat(d)
    except ValueError:
        raise ApiError(400, "INVALID_PARAMETER", f"Formato de fecha inválido: {d} (usar YYYY-MM-DD)")


def check_period_syntax(p: str) -> None:
    if len(p) != 7 or p[4] != "-":
        raise ApiError(400, "INVALID_PARAMETER", f"Formato de período inválido: {p} (usar YYYY-MM)")
    try:
        dt_date.fromisoformat(f"{p}-01")
    except ValueError:
        raise ApiError(400, "INVALID_PARAMETER", f"Formato de período inválido: {p} (usar YYYY-MM)")


def _date_in_ranges(d: str, ranges: object) -> bool:
    if isinstance(ranges, dict):
        ranges = [ranges]
    if not isinstance(ranges, list):
        return False
    for r in ranges:
        if not isinstance(r, dict):
            continue
        start = r.get("start") or r.get("from")
        end = r.get("end") or r.get("to")
        if start and end and start <= d <= end:
            return True
    return False


def _period_in_ranges(p: str, ranges: object) -> bool:
    if isinstance(ranges, dict):
        ranges = [ranges]
    if not isinstance(ranges, list):
        return False
    for r in ranges:
        if not isinstance(r, dict):
            continue
        start = r.get("start") or r.get("from")
        end = r.get("end") or r.get("to")
        if start and end and start[:7] <= p <= end[:7]:
            return True
    return False


def check_date(
    d: str | None = None,
    sensor: str | None = None,
    full: bool = False,
    comparison: bool = False,
    env_only: bool = False,
    period: str | None = None,
) -> str:
    if d is not None:
        check_date_syntax(d)
        resolved_period = d[:7]
        ok = True
        if sensor:
            ranges_map = META.get("available_date_ranges_by_sensor", {})
            if sensor in ranges_map:
                sensor_ok = _date_in_ranges(d, ranges_map[sensor])
            else:
                sensor_ok = resolved_period in META.get("available_periods_by_sensor", {}).get(sensor, [])
            # Fuera de la tabla diaria local pero dentro del piso histórico documentado del
            # sensor: no es un "día útil" validado (eso solo lo da run_pipeline.py offline),
            # pero sí se puede complementar con una consulta en vivo a NASA FIRMS si hay
            # FIRMS_MAP_KEY configurada. Sin esto, cualquier fecha anterior a la tabla local
            # (p. ej. 2012-2021) quedaba bloqueada con 422 aunque el complemento en vivo
            # pudiera responderla.
            if not sensor_ok and _date_has_live_firms_fallback(sensor, d):
                sensor_ok = True
            ok &= sensor_ok
        env_dates = META.get("common_environmental_dates")
        env_periods = META.get("common_environmental_periods")
        has_env_window = bool(env_dates) or bool(env_periods)
        if env_only or (full and has_env_window):
            if env_dates:
                ok &= _date_in_ranges(d, env_dates)
            elif env_periods:
                ok &= resolved_period in env_periods
            else:
                ok = False
        if comparison:
            if "common_analysis_dates" in META:
                ok &= _date_in_ranges(d, META.get("common_analysis_dates"))
            else:
                ok &= resolved_period in (META.get("common_analysis_periods") or [])
        if not ok:
            raise ApiError(422, "PERIOD_NOT_AVAILABLE", f"La fecha {d} no está publicada para esta consulta")
        return resolved_period

    if period is not None:
        check_period_syntax(period)
        ok = True
        if sensor:
            periods_map = META.get("available_periods_by_sensor", {})
            if sensor in periods_map:
                ok &= period in periods_map[sensor]
            else:
                ok &= _period_in_ranges(period, META.get("available_date_ranges_by_sensor", {}).get(sensor))
        env_dates = META.get("common_environmental_dates")
        env_periods = META.get("common_environmental_periods")
        has_env_window = bool(env_dates) or bool(env_periods)
        if env_only or (full and has_env_window):
            if env_periods:
                ok &= period in env_periods
            elif env_dates:
                ok &= _period_in_ranges(period, env_dates)
            else:
                ok = False
        if comparison:
            if "common_analysis_periods" in META:
                ok &= period in (META.get("common_analysis_periods") or [])
            else:
                ok &= _period_in_ranges(period, META.get("common_analysis_dates"))
        if not ok:
            raise ApiError(422, "PERIOD_NOT_AVAILABLE", f"El período {period} no está publicado para esta consulta")
        return period

    raise ApiError(400, "INVALID_PARAMETER", "Debe indicar date (YYYY-MM-DD) o period (YYYY-MM)")


def _aggregate_env_metric_for_period(
    t_type: str,
    period: str,
    metric: str,
    sensor: str | None = None,
) -> list[dict]:
    """Agrega una variable ambiental diaria desde DAILY para un período YYYY-MM."""
    by_terr_day: dict[str, dict[str, dict]] = {}
    for row in DAILY:
        if row.get("territory_type") != t_type:
            continue
        row_date = row.get("date", "")
        if not row_date.startswith(period):
            continue
        if sensor and row.get("sensor") != sensor:
            continue
        tid = str(row.get("territory_id"))
        day_map = by_terr_day.setdefault(tid, {})
        existing = day_map.get(row_date)
        if existing is None or (existing.get(metric) is None and row.get(metric) is not None):
            day_map[row_date] = row

    items: list[dict] = []
    for day_map in by_terr_day.values():
        rows = list(day_map.values())
        val: float | None = None
        if metric == "wind_dir_deg":
            u_acc = 0.0
            v_acc = 0.0
            n_valid = 0
            for r in rows:
                wd = r.get("wind_dir_deg")
                if wd is None:
                    continue
                ws = r.get("wind_speed_10m_ms")
                w = float(ws) if ws is not None else 1.0
                rad = math.radians(float(wd))
                u_acc += -w * math.sin(rad)
                v_acc += -w * math.cos(rad)
                n_valid += 1
            if n_valid > 0 and (abs(u_acc) > 1e-9 or abs(v_acc) > 1e-9):
                val = round((math.degrees(math.atan2(-u_acc, -v_acc)) + 360.0) % 360.0, 1)
        else:
            vals = [float(r[metric]) for r in rows if r.get(metric) is not None]
            if vals:
                val = round(sum(vals) / len(vals), 3)
        items.append({"territory_type": t_type, "territory_id": rows[0].get("territory_id"), "value": val})
    return items


def _build_summary_data_quality(summary_row: dict, assess_row: dict) -> dict:
    """Construye el bloque data_quality combinando cobertura satelital y evaluación ambiental."""
    valid_days = summary_row.get("valid_land_pixel_days")
    expected_days = summary_row.get("expected_land_pixel_days")
    obs_cov = summary_row.get("observation_coverage")
    assess_status = assess_row.get("data_quality_status")

    notes: list[str] = []
    if obs_cov is None or valid_days is None or valid_days <= 0 or obs_cov < 0.4 or assess_status == "insufficient":
        status = "insufficient"
        if obs_cov is None or (valid_days is not None and valid_days <= 0) or (obs_cov is not None and obs_cov < 0.4):
            notes.append("Cobertura de observación satelital insuficiente en el período.")
    elif obs_cov < 0.7 or assess_status == "partial":
        status = "partial"
        if obs_cov < 0.7:
            notes.append("Cobertura de observación satelital parcial (<70 %).")
    else:
        status = "usable"

    missing_vars = assess_row.get("missing_variables") or []
    if missing_vars:
        notes.append(f"Variables ambientales faltantes: {', '.join(missing_vars)}.")

    return {
        "valid_land_pixel_days": valid_days,
        "expected_land_pixel_days": expected_days,
        "observation_coverage": obs_cov,
        "status": status,
        "notes": notes,
    }


def _build_summary_provenance(
    t_type: str,
    t_id: str,
    sensor: str,
    resolved_period: str,
    daily_row: dict | None,
    summary_row: dict,
    assess_row: dict,
) -> dict:
    """Construye el bloque provenance con trazabilidad de sensor, DEM y versión."""
    source_product = summary_row.get("source_product") or (daily_row or {}).get("source_product")
    assess_products = assess_row.get("source_products") or []
    source_products: list[str] = []
    for prod in ([source_product] if source_product else []) + list(assess_products):
        if prod and prod not in source_products:
            source_products.append(prod)

    dem_source = (daily_row or {}).get("dem_source")
    if not dem_source:
        for r in _DAILY_BY_TERRITORY_SENSOR_PERIOD.get((t_type, t_id, sensor, resolved_period), []):
            if r.get("dem_source"):
                dem_source = r.get("dem_source")
                break

    processing_version = (
        summary_row.get("processing_version")
        or (daily_row or {}).get("processing_version")
        or assess_row.get("processing_version")
        or META.get("processing_version")
    )
    return {
        "source_product": source_product,
        "source_products": source_products,
        "processing_version": processing_version,
        "data_origin": META.get("data_origin"),
        "dem_source": dem_source,
        "generated_at": META.get("generated_at"),
    }


def find_territory(t_type: str, t_id: str) -> dict:
    for feat in TERR.get("features", []):
        props = feat.get("properties", {})
        if props.get("territory_type") == t_type and str(props.get("territory_id")) == t_id:
            return props
    raise ApiError(404, "NOT_FOUND", f"Territorio {t_type}/{t_id} no encontrado")


def pick(items: list[dict], **keys) -> dict | None:
    return next((i for i in items if all(str(i.get(k)) == str(v) for k, v in keys.items())), None)


def _territory_bbox(t_type: str, t_id: str) -> tuple[float, float, float, float] | None:
    """west, south, east, north de la geometría del territorio (para acotar la consulta
    histórica a FIRMS a su área real, no a todo el país)."""
    for feat in TERR.get("features", []):
        props = feat.get("properties", {})
        if props.get("territory_type") == t_type and str(props.get("territory_id")) == t_id:
            geom = feat.get("geometry") or {}
            coords = geom.get("coordinates")
            if not coords:
                return None
            lons: list[float] = []
            lats: list[float] = []

            def _walk(c):
                if not c:
                    return
                if isinstance(c[0], (int, float)):
                    lons.append(c[0])
                    lats.append(c[1])
                else:
                    for cc in c:
                        _walk(cc)

            _walk(coords)
            if not lons or not lats:
                return None
            return (min(lons), min(lats), max(lons), max(lats))
    return None


# Consulta histórica (Standard Processing) a NASA FIRMS Area API para territorios/fechas
# fuera de la tabla diaria local (activity_daily.json). Cacheada por (territorio, sensor,
# fecha): un día pasado no cambia, así que una vez consultado queda servido de memoria.
_FIRMS_HIST_CACHE_TTL_S = 6 * 3600.0
_FIRMS_HIST_CACHE_MAX = 2000
_FIRMS_HIST_CACHE: dict[tuple, tuple[float, dict | None]] = {}
_FIRMS_HIST_CACHE_LOCK = threading.Lock()


def _date_has_live_firms_fallback(sensor: str, date: str) -> bool:
    """True si esta fecha, fuera de la tabla diaria local, se puede complementar con una
    consulta en vivo a NASA FIRMS (requiere FIRMS_MAP_KEY y estar dentro del piso histórico
    documentado del sensor, nunca en el futuro)."""
    if not os.getenv("FIRMS_MAP_KEY", "").strip():
        return False
    since = _SENSOR_HISTORICAL_SINCE.get(sensor)
    if not since or date < since:
        return False
    return date <= dt_date.today().isoformat()


def _fetch_firms_historical_day(t_type: str, t_id: str, sensor: str, date: str) -> dict | None:
    """Focos activos de un día/territorio/sensor fuera de la cobertura local, vía la Area
    API histórica (Standard Processing) de NASA FIRMS. Nunca inventa valid_land_pixels,
    observation_coverage ni activity_rate (eso exige el ráster completo que calcula
    run_pipeline.py offline): solo cuenta detecciones reales de fuego, marcado como tal
    (source_product). Si no hay FIRMS_MAP_KEY o el sensor/fecha no tiene cobertura
    documentada, devuelve None (el llamador cae de vuelta a "sin dato")."""
    firms_key = os.getenv("FIRMS_MAP_KEY", "").strip()
    since = _SENSOR_HISTORICAL_SINCE.get(sensor)
    src = _FIRMS_HIST_SOURCE_BY_SENSOR.get(sensor)
    if not firms_key or not since or not src or date < since:
        return None
    bbox = _territory_bbox(t_type, t_id)
    if not bbox:
        return None
    firms_source, sat_filter = src

    key = (t_type, t_id, sensor, date)
    now = time.monotonic()
    with _FIRMS_HIST_CACHE_LOCK:
        hit = _FIRMS_HIST_CACHE.get(key)
        if hit and hit[0] > now:
            return hit[1]

    west, south, east, north = bbox
    bbox_str = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{firms_key}/{firms_source}/{bbox_str}/1/{date}"
    result: dict | None
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url)
            resp.raise_for_status()
            text = resp.text.strip()
        if not text or text.lower().startswith("invalid"):
            result = None
        else:
            rows = _parse_firms_csv_tuples(text)
            if sat_filter:
                rows = [r for r in rows if r[6] == sat_filter]

            fire_low = sum(1 for r in rows if _is_low_confidence_row(sensor, r[4]))
            # fire_pixels_nominal_high es acumulado (low + nominal/high), igual que en
            # firms_to_daily_activity.py, para que el resto de la app lo lea como siempre.
            result = {
                "date": date,
                "territory_type": t_type,
                "territory_id": t_id,
                "sensor": sensor,
                "fire_pixels_low": fire_low,
                "fire_pixels_nominal_high": len(rows),
                "valid_land_pixels": None,
                "expected_land_pixels_per_day": None,
                "observation_coverage": None,
                "cloud_ok_lt30pct": None,
                "activity_rate": None,
                "t_amb_c": None,
                "relative_humidity_2m_pct": None,
                "t_suelo_c": None,
                "lst_valid_pixel_pct": None,
                "wind_dir_deg": None,
                "wind_speed_10m_ms": None,
                "elevation_m": None,
                "dem_source": None,
                "source_product": "FIRMS_SP_live_query",
                "processing_version": META.get("processing_version"),
                "data_origin": "firms_live_historical",
            }
    except Exception:
        result = None

    with _FIRMS_HIST_CACHE_LOCK:
        if len(_FIRMS_HIST_CACHE) >= _FIRMS_HIST_CACHE_MAX and key not in _FIRMS_HIST_CACHE:
            oldest_key = next(iter(_FIRMS_HIST_CACHE))
            _FIRMS_HIST_CACHE.pop(oldest_key, None)
        _FIRMS_HIST_CACHE[key] = (now + _FIRMS_HIST_CACHE_TTL_S, result)
    return result


_FIRMS_HIST_POINTS_CACHE: dict[tuple, tuple[float, list[dict]]] = {}
_FIRMS_HIST_POINTS_CACHE_MAX = 500


def _territory_geometry(t_type: str, t_id: str):
    """Geometría shapely del territorio, o None si shapely no está o no hay geometría
    (shapely se importa de forma diferida: su ausencia no debe romper el backend)."""
    try:
        from shapely.geometry import shape
    except ImportError:
        return None
    for feat in TERR.get("features", []):
        props = feat.get("properties", {})
        if props.get("territory_type") == t_type and str(props.get("territory_id")) == t_id:
            try:
                geom = shape(feat["geometry"]) if feat.get("geometry") else None
            except Exception:
                return None
            return geom if geom is not None and not geom.is_empty else None
    return None


def _fetch_firms_historical_points(t_type: str, t_id: str, sensor: str, date: str) -> list[dict]:
    """Puntos reales (lat/lon) de un día/territorio/sensor vía la Area API histórica de
    NASA FIRMS (Standard Processing). Es el complemento de /hotspots para fechas sin
    hotspots.geojson. Requiere FIRMS_MAP_KEY; sin ella, o fuera del piso histórico,
    devuelve []. Los puntos se recortan al polígono del territorio cuando shapely está
    disponible (si no, quedan los del bbox). Cacheado 6 h."""
    if not _date_has_live_firms_fallback(sensor, date):
        return []
    firms_key = os.getenv("FIRMS_MAP_KEY", "").strip()
    src = _FIRMS_HIST_SOURCE_BY_SENSOR.get(sensor)
    bbox = _territory_bbox(t_type, t_id)
    if not firms_key or not src or not bbox:
        return []
    firms_source, sat_filter = src

    key = (t_type, t_id, sensor, date)
    now = time.monotonic()
    with _FIRMS_HIST_CACHE_LOCK:
        hit = _FIRMS_HIST_POINTS_CACHE.get(key)
        if hit and hit[0] > now:
            return hit[1]

    west, south, east, north = bbox
    url = (
        f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{firms_key}/{firms_source}/"
        f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}/1/{date}"
    )
    features: list[dict] = []
    cacheable = True
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url)
            resp.raise_for_status()
            text = resp.text.strip()
        if text and not text.lower().startswith("invalid"):
            rows = _parse_firms_csv_tuples(text)
            if sat_filter:
                rows = [r for r in rows if r[6] == sat_filter]
            geom = _territory_geometry(t_type, t_id)
            if geom is not None:
                from shapely.geometry import Point

                rows = [r for r in rows if geom.covers(Point(r[1], r[0]))]
            for lat_v, lon_v, acq_date, _acq_time, confidence, frp_val, _sat, _dn in rows:
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon_v, lat_v]},
                    "properties": {
                        "date": date,
                        "sensor": sensor,
                        "territory_type": t_type,
                        "territory_id": t_id,
                        "confidence": confidence,
                        "frp_mw": frp_val,
                        "data_origin": "firms_live_historical",
                    },
                })
    except Exception:
        # Error de red/NASA: no se cachea para reintentar en la próxima petición.
        cacheable = False
        features = []

    if cacheable:
        with _FIRMS_HIST_CACHE_LOCK:
            if len(_FIRMS_HIST_POINTS_CACHE) >= _FIRMS_HIST_POINTS_CACHE_MAX and key not in _FIRMS_HIST_POINTS_CACHE:
                _FIRMS_HIST_POINTS_CACHE.pop(next(iter(_FIRMS_HIST_POINTS_CACHE)), None)
            _FIRMS_HIST_POINTS_CACHE[key] = (now + _FIRMS_HIST_CACHE_TTL_S, features)
    return features


def _is_low_confidence_row(sensor: str, raw: str | None) -> bool:
    """Mismo criterio que firms_to_daily_activity.py (_confidence_bucket): VIIRS usa
    letras l/n/h, MODIS usa 0-100."""
    raw_s = (raw or "").strip().lower()
    if sensor == "VIIRS_SNPP":
        return raw_s in {"l", "low"}
    try:
        return float(raw_s) < 50
    except ValueError:
        return False


_FIRMS_HIST_POINTS_CACHE_TTL_S = 6 * 3600.0
_FIRMS_HIST_POINTS_CACHE_MAX = 2000
_FIRMS_HIST_POINTS_CACHE: dict[tuple, tuple[float, list[dict]]] = {}
_FIRMS_HIST_POINTS_CACHE_LOCK = threading.Lock()


def _fetch_firms_historical_points(t_type: str, t_id: str, sensor: str, date: str) -> list[dict] | None:
    """Igual que _fetch_firms_historical_day pero devolviendo un Feature GeoJSON por
    detección real (lat/lon exactos de NASA FIRMS), para /hotspots cuando no existe
    hotspots.geojson local (no hay archivo con puntos precalculados en este despliegue).
    Nunca se inventan coordenadas: si la consulta en vivo falla o no hay FIRMS_MAP_KEY,
    devuelve None y el llamador cae a "sin puntos" (lista vacía), nunca a una muestra."""
    firms_key = os.getenv("FIRMS_MAP_KEY", "").strip()
    since = _SENSOR_HISTORICAL_SINCE.get(sensor)
    src = _FIRMS_HIST_SOURCE_BY_SENSOR.get(sensor)
    if not firms_key or not since or not src or date < since:
        return None
    bbox = _territory_bbox(t_type, t_id)
    if not bbox:
        return None
    firms_source, sat_filter = src

    key = (t_type, t_id, sensor, date)
    now = time.monotonic()
    with _FIRMS_HIST_POINTS_CACHE_LOCK:
        hit = _FIRMS_HIST_POINTS_CACHE.get(key)
        if hit and hit[0] > now:
            return hit[1]

    west, south, east, north = bbox
    bbox_str = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{firms_key}/{firms_source}/{bbox_str}/1/{date}"
    result: list[dict] | None
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url)
            resp.raise_for_status()
            text = resp.text.strip()
        if not text or text.lower().startswith("invalid"):
            result = []
        else:
            rows = _parse_firms_csv_tuples(text)
            if sat_filter:
                rows = [r for r in rows if r[6] == sat_filter]
            result = [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon_v, lat_v]},
                    "properties": {
                        "territory_type": t_type,
                        "territory_id": t_id,
                        "date": date,
                        "sensor": sensor,
                        "confidence": conf,
                        "frp_mw": frp_v,
                        "satellite": sat,
                        "daynight": daynight,
                        "low_confidence": _is_low_confidence_row(sensor, conf),
                        "source_product": "FIRMS_SP_live_query",
                        "data_origin": "firms_live_historical",
                    },
                }
                for (lat_v, lon_v, acq_d, acq_t, conf, frp_v, sat, daynight) in rows
            ]
    except Exception:
        result = None

    with _FIRMS_HIST_POINTS_CACHE_LOCK:
        if result is not None:
            if len(_FIRMS_HIST_POINTS_CACHE) >= _FIRMS_HIST_POINTS_CACHE_MAX and key not in _FIRMS_HIST_POINTS_CACHE:
                oldest_key = next(iter(_FIRMS_HIST_POINTS_CACHE))
                _FIRMS_HIST_POINTS_CACHE.pop(oldest_key, None)
            _FIRMS_HIST_POINTS_CACHE[key] = (now + _FIRMS_HIST_POINTS_CACHE_TTL_S, result)
    return result


_FIRMS_HIST_RANGE_CACHE_TTL_S = 6 * 3600.0
_FIRMS_HIST_RANGE_CACHE_MAX = 500
_FIRMS_HIST_RANGE_CACHE: dict[tuple, tuple[float, list[dict]]] = {}
_FIRMS_HIST_RANGE_CACHE_LOCK = threading.Lock()


def _fetch_firms_historical_range(
    t_type: str, t_id: str, sensor: str, from_date: str, to_date: str, max_days: int = 31
) -> list[dict]:
    """Igual que _fetch_firms_historical_day pero para un rango (la "serie diaria" del
    mes en /activity, que sin esto queda vacía para años sin tabla local: /summary ya
    complementaba el día puntual, pero /activity solo leía DAILY). Acotado a max_days
    (31, un mes) para no disparar decenas de peticiones a NASA FIRMS por un rango
    arbitrario; un rango más largo que eso simplemente no se complementa (lo sigue
    resolviendo la tabla local cuando exista, o queda vacío como antes).
    Devuelve una fila por CADA día del rango (0 focos si no hubo ninguno), igual que
    _fetch_firms_historical_day responde fire_pixels_nominal_high=0 para un día puntual
    sin detecciones — nunca omite el día, para no confundir "cero fuego" con "sin dato"."""
    firms_key = os.getenv("FIRMS_MAP_KEY", "").strip()
    since = _SENSOR_HISTORICAL_SINCE.get(sensor)
    src = _FIRMS_HIST_SOURCE_BY_SENSOR.get(sensor)
    if not firms_key or not since or not src or from_date < since:
        return []
    if (dt_date.fromisoformat(to_date) - dt_date.fromisoformat(from_date)).days + 1 > max_days:
        return []
    bbox = _territory_bbox(t_type, t_id)
    if not bbox:
        return []
    firms_source, sat_filter = src

    key = (t_type, t_id, sensor, from_date, to_date)
    now = time.monotonic()
    with _FIRMS_HIST_RANGE_CACHE_LOCK:
        hit = _FIRMS_HIST_RANGE_CACHE.get(key)
        if hit and hit[0] > now:
            return hit[1]

    west, south, east, north = bbox
    bbox_str = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
    by_date: dict[str, list] = {}
    start = dt_date.fromisoformat(from_date)
    end = dt_date.fromisoformat(to_date)
    chunk_end = end
    any_chunk_ok = False
    # Un rango de hasta 31 días se parte en bloques de <=10 días (límite de day_range
    # de la Area API). Cada bloque se intenta por separado: si UN bloque falla (red,
    # límite de la API), no debe tirar los días de los demás bloques que sí llegaron —
    # antes un solo bloque fallido dejaba el mes entero en "[]" aunque el resto hubiera
    # respondido bien.
    with httpx.Client(timeout=15.0) as client:
        while chunk_end >= start:
            # Probado en vivo: para la fuente histórica (Standard Processing) la Area
            # API de FIRMS responde vacío si day_range > 5 (a diferencia del límite de
            # 10 días documentado para las fuentes NRT) — day_range=6 ya devolvía "" en
            # vez de error, así que fallaba en silencio. No subir este tope sin volver a
            # probar contra la API real.
            span_days = min(5, (chunk_end - start).days + 1)
            chunk_start = chunk_end - timedelta(days=span_days - 1)
            url = (
                f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{firms_key}/"
                f"{firms_source}/{bbox_str}/{span_days}/{chunk_end.isoformat()}"
            )
            try:
                resp = client.get(url)
                resp.raise_for_status()
                text = resp.text.strip()
                if text and not text.lower().startswith("invalid"):
                    for r in _parse_firms_csv_tuples(text):
                        if sat_filter and r[6] != sat_filter:
                            continue
                        d = r[2] or ""
                        if from_date <= d <= to_date:
                            by_date.setdefault(d, []).append(r)
                any_chunk_ok = True
            except Exception:
                pass
            chunk_end = chunk_start - timedelta(days=1)
    if not any_chunk_ok:
        # Ningún bloque respondió (red caída, clave inválida, etc.): "sin dato", no
        # "cero detecciones" — no se puede afirmar que no hubo fuego sin haber podido
        # preguntarle a la API.
        with _FIRMS_HIST_RANGE_CACHE_LOCK:
            _FIRMS_HIST_RANGE_CACHE[key] = (now + _FIRMS_HIST_RANGE_CACHE_TTL_S, [])
        return []

    # Una fila por CADA día del rango (0 focos si no hubo ninguno), no solo los días
    # con detecciones: igual que _fetch_firms_historical_day para un día puntual
    # (que responde fire_pixels_nominal_high=0, nunca una fila ausente). Si solo se
    # devolviera fila para días con foco, un mes entero sin incendios se vería
    # idéntico a "sin dato" (data.length === 0) en el frontend, cuando en realidad
    # sí se consultó la API y la respuesta honesta es "cero detecciones ese día".
    result: list[dict] = []
    d_cursor = start
    while d_cursor <= end:
        d = d_cursor.isoformat()
        rows = by_date.get(d, [])
        fire_low = sum(1 for r in rows if _is_low_confidence_row(sensor, r[4]))
        result.append({
            "date": d,
            "territory_type": t_type,
            "territory_id": t_id,
            "sensor": sensor,
            "fire_pixels_low": fire_low,
            "fire_pixels_nominal_high": len(rows),
            "valid_land_pixels": None,
            "expected_land_pixels_per_day": None,
            "observation_coverage": None,
            "cloud_ok_lt30pct": None,
            "activity_rate": None,
            "t_amb_c": None,
            "relative_humidity_2m_pct": None,
            "t_suelo_c": None,
            "lst_valid_pixel_pct": None,
            "wind_dir_deg": None,
            "wind_speed_10m_ms": None,
            "elevation_m": None,
            "dem_source": None,
            "source_product": "FIRMS_SP_live_query",
            "processing_version": META.get("processing_version"),
            "data_origin": "firms_live_historical",
        })
        d_cursor += timedelta(days=1)
    with _FIRMS_HIST_RANGE_CACHE_LOCK:
        if len(_FIRMS_HIST_RANGE_CACHE) >= _FIRMS_HIST_RANGE_CACHE_MAX and key not in _FIRMS_HIST_RANGE_CACHE:
            oldest_key = next(iter(_FIRMS_HIST_RANGE_CACHE))
            _FIRMS_HIST_RANGE_CACHE.pop(oldest_key, None)
        _FIRMS_HIST_RANGE_CACHE[key] = (now + _FIRMS_HIST_RANGE_CACHE_TTL_S, result)
    return result


@app.get("/")
def root_probe():
    """Sonda liviana en '/' para warm-up / health checks por defecto en Azure App Service."""
    return {
        "service": "McHanaq API",
        "status": "ok",
        "health": "/api/v1/health",
    }


@app.get("/api/v1/health")
def health():
    return {
        "status": "ok",
        "data_loaded": bool(META and TERR.get("features") and DAILY and SUMMARY),
        "data_dir": str(DATA),
    }


@app.get("/api/v1/metadata")
def metadata():
    return {"schema_version": "1.0", **META}


@app.get("/api/v1/territories")
def territories(type: str = Query(...)):
    check_type(type)
    feats = [f for f in TERR.get("features", []) if f.get("properties", {}).get("territory_type") == type]
    return {"schema_version": "1.0", "type": "FeatureCollection", "features": feats}


@app.get("/api/v1/territory-metrics")
def territory_metrics(
    type: str = Query(...),
    metric: str = Query(...),
    date: str | None = Query(default=None),
    period: str | None = Query(default=None),
    sensor: str | None = Query(default=None),
):
    check_type(type)
    if metric not in ACTIVITY_METRICS and metric not in ENV_METRICS:
        raise ApiError(400, "INVALID_PARAMETER", f"metric '{metric}' no permitida")
    if metric in ACTIVITY_METRICS and not sensor:
        raise ApiError(400, "INVALID_PARAMETER", f"sensor es obligatorio para la métrica {metric}")
    if sensor:
        check_sensor(sensor)

    resolved_period = check_date(
        d=date,
        period=None if date else period,
        sensor=sensor,
        env_only=(metric in ENV_METRICS and not sensor),
    )

    items = []
    if metric == "conditions_classification":
        for row in ASSESS:
            if row.get("territory_type") == type and row.get("period_id") == resolved_period:
                items.append({
                    "territory_type": type,
                    "territory_id": row.get("territory_id"),
                    "value": row.get("classification"),
                })
    elif metric in MONTHLY_SUMMARY_METRICS or (not date and metric in ACTIVITY_METRICS):
        seen_ids: set[str] = set()
        for row in SUMMARY:
            tid = str(row.get("territory_id"))
            if row.get("territory_type") == type and row.get("period_id") == resolved_period and (not sensor or row.get("sensor") == sensor):
                if not sensor and tid in seen_ids:
                    continue
                seen_ids.add(tid)
                items.append({"territory_type": type, "territory_id": row.get("territory_id"), "value": row.get(metric)})
    elif date:
        by_tid: dict[str, dict] = {}
        for row in DAILY:
            if row.get("territory_type") == type and row.get("date") == date and (not sensor or row.get("sensor") == sensor):
                tid = str(row.get("territory_id"))
                prev = by_tid.get(tid)
                if prev is None or (prev.get(metric) is None and row.get(metric) is not None):
                    by_tid[tid] = row
        items = [
            {"territory_type": type, "territory_id": r.get("territory_id"), "value": r.get(metric)}
            for r in by_tid.values()
        ]
    else:
        items = _aggregate_env_metric_for_period(type, resolved_period, metric, sensor=sensor)

    return {
        "schema_version": "1.0",
        "date": date,
        "period": resolved_period,
        "metric": metric,
        "unit": META.get("units", {}).get(metric),
        "sensor": sensor,
        "items": items,
    }


@app.get("/api/v1/territories/{type}/{id}/summary")
def territory_summary(
    type: str,
    id: str,
    sensor: str = Query(...),
    date: str | None = Query(default=None),
    period: str | None = Query(default=None),
):
    check_type(type)
    check_sensor(sensor)
    # El resumen no exige ventana ambiental común: si faltan variables ambientales
    # la clasificación queda como not_evaluable en lugar de un 422 para toda la ficha.
    resolved_period = check_date(d=date, period=None if date else period, sensor=sensor, full=False)
    terr = find_territory(type, id)

    daily_row = _DAILY_INDEX.get((type, id, sensor, date)) if date else None
    if daily_row is None and date and _date_has_live_firms_fallback(sensor, date):
        # Sin fila en la tabla diaria local (p. ej. años antes de 2022-01-01, ver
        # AGENTS.md): se complementa con una consulta en vivo a NASA FIRMS. Nunca es
        # equivalente al dato validado offline (sin cobertura/ratio de observación), por
        # eso queda marcado con data_origin="firms_live_historical".
        daily_row = _fetch_firms_historical_day(type, id, sensor, date)
    summary_row = _SUMMARY_INDEX.get((type, id, sensor, resolved_period)) or {}
    assess_row = _ASSESS_INDEX.get((type, id, resolved_period)) or {}

    return {
        "schema_version": "1.0",
        "territory": {"type": type, "id": id, "name": terr.get("name") or terr.get("territory_name")},
        "date": date,
        "period": {"id": resolved_period},
        "sensor": sensor,
        "daily": daily_row,
        "daily_context": daily_row,
        "activity": {
            "fire_pixel_days_8_9": summary_row.get("fire_pixel_days_8_9"),
            "active_days": summary_row.get("active_days"),
            "max_consecutive_active_days": summary_row.get("max_consecutive_active_days"),
            "activity_rate": summary_row.get("activity_rate"),
            "observation_coverage": summary_row.get("observation_coverage"),
            "historical_anomaly": summary_row.get("historical_anomaly", {"value": None, "status": "insufficient_baseline", "baseline_years": 0}),
        },
        "environmental_conditions": {
            "classification": assess_row.get("classification", "not_evaluable"),
            "decision_path": assess_row.get("decision_path", []),
            "factors": assess_row.get("evidence", []),
            "evidence": assess_row.get("evidence", []),
            "modifiers": assess_row.get("modifiers", []),
            "missing_variables": assess_row.get("missing_variables", []),
        },
        "data_quality": _build_summary_data_quality(summary_row, assess_row),
        "provenance": _build_summary_provenance(type, id, sensor, resolved_period, daily_row, summary_row, assess_row),
    }


@app.get("/api/v1/territories/{type}/{id}/activity")
def territory_activity(
    type: str,
    id: str,
    sensor: str = Query(...),
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    period: str | None = Query(default=None),
):
    check_type(type)
    check_sensor(sensor)
    if from_date and to_date:
        check_date_syntax(from_date)
        check_date_syntax(to_date)
        if from_date > to_date:
            raise ApiError(400, "INVALID_PARAMETER", "from debe ser menor o igual a to")
        check_date(from_date, sensor=sensor)
        check_date(to_date, sensor=sensor)
    elif from_date or to_date:
        raise ApiError(400, "INVALID_PARAMETER", "Debe indicar ambos parámetros from y to (YYYY-MM-DD)")
    elif period:
        check_date(period=period, sensor=sensor)
    else:
        raise ApiError(400, "INVALID_PARAMETER", "Debe indicar from y to (YYYY-MM-DD) o period (YYYY-MM)")

    find_territory(type, id)
    rows = [
        r for r in DAILY
        if r.get("territory_type") == type
        and str(r.get("territory_id")) == id
        and r.get("sensor") == sensor
        and ((from_date <= r.get("date", "") <= to_date) if (from_date and to_date) else r.get("date", "").startswith(period))
    ]
    if not rows:
        # Sin filas locales (p. ej. un mes de 2012-2021): se complementa con una
        # consulta en vivo a NASA FIRMS, igual que /summary para un día puntual, pero
        # acotada a <=31 días (un mes) para no disparar decenas de peticiones por un
        # rango arbitrario (ver _fetch_firms_historical_range).
        if from_date and to_date:
            eff_from, eff_to = from_date, to_date
        else:
            eff_from = f"{period}-01"
            last_day = calendar.monthrange(int(period[:4]), int(period[5:7]))[1]
            eff_to = f"{period}-{last_day:02d}"
        rows = _fetch_firms_historical_range(type, id, sensor, eff_from, eff_to)
    rows.sort(key=lambda r: r.get("date", ""))
    return {
        "schema_version": "1.0",
        "territory": {"type": type, "id": id},
        "territory_type": type,
        "territory_id": id,
        "sensor": sensor,
        "from": from_date,
        "to": to_date,
        "period": None if (from_date and to_date) else period,
        "items": rows,
    }


@app.get("/api/v1/territories/{type}/{id}/sensor-comparison")
def sensor_comparison(
    type: str,
    id: str,
    date: str | None = Query(default=None),
    period: str | None = Query(default=None),
):
    check_type(type)
    resolved_period = check_date(d=date, period=None if date else period, comparison=True)
    find_territory(type, id)

    row = _COMPARE_INDEX.get((type, id, resolved_period))
    if not row:
        return {
            "schema_version": "1.0",
            "date": date,
            "territory_type": type,
            "territory_id": id,
            "period_id": resolved_period,
            "status": "insufficient",
            "sensors": {},
            "interpretation": "No hay datos de comparación multisensor disponibles para este territorio y período.",
            "method_version": META.get("processing_version"),
        }
    return {"schema_version": "1.0", "date": date, **row}


@app.get("/api/v1/territories/{type}/{id}/export.csv")
def export_csv(
    type: str,
    id: str,
    sensor: str = Query(...),
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
):
    check_type(type)
    check_sensor(sensor)
    check_date_syntax(from_date)
    check_date_syntax(to_date)
    if from_date > to_date:
        raise ApiError(400, "INVALID_PARAMETER", "from debe ser menor o igual a to")
    check_date(from_date, sensor=sensor)
    check_date(to_date, sensor=sensor)
    find_territory(type, id)

    rows = [
        r for r in DAILY
        if r.get("territory_type") == type
        and str(r.get("territory_id")) == id
        and r.get("sensor") == sensor
        and from_date <= r.get("date", "") <= to_date
    ]
    rows.sort(key=lambda r: r.get("date", ""))
    buf = io.StringIO()
    cols = [
        "date", "territory_type", "territory_id", "sensor",
        "fire_pixels_low", "fire_pixels_nominal_high", "valid_land_pixels",
        "expected_land_pixels_per_day", "observation_coverage", "activity_rate",
        "t_amb_c", "relative_humidity_2m_pct", "t_suelo_c", "lst_valid_pixel_pct",
        "wind_dir_deg", "wind_speed_10m_ms", "elevation_m", "dem_source",
        "source_product", "processing_version",
    ]
    writer = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    writer.writeheader()
    writer.writerows({c: ("" if r.get(c) is None else r.get(c)) for c in cols} for r in rows)
    buf.seek(0)
    filename = f"mchanaq_{type}_{id}_{sensor}_{from_date}_{to_date}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/v1/territories/{type}/{id}/calendar")
def territory_calendar(
    type: str,
    id: str,
    sensor: str = Query(...),
    from_period: str | None = Query(default=None),
    to_period: str | None = Query(default=None),
):
    check_type(type)
    check_sensor(sensor)
    if from_period is not None:
        check_period_syntax(from_period)
    if to_period is not None:
        check_period_syntax(to_period)
    if from_period and to_period and from_period > to_period:
        raise ApiError(400, "INVALID_PARAMETER", "from_period debe ser menor o igual a to_period")
    find_territory(type, id)

    rows = [
        r for r in SUMMARY
        if r.get("territory_type") == type
        and str(r.get("territory_id")) == id
        and r.get("sensor") == sensor
        and (not from_period or r.get("period_id", "") >= from_period)
        and (not to_period or r.get("period_id", "") <= to_period)
    ]
    rows.sort(key=lambda r: r.get("period_id", ""))
    items = [
        {
            "period_id": r.get("period_id"),
            "fire_pixel_days_8_9": r.get("fire_pixel_days_8_9"),
            "fire_pixel_days_7_9": r.get("fire_pixel_days_7_9"),
            "activity_rate": r.get("activity_rate"),
            "observation_coverage": r.get("observation_coverage"),
            "active_days": r.get("active_days"),
            "max_consecutive_active_days": r.get("max_consecutive_active_days"),
            "historical_anomaly": r.get(
                "historical_anomaly",
                {"value": None, "status": "insufficient_baseline", "baseline_years": 0},
            ),
            "source_product": r.get("source_product"),
            "processing_version": r.get("processing_version"),
        }
        for r in rows
    ]
    return {
        "schema_version": "1.0",
        "territory": {"type": type, "id": id},
        "sensor": sensor,
        "from_period": from_period,
        "to_period": to_period,
        "items": items,
    }


@app.get("/api/v1/territories/{type}/{id}/hotspots")
def territory_hotspots(type: str, id: str, date: str = Query(...), sensor: str = Query(...)):
    check_type(type)
    check_sensor(sensor)
    check_date(date, sensor=sensor)
    find_territory(type, id)
    feats: list[dict] = []
    if HOTSPOTS:
        feats = [
            f for f in HOTSPOTS.get("features", [])
            if f.get("properties", {}).get("territory_type") == type
            and str(f.get("properties", {}).get("territory_id")) == id
            and f.get("properties", {}).get("date") == date
            and f.get("properties", {}).get("sensor") == sensor
        ]
    if not feats:
        # No hay hotspots.geojson precalculado en este despliegue (no existe el archivo):
        # se complementa con las coordenadas reales de NASA FIRMS para ese día/sensor,
        # igual que /summary y /activity. Si la consulta en vivo falla, se devuelve una
        # lista vacía (sin puntos) — nunca una muestra inventada.
        live_feats = _fetch_firms_historical_points(type, id, sensor, date)
        if live_feats is not None:
            feats = live_feats
    return {"schema_version": "1.0", "type": "FeatureCollection", "features": feats}


# ---------------------------------------------------------------------------
# Fase 2 (Opcional y desacoplada) — Simulación espacial de propagación (48 h)
# ---------------------------------------------------------------------------

SPREAD_FORECASTS = load_json("spread_forecasts.json") or {"items": []}
SPREAD_OUTPUTS_DIR = (DATA / "spread_outputs") if (DATA / "spread_outputs").exists() else (ROOT / "data" / "processed" / "spread_outputs")
_SPREAD_MIME_TYPES = {
    "simulacion_48h.gif": "image/gif",
    "pronostico_48h.mp4": "video/mp4",
    "mchanaq_propagacion_48h_qgis.zip": "application/zip",
    "infografia_impacto_48h.png": "image/png",
    "panel_modelo_48h.png": "image/png",
}


def _territory_centroid_and_geom(terr: dict):
    from shapely.geometry import shape

    geom = shape(terr["geometry"]) if terr.get("geometry") else None
    if geom is not None and not geom.is_empty:
        pt = geom.representative_point()
        return float(pt.y), float(pt.x), geom
    return -8.19833, -75.26669, None


def _fetch_open_meteo_dem_slope_py(lat: float, lon: float) -> tuple[float | None, float | None, str]:
    """Calcula pendiente media/máxima con Open-Meteo Elevation (Copernicus GLO-90) usando solo httpx."""
    half = 0.032
    pts = [
        (round(lat - half + (2 * half * r / 3.0), 5), round(lon - half + (2 * half * c / 3.0), 5))
        for r in range(4)
        for c in range(4)
    ]
    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(
                "https://api.open-meteo.com/v1/elevation",
                params={
                    "latitude": ",".join(str(p[0]) for p in pts),
                    "longitude": ",".join(str(p[1]) for p in pts),
                },
            )
            resp.raise_for_status()
            elev = resp.json().get("elevation") or []
        if len(elev) < 16:
            return None, None, "COPERNICUS_DEM_GLO30_PARAMETRIC"
        grid = [[float(elev[r * 4 + c]) for c in range(4)] for r in range(4)]
        dx = (2 * half / 3.0) * 111_320.0 * max(0.2, math.cos(math.radians(lat)))
        dy = (2 * half / 3.0) * 110_540.0
        slopes: list[float] = []
        for r in range(3):
            for c in range(3):
                dz_x = (grid[r][c + 1] - grid[r][c]) / max(dx, 1.0)
                dz_y = (grid[r + 1][c] - grid[r][c]) / max(dy, 1.0)
                slopes.append(math.degrees(math.atan(math.hypot(dz_x, dz_y))))
        mean_deg = round(sum(slopes) / len(slopes), 2)
        max_deg = round(max(slopes), 2)
        return mean_deg, max_deg, "COPERNICUS_DEM_GLO90_OPEN_METEO"
    except Exception:
        return None, None, "COPERNICUS_DEM_GLO30_PARAMETRIC"


def _run_lightweight_global_spread(
    *,
    t_type: str,
    t_id: str,
    t_name: str,
    lat: float,
    lon: float,
    date_str: str,
    horizon_h: int,
    ws: float,
    wd: float,
    veg: float,
    slp: float,
    fm: float,
    use_open_meteo: bool,
    live_wind: bool = True,
) -> dict:
    """Fallback sin geopandas/numpy: obtiene Copernicus GLO-90 DEM + viento Open-Meteo reales vía httpx."""
    if _realtime_enabled():
        slope_mean, slope_max, dem_source = _fetch_open_meteo_dem_slope_py(lat, lon)
    else:
        slope_mean, slope_max, dem_source = None, None, "COPERNICUS_DEM_GLO30_PARAMETRIC"
    eff_slope = slope_mean if slope_mean is not None else round(float(slp), 2)
    eff_max_slope = slope_max if slope_max is not None else round(eff_slope * 1.8, 2)

    wind_source = "era5_daily_diurnal_profile"
    eff_ws, eff_wd = float(ws), float(wd)
    if use_open_meteo and live_wind and _realtime_enabled():
        live = _fetch_open_meteo_wind_for_date(lat, lon, date_str)
        if live.get("status") == "ok":
            wind_source = str(live.get("source") or "Open-Meteo")
            if isinstance(live.get("wind_speed_10m_ms"), (int, float)):
                eff_ws = float(live["wind_speed_10m_ms"])
            if isinstance(live.get("wind_dir_deg"), (int, float)):
                eff_wd = float(live["wind_dir_deg"])

    moisture_factor = max(0.0, 1.0 - min(1.0, fm / 30.0)) ** 2
    slope_factor = min(8.0, math.exp(0.0693 * max(0.0, eff_slope)))
    head_ros = round(1.8 * (1.0 + 0.72 * (max(0.0, eff_ws) ** 1.22)) * moisture_factor * (0.4 + 0.6 * (veg / 100.0)) * slope_factor, 2)
    lb = round(min(8.0, max(1.0, 0.936 * math.exp(0.2566 * eff_ws) + 0.461 * math.exp(-0.1548 * eff_ws) - 0.397)), 2)

    return {
        "schema_version": "1.0",
        "phase": "phase_2_optional",
        "territory": {"type": t_type, "id": t_id, "name": t_name},
        "date": date_str,
        "horizon_h": horizon_h,
        "ignition": {"lat": lat, "lon": lon},
        "dominant_wind": {"wind_dir_deg": round(eff_wd, 1), "wind_speed_10m_ms": round(eff_ws, 2)},
        "savi_summary": {"mean": round(0.12 + 0.66 * (veg / 100.0), 3), "source": "vegetation_area_pct"},
        "slope_summary": {"mean_deg": eff_slope, "max_deg": eff_max_slope, "dem_source": dem_source},
        "spread_summary": {"head_ros_m_min": head_ros, "length_to_breadth": lb},
        "data_sources": {
            "wind_source": wind_source,
            "dem_source": dem_source,
            "vegetation_index": "vegetation_area_pct",
        },
        "timings_s": {"simulation_s": 0.05, "total_s": 0.05},
    }


def _run_phase2_simulation(
    t_type: str,
    t_id: str,
    t_name: str,
    geom,
    lat: float,
    lon: float,
    date_str: str,
    horizon_h: int,
    wind_speed_ms: float | None = None,
    wind_dir_deg: float | None = None,
    vegetation_pct: float | None = None,
    slope_mean_deg: float | None = None,
    fuel_moisture_pct: float | None = None,
    use_open_meteo: bool = False,
    export_products: bool = False,
    live_wind: bool = True,
) -> dict:
    daily_match = next(
        (
            r for r in DAILY
            if r.get("territory_type") == t_type
            and str(r.get("territory_id")) == t_id
            and r.get("date") == date_str
        ),
        None,
    )
    assess_match = next(
        (
            r for r in ASSESS
            if r.get("territory_type") == t_type
            and str(r.get("territory_id")) == t_id
            and r.get("period_id") == date_str[:7]
        ),
        None,
    )

    def _ev_num(var_name: str) -> float | None:
        if not assess_match:
            return None
        for ev in assess_match.get("evidence") or []:
            if ev.get("variable") == var_name and isinstance(ev.get("value"), (int, float)):
                return float(ev["value"])
        return None

    ws = wind_speed_ms if wind_speed_ms is not None else (
        float(daily_match["wind_speed_10m_ms"])
        if daily_match and daily_match.get("wind_speed_10m_ms") is not None
        else (_ev_num("wind_speed_10m_ms") or 4.6)
    )
    wd = wind_dir_deg if wind_dir_deg is not None else (
        float(daily_match["wind_dir_deg"])
        if daily_match and daily_match.get("wind_dir_deg") is not None
        else 118.0
    )
    veg = vegetation_pct if vegetation_pct is not None else (_ev_num("vegetation_area_pct") or 82.0)
    slope_pct = _ev_num("slope_class_area_pct")
    slp = slope_mean_deg if slope_mean_deg is not None else (
        round(math.degrees(math.atan(slope_pct / 100.0)), 1) if slope_pct is not None else 6.5
    )
    precip = _ev_num("precip_30d_mm")
    fm = fuel_moisture_pct if fuel_moisture_pct is not None else (
        # Tope 18 %: igual que el frontend (MapTool). Con 28 % (casi el contenido de
        # extinción de 30 %) el factor de humedad de Rothermel queda en ~0.004 y el frente
        # no sale de la celda de ignición (área constante en 24/36/48 h).
        max(4.0, min(18.0, round(4.0 + precip * 0.18, 1))) if precip is not None else 9.0
    )

    t0 = time.perf_counter()
    try:
        from src.analytics.spread_model import (
            build_spread_forecast_payload,
            export_all_phase2_products,
            simulate_spread_48h,
        )
    except ImportError as exc:
        if export_products:
            raise ApiError(
                503,
                "EXPORT_LIBS_UNAVAILABLE",
                f"Generación GIS/video requiere geopandas/matplotlib en este entorno ({exc}). Las descargas precalculadas siguen activas.",
            )
        return _run_lightweight_global_spread(
            t_type=t_type,
            t_id=t_id,
            t_name=t_name,
            lat=lat,
            lon=lon,
            date_str=date_str,
            horizon_h=horizon_h,
            ws=ws,
            wd=wd,
            veg=veg,
            slp=slp,
            fm=fm,
            use_open_meteo=use_open_meteo,
            live_wind=live_wind,
        )

    res = simulate_spread_48h(
        territory_type=t_type,
        territory_id=t_id,
        territory_name=t_name,
        territory_geom=geom,
        date_str=date_str,
        ignition_lat=lat,
        ignition_lon=lon,
        horizon_h=horizon_h,
        vegetation_pct=veg,
        slope_mean_deg=slp,
        fuel_moisture_pct=fm,
        base_wind_ms=ws,
        base_wind_dir_deg=wd,
        use_open_meteo=use_open_meteo,
        use_open_meteo_wind=use_open_meteo and live_wind,
    )
    sim_s = round(time.perf_counter() - t0, 3)
    timings: dict[str, float] = {"simulation_s": sim_s, "total_s": sim_s}
    if export_products:
        exported = export_all_phase2_products(res, SPREAD_OUTPUTS_DIR)
        timings.update(exported["timings_s"])
        timings["total_s"] = round(sim_s + exported["timings_s"]["total_export_s"], 3)
    return build_spread_forecast_payload(res, timings_s=timings)


def _realtime_enabled() -> bool:
    """Excepción explícita de Fase 2 opcional: habilita /realtime/area, /reverse-geocode
    y spread-simulate?use_open_meteo=true por defecto; configurar MCHANAQ_ENABLE_REALTIME=0
    para modo estrictamente offline sin consultas HTTP externas."""
    return os.getenv("MCHANAQ_ENABLE_REALTIME", "1").strip().lower() not in {"0", "false", "no", "off"}


def _dispatch_spread_request(
    *,
    lat: float | None,
    lon: float | None,
    date: str,
    horizon_h: int,
    wind_speed_10m_ms: float | None,
    wind_dir_deg: float | None,
    vegetation_pct: float | None,
    slope_mean_deg: float | None,
    fuel_moisture_pct: float | None,
    use_open_meteo: bool,
    payload: dict | None,
    export_products: bool,
) -> dict:
    body = payload or {}
    r_lat = float(body["lat"]) if "lat" in body else lat
    r_lon = float(body["lon"]) if "lon" in body else lon
    if r_lat is None or r_lon is None:
        raise ApiError(400, "INVALID_PARAMETER", "Debe indicar lat y lon para simular propagación")
    if not (-90.0 <= r_lat <= 90.0 and -180.0 <= r_lon <= 180.0):
        raise ApiError(400, "INVALID_PARAMETER", "Coordenadas fuera de rango global")

    r_date = str(body.get("date") or date)
    check_date_syntax(r_date)
    r_horizon = int(body.get("horizon_h") or horizon_h)
    if not (6 <= r_horizon <= 48):
        raise ApiError(400, "INVALID_PARAMETER", "horizon_h debe estar entre 6 y 48 horas")

    r_open_meteo = bool(body["use_open_meteo"]) if "use_open_meteo" in body else use_open_meteo
    if r_open_meteo and not _realtime_enabled():
        # Antes: 403 REALTIME_DISABLED, lo que rompía la exportación bajo demanda
        # (el cliente siempre pide Open-Meteo). Ahora se degrada a los
        # parámetros locales enviados (viento, humedad, etc.) sin consultar
        # servicios externos, respetando AGENTS.md.
        r_open_meteo = False
    return _run_phase2_simulation(
        t_type=str(body.get("territory_type") or "custom"),
        t_id=str(body.get("territory_id") or "custom"),
        t_name=str(body.get("territory_name") or f"Punto ({r_lat:.3f}, {r_lon:.3f})"),
        geom=None,
        lat=r_lat,
        lon=r_lon,
        date_str=r_date,
        horizon_h=r_horizon,
        wind_speed_ms=float(body["wind_speed_10m_ms"]) if "wind_speed_10m_ms" in body else wind_speed_10m_ms,
        wind_dir_deg=float(body["wind_dir_deg"]) if "wind_dir_deg" in body else wind_dir_deg,
        vegetation_pct=float(body["vegetation_pct"]) if "vegetation_pct" in body else vegetation_pct,
        slope_mean_deg=float(body["slope_mean_deg"]) if "slope_mean_deg" in body else slope_mean_deg,
        fuel_moisture_pct=float(body["fuel_moisture_pct"]) if "fuel_moisture_pct" in body else fuel_moisture_pct,
        use_open_meteo=r_open_meteo,
        export_products=export_products,
        live_wind=bool(body["live_wind"]) if "live_wind" in body else True,
    )


@app.get("/api/v1/territories/{type}/{id}/spread-forecast")
def territory_spread_forecast(
    type: str,
    id: str,
    date: str | None = Query(default=None),
    horizon_h: int = Query(default=48, ge=6, le=48),
):
    check_type(type)
    terr = find_territory(type, id)
    if date is not None:
        check_date_syntax(date)

    for item in SPREAD_FORECASTS.get("items", []):
        t_info = item.get("territory") or {}
        if (
            t_info.get("type") == type
            and str(t_info.get("id")) == id
            and (date is None or item.get("date") == date)
            and int(item.get("horizon_h") or 48) == horizon_h
        ):
            return item

    lat, lon, geom = _territory_centroid_and_geom(terr)
    t_name = str(terr.get("name") or terr.get("territory_name") or id)
    resolved_date = date or (
        SPREAD_FORECASTS.get("items", [{}])[0].get("date")
        if SPREAD_FORECASTS.get("items")
        else "2024-09-25"
    )
    return _run_phase2_simulation(
        t_type=type,
        t_id=id,
        t_name=t_name,
        geom=geom,
        lat=lat,
        lon=lon,
        date_str=resolved_date,
        horizon_h=horizon_h,
    )


@app.post("/api/v1/spread-simulate")
@app.get("/api/v1/spread-simulate")
def spread_simulate(
    lat: float | None = Query(default=None, ge=-90.0, le=90.0),
    lon: float | None = Query(default=None, ge=-180.0, le=180.0),
    date: str = Query(default="2024-09-25"),
    horizon_h: int = Query(default=48, ge=6, le=48),
    wind_speed_10m_ms: float | None = Query(default=None, ge=0.0, le=40.0),
    wind_dir_deg: float | None = Query(default=None, ge=0.0, le=360.0),
    vegetation_pct: float | None = Query(default=None, ge=0.0, le=100.0),
    slope_mean_deg: float | None = Query(default=None, ge=0.0, le=60.0),
    fuel_moisture_pct: float | None = Query(default=None, ge=1.0, le=35.0),
    use_open_meteo: bool = Query(default=False),
    payload: dict | None = Body(default=None),
):
    return _dispatch_spread_request(
        lat=lat,
        lon=lon,
        date=date,
        horizon_h=horizon_h,
        wind_speed_10m_ms=wind_speed_10m_ms,
        wind_dir_deg=wind_dir_deg,
        vegetation_pct=vegetation_pct,
        slope_mean_deg=slope_mean_deg,
        fuel_moisture_pct=fuel_moisture_pct,
        use_open_meteo=use_open_meteo,
        payload=payload,
        export_products=False,
    )


@app.post("/api/v1/spread-export")
@app.get("/api/v1/spread-export")
def spread_export(
    lat: float | None = Query(default=None, ge=-90.0, le=90.0),
    lon: float | None = Query(default=None, ge=-180.0, le=180.0),
    date: str = Query(default="2024-09-25"),
    horizon_h: int = Query(default=48, ge=6, le=48),
    wind_speed_10m_ms: float | None = Query(default=None, ge=0.0, le=40.0),
    wind_dir_deg: float | None = Query(default=None, ge=0.0, le=360.0),
    vegetation_pct: float | None = Query(default=None, ge=0.0, le=100.0),
    slope_mean_deg: float | None = Query(default=None, ge=0.0, le=60.0),
    fuel_moisture_pct: float | None = Query(default=None, ge=1.0, le=35.0),
    use_open_meteo: bool = Query(default=False),
    payload: dict | None = Body(default=None),
):
    return _dispatch_spread_request(
        lat=lat,
        lon=lon,
        date=date,
        horizon_h=horizon_h,
        wind_speed_10m_ms=wind_speed_10m_ms,
        wind_dir_deg=wind_dir_deg,
        vegetation_pct=vegetation_pct,
        slope_mean_deg=slope_mean_deg,
        fuel_moisture_pct=fuel_moisture_pct,
        use_open_meteo=use_open_meteo,
        payload=payload,
        export_products=True,
    )


@app.get("/api/v1/spread-outputs/{filename}")
def spread_output_file(filename: str):
    if filename not in _SPREAD_MIME_TYPES:
        raise ApiError(404, "NOT_FOUND", f"Archivo de salida de Fase 2 no encontrado: {filename}")
    target = SPREAD_OUTPUTS_DIR / filename
    if not target.exists():
        raise ApiError(404, "NOT_FOUND", f"El archivo {filename} aún no fue generado en el servidor")
    return FileResponse(
        path=target,
        media_type=_SPREAD_MIME_TYPES[filename],
        filename=filename,
    )


# ---------------------------------------------------------------------------
# Tiempo real global — Open-Meteo (clima/viento) + NASA FIRMS (MODIS & VIIRS)
# ---------------------------------------------------------------------------

_FIRMS_SOURCES = (
    ("MODIS_NRT", "MODIS"),
    ("VIIRS_SNPP_NRT", "VIIRS_SNPP"),
    ("VIIRS_NOAA20_NRT", "VIIRS_NOAA20"),
)

# Feeds públicos regionales/globales de NASA FIRMS NRT (no requieren FIRMS_MAP_KEY).
_FIRMS_PUBLIC_FEED_TEMPLATES = (
    ("MODIS", "MODIS_NRT_PUBLIC", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_{region}_{win}.csv"),
    ("VIIRS_SNPP", "VIIRS_SNPP_NRT_PUBLIC", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_{region}_{win}.csv"),
    ("VIIRS_NOAA20", "VIIRS_NOAA20_NRT_PUBLIC", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_{region}_{win}.csv"),
)
_FIRMS_PUBLIC_CACHE_TTL_S = 600.0
_FIRMS_PUBLIC_CACHE_MAX = 6
_FIRMS_PUBLIC_CACHE: dict[str, tuple[float, list[tuple[float, float, str | None, str | None, str | None, float | None, str | None, str | None]]]] = {}
_FIRMS_PUBLIC_CACHE_LOCK = threading.Lock()
_FIRMS_MAX_RETURNED_FEATURES = 2500

# Caché TTL para la Area API autenticada (FIRMS_MAP_KEY): sin esto, cada consulta de
# /realtime/area vuelve a pedir el bbox completo a FIRMS aunque nadie haya movido el mapa
# (medido en producción: ~6-9 s en frío). Se cachea por (fuente, bbox redondeado, days).
_FIRMS_AREA_API_CACHE_TTL_S = 600.0
_FIRMS_AREA_API_CACHE_MAX = 32
_FIRMS_AREA_API_CACHE: dict[tuple, tuple[float, list[dict], str | None]] = {}
_FIRMS_AREA_API_CACHE_LOCK = threading.Lock()


def _fetch_open_meteo_current(lat: float, lon: float) -> dict:
    """Consulta clima y viento actual en Open-Meteo para el centro del área."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m",
        "wind_speed_unit": "ms",
    }
    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(url, params=params)
            resp.raise_for_status()
            payload = resp.json()
        cur = payload.get("current") or {}
        return {
            "status": "ok",
            "source": "Open-Meteo",
            "observed_at": cur.get("time"),
            "center": {"lat": round(lat, 4), "lon": round(lon, 4)},
            "t_amb_c": cur.get("temperature_2m"),
            "relative_humidity_2m_pct": cur.get("relative_humidity_2m"),
            "wind_speed_10m_ms": cur.get("wind_speed_10m"),
            "wind_dir_deg": cur.get("wind_direction_10m"),
        }
    except Exception as exc:
        return {
            "status": "unavailable",
            "source": "Open-Meteo",
            "detail": str(exc),
        }


def _fetch_open_meteo_wind_for_date(lat: float, lon: float, date_str: str) -> dict:
    """Obtiene viento de Open-Meteo Forecast (fechas recientes) o Archive (fechas históricas)."""
    try:
        target_d = datetime.strptime(date_str[:10], "%Y-%m-%d").date()
    except ValueError:
        return _fetch_open_meteo_current(lat, lon)

    today = datetime.now(timezone.utc).date()
    if target_d >= today - timedelta(days=2):
        return _fetch_open_meteo_current(lat, lon)

    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(
                "https://archive-api.open-meteo.com/v1/archive",
                params={
                    "latitude": f"{lat:.4f}",
                    "longitude": f"{lon:.4f}",
                    "start_date": target_d.strftime("%Y-%m-%d"),
                    "end_date": target_d.strftime("%Y-%m-%d"),
                    "hourly": "wind_speed_10m,wind_direction_10m",
                    "wind_speed_unit": "ms",
                    "timezone": "UTC",
                },
            )
            resp.raise_for_status()
            hourly = resp.json().get("hourly") or {}
        ws_vals = [float(v) for v in (hourly.get("wind_speed_10m") or []) if v is not None]
        wd_vals = [float(v) for v in (hourly.get("wind_direction_10m") or []) if v is not None]
        if not ws_vals or not wd_vals:
            return _fetch_open_meteo_current(lat, lon)
        sin_m = sum(math.sin(math.radians(d)) for d in wd_vals) / len(wd_vals)
        cos_m = sum(math.cos(math.radians(d)) for d in wd_vals) / len(wd_vals)
        wd_mean = (math.degrees(math.atan2(sin_m, cos_m)) + 360.0) % 360.0
        return {
            "status": "ok",
            "source": "Open-Meteo Archive",
            "wind_speed_10m_ms": round(sum(ws_vals) / len(ws_vals), 2),
            "wind_dir_deg": round(wd_mean, 1),
        }
    except Exception:
        return _fetch_open_meteo_current(lat, lon)


def _firms_row_to_feature(
    *,
    lat_v: float,
    lon_v: float,
    acq_date: str | None,
    acq_time: str | None,
    confidence: str | None,
    frp_val: float | None,
    satellite: str | None,
    daynight: str | None,
    sensor_label: str,
    firms_source: str,
) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon_v, lat_v]},
        "properties": {
            "sensor": sensor_label,
            "firms_source": firms_source,
            "acq_date": acq_date,
            "acq_time": acq_time,
            "confidence": confidence,
            "frp_mw": frp_val,
            "satellite": satellite,
            "daynight": daynight,
        },
    }


def _parse_firms_csv_tuples(
    text: str,
) -> list[tuple[float, float, str | None, str | None, str | None, float | None, str | None, str | None]]:
    """Convierte filas CSV de FIRMS en tuplas compactas descartando coordenadas inválidas."""
    rows: list[tuple[float, float, str | None, str | None, str | None, float | None, str | None, str | None]] = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            lat_v = float(row["latitude"])
            lon_v = float(row["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        frp_raw = row.get("frp")
        try:
            frp_val = float(frp_raw) if frp_raw not in (None, "") else None
        except ValueError:
            frp_val = None
        rows.append((
            lat_v,
            lon_v,
            row.get("acq_date"),
            row.get("acq_time"),
            row.get("confidence"),
            frp_val,
            row.get("satellite"),
            row.get("daynight"),
        ))
    return rows


def _select_firms_public_region(south: float, west: float, north: float, east: float) -> str:
    if south >= -60.0 and north <= 16.0 and west >= -85.0 and east <= -32.0:
        return "South_America"
    if south >= 18.0 and north <= 52.0 and west >= -130.0 and east <= -65.0:
        return "USA_contiguous_and_Hawaii"
    if south >= 34.0 and north <= 72.0 and west >= -12.0 and east <= 45.0:
        return "Europe"
    return "Global"


def _fetch_firms_source(
    client: httpx.Client,
    map_key: str,
    firms_source: str,
    sensor_label: str,
    west: float,
    south: float,
    east: float,
    north: float,
    days: int,
) -> tuple[list[dict], str | None]:
    """Consulta focos activos NRT en NASA FIRMS Area API sin mezclar sensores."""
    bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{map_key}/{firms_source}/{bbox}/{days}"
    try:
        resp = client.get(url)
        resp.raise_for_status()
        text = resp.text.strip()
        if not text or text.lower().startswith("invalid"):
            return [], text or "empty_response"
        features = [
            _firms_row_to_feature(
                lat_v=lat_v,
                lon_v=lon_v,
                acq_date=acq_d,
                acq_time=acq_t,
                confidence=conf,
                frp_val=frp_v,
                satellite=sat,
                daynight=dn,
                sensor_label=sensor_label,
                firms_source=firms_source,
            )
            for lat_v, lon_v, acq_d, acq_t, conf, frp_v, sat, dn in _parse_firms_csv_tuples(text)
        ]
        return features, None
    except Exception as exc:
        return [], str(exc)


def _fetch_firms_source_cached(
    client: httpx.Client,
    map_key: str,
    firms_source: str,
    sensor_label: str,
    west: float,
    south: float,
    east: float,
    north: float,
    days: int,
) -> tuple[list[dict], str | None]:
    """Igual que _fetch_firms_source pero con caché TTL por bbox: sin esto, cada carga de
    /realtime/area volvía a pedirle a FIRMS el área completa aunque nadie moviera el mapa
    (~6-9 s medidos en producción incluso con FIRMS_MAP_KEY configurada)."""
    key = (firms_source, round(west, 2), round(south, 2), round(east, 2), round(north, 2), days)
    now = time.monotonic()
    with _FIRMS_AREA_API_CACHE_LOCK:
        hit = _FIRMS_AREA_API_CACHE.get(key)
        if hit and hit[0] > now:
            return hit[1], hit[2]
    features, err = _fetch_firms_source(
        client=client,
        map_key=map_key,
        firms_source=firms_source,
        sensor_label=sensor_label,
        west=west,
        south=south,
        east=east,
        north=north,
        days=days,
    )
    # Solo cachear resultados utilizables: un error transitorio (clave inválida momentánea,
    # timeout) no debe quedar pegado por 10 minutos.
    if err is None:
        with _FIRMS_AREA_API_CACHE_LOCK:
            if len(_FIRMS_AREA_API_CACHE) >= _FIRMS_AREA_API_CACHE_MAX and key not in _FIRMS_AREA_API_CACHE:
                oldest_key = next(iter(_FIRMS_AREA_API_CACHE))
                _FIRMS_AREA_API_CACHE.pop(oldest_key, None)
            _FIRMS_AREA_API_CACHE[key] = (now + _FIRMS_AREA_API_CACHE_TTL_S, features, err)
    return features, err


def _fetch_firms_public_source(
    url: str,
    firms_source: str,
    sensor_label: str,
    west: float,
    south: float,
    east: float,
    north: float,
) -> tuple[list[dict], str | None]:
    """Consulta el feed CSV público oficial de NASA FIRMS NRT (sin MAP_KEY) con caché TTL en memoria."""
    now = time.monotonic()
    cached_rows = None
    with _FIRMS_PUBLIC_CACHE_LOCK:
        hit = _FIRMS_PUBLIC_CACHE.get(url)
        if hit and hit[0] > now:
            cached_rows = hit[1]

    if cached_rows is None:
        try:
            with httpx.Client(timeout=10.0, follow_redirects=True) as client:
                resp = client.get(url)
                resp.raise_for_status()
                text = resp.text.strip()
            if not text or not text.lower().startswith("latitude"):
                return [], "invalid_public_csv"
            cached_rows = _parse_firms_csv_tuples(text)
            with _FIRMS_PUBLIC_CACHE_LOCK:
                if len(_FIRMS_PUBLIC_CACHE) >= _FIRMS_PUBLIC_CACHE_MAX and url not in _FIRMS_PUBLIC_CACHE:
                    oldest_key = next(iter(_FIRMS_PUBLIC_CACHE))
                    _FIRMS_PUBLIC_CACHE.pop(oldest_key, None)
                _FIRMS_PUBLIC_CACHE[url] = (time.monotonic() + _FIRMS_PUBLIC_CACHE_TTL_S, cached_rows)
        except Exception as exc:
            return [], str(exc)

    features = [
        _firms_row_to_feature(
            lat_v=lat_v,
            lon_v=lon_v,
            acq_date=acq_d,
            acq_time=acq_t,
            confidence=conf,
            frp_val=frp_v,
            satellite=sat,
            daynight=dn,
            sensor_label=sensor_label,
            firms_source=firms_source,
        )
        for lat_v, lon_v, acq_d, acq_t, conf, frp_v, sat, dn in cached_rows
        if south <= lat_v <= north and west <= lon_v <= east
    ]
    return features, None


_REVERSE_GEOCODE_CACHE: dict[tuple[float, float], dict] = {}
_COUNTRY_SHORT_ALIASES = {
    "Estados Unidos de América": "Estados Unidos",
    "United States of America": "Estados Unidos",
    "United Kingdom": "Reino Unido",
    "Reino Unido de Gran Bretaña e Irlanda del Norte": "Reino Unido",
}


def _dedupe_place_parts(parts: list[str | None]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in parts:
        val = (raw or "").strip()
        if not val:
            continue
        key = val.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(val)
    return out


def _reverse_geocode_coords(lat: float, lon: float) -> dict:
    """Detecta país, región/estado, provincia/condado y ciudad/distrito vía OSM Nominatim."""
    cache_key = (round(lat, 3), round(lon, 3))
    cached = _REVERSE_GEOCODE_CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    url = "https://nominatim.openstreetmap.org/reverse"
    params = {
        "format": "jsonv2",
        "lat": f"{lat:.5f}",
        "lon": f"{lon:.5f}",
        "zoom": "14",
        "addressdetails": "1",
        "accept-language": "es",
    }
    headers = {"User-Agent": "Pruebas_McLovin/1.0 (+https://github.com/Ancas-Red/Pruebas_McLovin)"}
    try:
        with httpx.Client(timeout=4.5, headers=headers) as client:
            resp = client.get(url, params=params)
            resp.raise_for_status()
            payload = resp.json()
        addr = payload.get("address") or {}
        if not isinstance(addr, dict) or not addr:
            return {
                "status": "unavailable",
                "source": "OSM_NOMINATIM",
                "country": None,
                "country_code": None,
                "region": None,
                "province": None,
                "city": None,
                "district": None,
                "hierarchy": [],
                "header_primary": None,
                "header_sub": None,
                "display_name": payload.get("display_name"),
            }

        raw_country = (addr.get("country") or "").strip() or None
        country = _COUNTRY_SHORT_ALIASES.get(raw_country or "", raw_country)
        country_code = (addr.get("country_code") or "").upper() or None

        region = (
            addr.get("state")
            or addr.get("region")
            or addr.get("archipelago")
            or addr.get("island")
            or None
        )
        # En Perú y otros países Nominatim coloca la provincia en `region` cuando `state` existe.
        province = addr.get("province") or addr.get("county") or addr.get("state_district")
        if not province and addr.get("state") and addr.get("region") and addr.get("region") != addr.get("state"):
            province = addr.get("region")
        if province and region and province.strip().casefold() == region.strip().casefold():
            province = None

        city = (
            addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("municipality")
            or None
        )
        district = (
            addr.get("city_district")
            or addr.get("suburb")
            or addr.get("borough")
            or addr.get("quarter")
            or addr.get("neighbourhood")
            or addr.get("hamlet")
            or addr.get("locality")
            or None
        )
        if district and city and district.strip().casefold() == city.strip().casefold():
            district = None

        hierarchy = _dedupe_place_parts([country, region, province, city, district])
        sub_parts = _dedupe_place_parts([city, district, province, region])
        # Limita la cabecera superior a máx. 2-3 niveles clave sin redundancia.
        header_sub = " · ".join(sub_parts[:2]) if sub_parts else None
        result = {
            "status": "ok",
            "source": "OSM_NOMINATIM",
            "country": country,
            "country_code": country_code,
            "region": region.strip() if isinstance(region, str) and region.strip() else None,
            "province": province.strip() if isinstance(province, str) and province.strip() else None,
            "city": city.strip() if isinstance(city, str) and city.strip() else None,
            "district": district.strip() if isinstance(district, str) and district.strip() else None,
            "hierarchy": hierarchy,
            "header_primary": country or (sub_parts[0] if sub_parts else None),
            "header_sub": header_sub,
            "display_name": " · ".join(hierarchy) if hierarchy else payload.get("display_name"),
        }
        if len(_REVERSE_GEOCODE_CACHE) >= 512:
            _REVERSE_GEOCODE_CACHE.clear()
        _REVERSE_GEOCODE_CACHE[cache_key] = result
        return dict(result)
    except Exception as exc:
        return {
            "status": "unavailable",
            "source": "OSM_NOMINATIM",
            "country": None,
            "country_code": None,
            "region": None,
            "province": None,
            "city": None,
            "district": None,
            "hierarchy": [],
            "header_primary": None,
            "header_sub": None,
            "display_name": None,
            "detail": str(exc),
        }


@app.get("/api/v1/reverse-geocode")
def reverse_geocode(
    lat: float = Query(..., ge=-90.0, le=90.0),
    lon: float = Query(..., ge=-180.0, le=180.0),
):
    """Resuelve país, región/estado, provincia/condado y ciudad/distrito para cualquier punto del planeta."""
    if not _realtime_enabled():
        return {
            "schema_version": "1.0",
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "status": "realtime_disabled",
            "realtime_setup": {
                "env_var": "MCHANAQ_ENABLE_REALTIME",
                "note": "Configura MCHANAQ_ENABLE_REALTIME=1 en el servidor para habilitar la geocodificación en tiempo real (OSM Nominatim).",
            },
        }
    return {
        "schema_version": "1.0",
        "lat": round(lat, 5),
        "lon": round(lon, 5),
        **_reverse_geocode_coords(lat, lon),
    }


def _collect_firms_public_area(
    region: str,
    win: str,
    west: float,
    south: float,
    east: float,
    north: float,
) -> tuple[list[dict], dict[str, int], dict[str, str]]:
    """Consulta en paralelo los feeds públicos MODIS/VIIRS de NASA FIRMS para un bbox."""
    all_features: list[dict] = []
    counts_by_sensor: dict[str, int] = {}
    errors_by_sensor: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=len(_FIRMS_PUBLIC_FEED_TEMPLATES)) as pool:
        futs = [
            (
                sensor_label,
                pool.submit(
                    _fetch_firms_public_source,
                    tmpl.format(region=region, win=win),
                    firms_source,
                    sensor_label,
                    west,
                    south,
                    east,
                    north,
                ),
            )
            for sensor_label, firms_source, tmpl in _FIRMS_PUBLIC_FEED_TEMPLATES
        ]
        for sensor_label, fut in futs:
            feats, err = fut.result()
            counts_by_sensor[sensor_label] = len(feats)
            if err:
                errors_by_sensor[sensor_label] = err
            all_features.extend(feats)
    return all_features, counts_by_sensor, errors_by_sensor


@app.get("/api/v1/realtime/area")
def realtime_area(
    south: float = Query(..., ge=-90.0, le=90.0),
    west: float = Query(..., ge=-180.0, le=180.0),
    north: float = Query(..., ge=-90.0, le=90.0),
    east: float = Query(..., ge=-180.0, le=180.0),
    days: int = Query(3, ge=1, le=10),
):
    """Consulta en tiempo real clima global (Open-Meteo), geocodificación administrativa y focos activos MODIS/VIIRS (NASA FIRMS) para cualquier bbox del mundo."""
    if south >= north or west >= east:
        raise ApiError(400, "INVALID_PARAMETER", "Bounding box inválido: requiere south < north y west < east")

    if not _realtime_enabled():
        return {
            "schema_version": "1.0",
            "bbox": {"south": south, "west": west, "north": north, "east": east},
            "days": days,
            "hotspots_status": "realtime_disabled",
            "counts_by_sensor": {},
            "hotspots": {"type": "FeatureCollection", "features": []},
            "realtime_setup": {
                "env_var": "MCHANAQ_ENABLE_REALTIME",
                "note": "Configura MCHANAQ_ENABLE_REALTIME=1 en el servidor para habilitar clima/geocodificación/focos en tiempo real (Open-Meteo, Nominatim, NASA FIRMS).",
            },
        }

    center_lat = (south + north) / 2.0
    center_lon = (west + east) / 2.0
    firms_key = os.getenv("FIRMS_MAP_KEY", "").strip()
    region = _select_firms_public_region(south, west, north, east)
    win = "48h" if days >= 2 else "24h"

    all_features: list[dict] = []
    counts_by_sensor: dict[str, int] = {}
    errors_by_sensor: dict[str, str] = {}
    firms_mode = "area_api" if firms_key else "public_nrt_csv"

    def _run_area_firms(firms_source: str, sensor_label: str) -> tuple[list[dict], str | None]:
        with httpx.Client(timeout=12.0) as client:
            return _fetch_firms_source_cached(
                client=client,
                map_key=firms_key,
                firms_source=firms_source,
                sensor_label=sensor_label,
                west=west,
                south=south,
                east=east,
                north=north,
                days=days,
            )

    with ThreadPoolExecutor(max_workers=5) as pool:
        f_weather = pool.submit(_fetch_open_meteo_current, center_lat, center_lon)
        f_location = pool.submit(_reverse_geocode_coords, center_lat, center_lon)
        if firms_key:
            f_sensors = [
                (sensor_label, pool.submit(_run_area_firms, firms_source, sensor_label))
                for firms_source, sensor_label in _FIRMS_SOURCES
            ]
        else:
            f_pub = pool.submit(_collect_firms_public_area, region, win, west, south, east, north)

        weather = f_weather.result()
        location = f_location.result()
        if firms_key:
            for sensor_label, fut in f_sensors:
                feats, err = fut.result()
                counts_by_sensor[sensor_label] = len(feats)
                if err:
                    errors_by_sensor[sensor_label] = err
                all_features.extend(feats)
        else:
            all_features, counts_by_sensor, errors_by_sensor = f_pub.result()

    # Si Area API falló completamente por clave inválida, respaldar con el feed público oficial.
    if firms_key and len(errors_by_sensor) == len(_FIRMS_SOURCES) and not all_features:
        firms_mode = "public_nrt_csv"
        all_features, counts_by_sensor, errors_by_sensor = _collect_firms_public_area(
            region, win, west, south, east, north
        )

    truncated = len(all_features) > _FIRMS_MAX_RETURNED_FEATURES
    if truncated:
        step = max(1, len(all_features) // _FIRMS_MAX_RETURNED_FEATURES)
        all_features = all_features[::step][:_FIRMS_MAX_RETURNED_FEATURES]

    if len(errors_by_sensor) == len(_FIRMS_SOURCES) and not all_features:
        hotspots_status = "unavailable"
    elif errors_by_sensor:
        hotspots_status = "partial"
    else:
        hotspots_status = "ok"

    return {
        "schema_version": "1.0",
        "bbox": {"south": south, "west": west, "north": north, "east": east},
        "days": days,
        "firms_mode": firms_mode,
        "truncated": truncated,
        "location": location,
        "weather": weather,
        "hotspots_status": hotspots_status,
        "counts_by_sensor": counts_by_sensor,
        "errors_by_sensor": errors_by_sensor or None,
        "hotspots": {"type": "FeatureCollection", "features": all_features},
    }
