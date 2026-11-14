"""McHanaq API — Backend de solo lectura (Fase 1, resolución diaria por defecto)."""

import csv
import io
import json
import math
import os
from datetime import date as dt_date
from pathlib import Path

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

ROOT = Path(__file__).resolve().parents[3]
DATA = Path(os.getenv("MCHANAQ_DATA_DIR", ROOT / "data" / "processed"))
if not DATA.is_absolute():
    DATA = ROOT / DATA
NO_CACHE = os.getenv("MCHANAQ_NO_CACHE", "0") == "1"
CORS_ORIGINS = [o.strip() for o in os.getenv("MCHANAQ_CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

TYPES = {"province", "hydro_unit"}
SENSORS = {"MODIS_TERRA", "MODIS_AQUA", "VIIRS_SNPP"}
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
TERR = load_json("territories.geojson") or {"type": "FeatureCollection", "features": []}
DAILY = (load_json("activity_daily.json") or {}).get("items", [])
SUMMARY = (load_json("activity_summary.json") or {}).get("items", [])
COMPARE = (load_json("sensor_comparison.json") or {}).get("items", [])
ASSESS = (load_json("conditions_assessment.json") or {}).get("items", [])
HOTSPOTS = load_json("hotspots.geojson")


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
    allow_methods=["GET"],
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
                ok &= _date_in_ranges(d, ranges_map[sensor])
            else:
                ok &= resolved_period in META.get("available_periods_by_sensor", {}).get(sensor, [])
        if full or env_only:
            if "common_environmental_dates" in META:
                ok &= _date_in_ranges(d, META.get("common_environmental_dates"))
            else:
                ok &= resolved_period in (META.get("common_environmental_periods") or [])
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
        if full or env_only:
            if "common_environmental_periods" in META:
                ok &= period in (META.get("common_environmental_periods") or [])
            else:
                ok &= _period_in_ranges(period, META.get("common_environmental_dates"))
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
        for r in DAILY:
            if (
                r.get("territory_type") == t_type
                and str(r.get("territory_id")) == t_id
                and r.get("sensor") == sensor
                and r.get("date", "").startswith(resolved_period)
                and r.get("dem_source")
            ):
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
    resolved_period = check_date(d=date, period=None if date else period, sensor=sensor, full=True)
    terr = find_territory(type, id)

    daily_row = pick(DAILY, territory_type=type, territory_id=id, sensor=sensor, date=date) if date else None
    summary_row = pick(SUMMARY, territory_type=type, territory_id=id, sensor=sensor, period_id=resolved_period) or {}
    assess_row = pick(ASSESS, territory_type=type, territory_id=id, period_id=resolved_period) or {}

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

    row = pick(COMPARE, territory_type=type, territory_id=id, period_id=resolved_period)
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
    if not HOTSPOTS:
        raise ApiError(404, "NOT_FOUND", "hotspots.geojson no está disponible")
    feats = [
        f for f in HOTSPOTS.get("features", [])
        if f.get("properties", {}).get("territory_type") == type
        and str(f.get("properties", {}).get("territory_id")) == id
        and f.get("properties", {}).get("date") == date
        and f.get("properties", {}).get("sensor") == sensor
    ]
    return {"schema_version": "1.0", "type": "FeatureCollection", "features": feats}
