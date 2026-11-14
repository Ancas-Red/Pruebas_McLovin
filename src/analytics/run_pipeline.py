"""Pipeline principal de analítica (data/intermediate/*.csv -> data/processed/*.json)."""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from src.analytics.anomalies import MIN_BASELINE_YEARS, attach_historical_anomalies
from src.analytics.decision_rules import (
    DEFAULT_UMBRAL_PEND_PCT,
    DEFAULT_UMBRAL_VEG_PCT,
    DEFAULT_WATER_BUFFER_M,
    assess_conditions,
)
from src.analytics.metrics import (
    DEFAULT_MIN_CLOUD_FREE_COVERAGE,
    PROCESSING_VERSION,
    aggregate_daily_env_monthly,
    build_daily_records,
    parse_float,
    summarize_monthly_activity,
)
from src.analytics.sensor_comparison import (
    ELEVATED_ROBUST_Z,
    MIN_COVERAGE_COMPARISON,
    SENSORS_ORDER,
    build_sensor_comparisons,
)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INTERMEDIATE = ROOT / "data" / "intermediate"
DEFAULT_PROCESSED = ROOT / "data" / "processed"


def _read_csv_glob(folder: Path, pattern: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for path in sorted(folder.glob(pattern)):
        with path.open("r", encoding="utf-8-sig", newline="") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                rows.append(dict(row))
    return rows


def _load_static_terrain(intermediate_dir: Path, processed_dir: Path) -> dict[tuple[str, str], dict[str, Any]]:
    """Carga terreno estático opcional (*terrain*static*.csv) indexado por (territory_type, territory_id)."""
    rows = _read_csv_glob(intermediate_dir, "*terrain*static*.csv")
    if not rows and processed_dir.exists():
        rows = _read_csv_glob(processed_dir, "*terrain*static*.csv")

    static_map: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        t_type = str(row.get("territory_type") or "").strip()
        t_id = str(row.get("territory_id") or "").strip()
        if not t_type or not t_id:
            continue
        slope_pct = parse_float(row.get("slope_class_area_pct"))
        if slope_pct is None:
            slope_frac = parse_float(row.get("slope_ge_15pct_fraction"))
            if slope_frac is not None:
                slope_pct = round(slope_frac * 100.0, 2)
        static_map[(t_type, t_id)] = {
            "elevation_m": parse_float(row.get("elevation_m")),
            "dem_source": (row.get("dem_source") or "").strip() or None,
            "slope_class_area_pct": slope_pct,
        }
    return static_map


def _load_province_landcover_from_districts(
    intermediate_dir: Path,
    processed_dir: Path,
) -> dict[tuple[str, str], dict[str, Any]]:
    """Agrega fracciones de *districts_static*.csv por provincia (ubigeo[:4]) en porcentaje 0..100."""
    rows = _read_csv_glob(intermediate_dir, "*districts_static*.csv")
    if not rows and processed_dir.exists():
        rows = _read_csv_glob(processed_dir, "*districts_static*.csv")

    totals: dict[str, dict[str, float]] = {}
    for row in rows:
        ubigeo = str(row.get("ubigeo") or "").strip()
        area = parse_float(row.get("area_km2"))
        if len(ubigeo) < 4 or not area or area <= 0:
            continue
        prov_id = ubigeo[:4]
        veg = parse_float(row.get("vegetation_area_km2")) or 0.0
        water = parse_float(row.get("water_area_km2")) or 0.0
        buf_150 = parse_float(row.get("water_buffer_150m_area_km2"))
        eff_veg = parse_float(row.get("veg_outside_water_buffer_km2"))
        bucket = totals.setdefault(
            prov_id,
            {"area": 0.0, "veg": 0.0, "water": 0.0, "buf_150": 0.0, "eff_veg": 0.0, "has_buf": 0.0},
        )
        bucket["area"] += area
        bucket["veg"] += veg
        bucket["water"] += water
        if buf_150 is not None and eff_veg is not None:
            bucket["buf_150"] += buf_150
            bucket["eff_veg"] += eff_veg
            bucket["has_buf"] += 1.0

    out: dict[tuple[str, str], dict[str, Any]] = {}
    for prov_id, b in totals.items():
        if b["area"] <= 0:
            continue
        entry: dict[str, Any] = {
            "vegetation_area_pct": round((b["veg"] / b["area"]) * 100.0, 2),
            "water_area_pct": round((b["water"] / b["area"]) * 100.0, 2),
            "landcover_source": "COBVEG_MINAM_2015",
            "landcover_year": 2015,
        }
        if b["has_buf"] > 0:
            entry["water_buffer_150m_pct"] = round((b["buf_150"] / b["area"]) * 100.0, 2)
            entry["effective_vegetation_area_pct"] = round((b["eff_veg"] / b["area"]) * 100.0, 2)
        out[("province", prov_id)] = entry
    return out


def _load_verified_dates(intermediate_dir: Path) -> dict[str, Any]:
    """Lee gee_verified_dates.json desde intermediate_dir o src/gee/ si existe."""
    for candidate in (intermediate_dir / "gee_verified_dates.json", ROOT / "src" / "gee" / "gee_verified_dates.json"):
        if candidate.exists():
            return json.loads(candidate.read_text(encoding="utf-8"))
    return {}


def _write_json(path: Path, payload: dict[str, Any], *, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else 2)
    path.write_text(text, encoding="utf-8")


def _next_month(period_id: str) -> str:
    year, month = int(period_id[:4]), int(period_id[5:7])
    return f"{year + 1}-01" if month == 12 else f"{year:04d}-{month + 1:02d}"


def _contiguous_date_ranges(dates: list[str]) -> list[dict[str, str]]:
    """Agrupa fechas útiles en rangos continuos por meses calendario consecutivos con datos."""
    if not dates:
        return []
    uniq = sorted(set(dates))
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


def _is_useful_daily_record(record: dict[str, Any]) -> bool:
    """Retorna True si el registro diario tiene observación terrestre útil (>=70 % cobertura o tasa válida)."""
    valid = record.get("valid_land_pixels")
    if valid is None or valid <= 0:
        return False
    cov = record.get("observation_coverage")
    if cov is not None and cov < DEFAULT_MIN_CLOUD_FREE_COVERAGE:
        return False
    return bool(record.get("cloud_ok_lt30pct")) or (record.get("activity_rate") is not None)


def _has_any_env_value(record: dict[str, Any]) -> bool:
    return any(
        record.get(field) is not None
        for field in ("t_amb_c", "relative_humidity_2m_pct", "t_suelo_c", "wind_speed_10m_ms", "elevation_m")
    )


def build_metadata(
    daily_records: list[dict[str, Any]],
    summary_items: list[dict[str, Any]],
    assessments: list[dict[str, Any]],
    *,
    manifest: dict[str, Any] | None = None,
    verified_dates: dict[str, Any] | None = None,
    processing_version: str = PROCESSING_VERSION,
) -> dict[str, Any]:
    """Genera metadata.json combinando rango real calculado, gee_manifest.json y gee_verified_dates.json."""
    manifest = manifest or {}
    verified_dates = verified_dates or {}
    common_win = verified_dates.get("common_window") or {}

    dates_by_sensor: dict[str, set[str]] = {s: set() for s in SENSORS_ORDER}
    fallback_dates_by_sensor: dict[str, set[str]] = {s: set() for s in SENSORS_ORDER}
    for r in daily_records:
        s = r.get("sensor")
        if s not in dates_by_sensor:
            continue
        if _is_useful_daily_record(r):
            dates_by_sensor[s].add(r["date"])
        elif (r.get("valid_land_pixels") or 0) > 0 and r.get("observation_coverage") is None:
            # Respaldo solo para fixtures sintéticos mínimos sin expected_land_pixels_per_day
            fallback_dates_by_sensor[s].add(r["date"])

    for s in SENSORS_ORDER:
        if not dates_by_sensor[s] and fallback_dates_by_sensor[s]:
            dates_by_sensor[s] = fallback_dates_by_sensor[s]

    useful_periods_by_sensor: dict[str, set[str]] = {
        s: {d[:7] for d in dates_by_sensor[s]} for s in SENSORS_ORDER
    }
    periods_by_sensor: dict[str, set[str]] = {s: set() for s in SENSORS_ORDER}
    for s_row in summary_items:
        s = s_row.get("sensor")
        p_id = s_row.get("period_id")
        if s not in periods_by_sensor or not p_id:
            continue
        if not daily_records or p_id in useful_periods_by_sensor[s]:
            periods_by_sensor[s].add(p_id)
    for s in SENSORS_ORDER:
        if not periods_by_sensor[s] and useful_periods_by_sensor[s]:
            periods_by_sensor[s] = set(useful_periods_by_sensor[s])

    env_periods = sorted({a["period_id"] for a in assessments if a.get("classification") != "not_evaluable"})
    if not env_periods:
        env_periods = sorted({a["period_id"] for a in assessments})

    common_sensor_periods: set[str] | None = None
    common_sensor_dates: set[str] | None = None
    for s in SENSORS_ORDER:
        if periods_by_sensor[s]:
            common_sensor_periods = (
                set(periods_by_sensor[s])
                if common_sensor_periods is None
                else common_sensor_periods & periods_by_sensor[s]
            )
        if dates_by_sensor[s]:
            common_sensor_dates = (
                set(dates_by_sensor[s])
                if common_sensor_dates is None
                else common_sensor_dates & dates_by_sensor[s]
            )
    common_sensor_periods = common_sensor_periods or set()
    common_sensor_dates = common_sensor_dates or set()

    common_analysis_periods = sorted(common_sensor_periods & set(env_periods)) if env_periods else sorted(common_sensor_periods)
    # Excluir meses parciales de borde cuando la ventana común supera 1 mes y hay tope verificado
    last_complete_month = common_win.get("last_complete_common_month")
    if len(common_analysis_periods) > 1 and last_complete_month:
        common_analysis_periods = [p for p in common_analysis_periods if p <= last_complete_month]

    env_period_set = set(env_periods)
    all_env_dates = sorted(
        {
            r["date"]
            for r in daily_records
            if r["date"][:7] in env_period_set and (_is_useful_daily_record(r) or _has_any_env_value(r))
        }
    )
    if env_periods:
        env_date_set = set(all_env_dates)
        all_cmp_dates = sorted(common_sensor_dates & env_date_set)
    else:
        all_cmp_dates = sorted(common_sensor_dates)

    if common_win.get("start") and common_win.get("end") and all_cmp_dates:
        clipped = [d for d in all_cmp_dates if common_win["start"] <= d <= common_win["end"]]
        if clipped:
            all_cmp_dates = clipped

    return {
        "schema_version": "1.0",
        "data_origin": "processed",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "processing_version": processing_version,
        "territory_types": ["province", "hydro_unit"],
        "sensors": manifest.get(
            "sensors",
            [
                {"id": "MODIS_TERRA", "product": "MOD14A1", "overpass_local": "~10:30", "available_since": "2000-02", "resolution": "1 km"},
                {"id": "MODIS_AQUA", "product": "MYD14A1", "overpass_local": "~13:30", "available_since": "2002-07", "resolution": "1 km"},
                {"id": "VIIRS_SNPP", "product": "VNP14A1", "overpass_local": "~13:30", "available_since": "2012-01", "resolution": "1 km"},
            ],
        ),
        "available_periods_by_sensor": {s: sorted(periods_by_sensor[s]) for s in SENSORS_ORDER},
        "available_date_ranges_by_sensor": {s: _contiguous_date_ranges(sorted(dates_by_sensor[s])) for s in SENSORS_ORDER},
        "common_environmental_periods": env_periods,
        "common_environmental_dates": _contiguous_date_ranges(all_env_dates),
        "common_analysis_periods": common_analysis_periods,
        "common_analysis_dates": _contiguous_date_ranges(all_cmp_dates),
        **({"verified_common_window": common_win} if common_win else {}),
        "metrics": manifest.get(
            "metrics",
            {
                "activity": [
                    "activity_rate",
                    "fire_pixel_days_8_9",
                    "active_days",
                    "max_consecutive_active_days",
                    "observation_coverage",
                ],
                "environmental": [
                    "t_amb_c",
                    "t_suelo_c",
                    "wind_dir_deg",
                    "wind_speed_10m_ms",
                    "elevation_m",
                ],
                "classification": [
                    "conditions_classification",
                ],
            },
        ),
        "units": {
            "activity_rate": "píxeles-día detectados / píxeles-día válidos (adimensional)",
            "observation_coverage": "fracción 0–1",
            "fire_pixel_days_8_9": "píxeles-día",
            "t_amb_c": "°C",
            "relative_humidity_2m_pct": "%",
            "t_suelo_c": "°C",
            "wind_dir_deg": "grados (0–360, desde dónde sopla)",
            "wind_speed_10m_ms": "m/s",
            "elevation_m": "m s.n.m.",
        },
        "dem_by_epoch": manifest.get(
            "dem_by_epoch",
            [
                {"epoch": "2000-2011", "applies_to": "MODIS", "dem_source": "NASA_NASADEM_HGT_001", "resolution": "30 m"},
                {"epoch": "2012-presente", "applies_to": "VIIRS", "dem_source": "COPERNICUS_DEM_GLO30", "resolution": "30 m"},
            ],
        ),
        "environmental_sources": manifest.get(
            "environmental_sources",
            {
                "t_amb_c": "ECMWF/ERA5_LAND/DAILY_AGGR (temperature_2m)",
                "relative_humidity_2m_pct": "ECMWF/ERA5_LAND/DAILY_AGGR (temperature_2m, dewpoint_temperature_2m; Magnus-Tetens)",
                "t_suelo_c": "MODIS/061/MOD11A1, MYD11A1; NOAA/VIIRS/001/VNP21A1D (o NASA/VIIRS/002/VNP21A1D)",
                "wind": "ECMWF/ERA5_LAND/DAILY_AGGR (u/v_component_of_wind_10m)",
                "precip_30d_mm": "ECMWF/ERA5_LAND/DAILY_AGGR (total_precipitation_sum)",
                "soil_moisture_surface": "ECMWF/ERA5_LAND/DAILY_AGGR (volumetric_soil_water_layer_1)",
                "ndvi_median": "MODIS/061/MOD13A3 (NDVI)",
                "landcover": "CobVeg 2015 (MINAM) / ESA WorldCover v200",
                "water_buffer_150m": "CobVeg 2015 (MINAM) + JRC/GSW1_4/GlobalSurfaceWater (150 m)",
                "dem": "NASA/NASADEM_HGT/001 (2000-2011) | COPERNICUS/DEM/GLO30 (2012+)",
            },
        ),
        "parameters": {
            "min_daily_cloud_free_coverage": DEFAULT_MIN_CLOUD_FREE_COVERAGE,
            "min_observation_coverage_for_comparison": MIN_COVERAGE_COMPARISON,
            "elevated_signal_robust_z": ELEVATED_ROBUST_Z,
            "min_baseline_years": MIN_BASELINE_YEARS,
            "umbral_veg_pct": DEFAULT_UMBRAL_VEG_PCT,
            "umbral_pend_pct": DEFAULT_UMBRAL_PEND_PCT,
            "water_buffer_m": DEFAULT_WATER_BUFFER_M,
        },
        "limitations": [
            "activity_rate no es probabilidad de incendio ni superficie quemada.",
            "No se suman conteos entre sensores.",
            "La susceptibilidad contextual es cualitativa, no un índice validado de riesgo.",
        ],
    }


def _resolve_daily_bound(value: str | None, verified_dates: dict[str, Any], bound_key: str) -> str | None:
    if value is None or value.lower() == "all":
        return None
    if value.lower() in {"common_window", "common-window"}:
        return (verified_dates.get("common_window") or {}).get(bound_key)
    return value


def run_pipeline(
    intermediate_dir: Path = DEFAULT_INTERMEDIATE,
    processed_dir: Path = DEFAULT_PROCESSED,
    *,
    daily_from: str | None = None,
    daily_to: str | None = None,
    compact: bool = True,
) -> dict[str, int]:
    """Ejecuta el flujo completo CSVs intermedios -> JSONs API-ready."""
    activity_rows = _read_csv_glob(intermediate_dir, "*daily_activity*.csv")
    if not activity_rows:
        raise FileNotFoundError(f"No se encontraron archivos *daily_activity*.csv en {intermediate_dir}")

    env_daily_rows = _read_csv_glob(intermediate_dir, "*environmental_daily*.csv")
    env_context_rows = _read_csv_glob(intermediate_dir, "*environmental_context*.csv")
    static_terrain = _load_static_terrain(intermediate_dir, processed_dir)
    static_landcover = _load_province_landcover_from_districts(intermediate_dir, processed_dir)

    manifest_path = intermediate_dir / "gee_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    verified_dates = _load_verified_dates(intermediate_dir)

    daily_records = build_daily_records(activity_rows, env_daily_rows)
    if static_terrain:
        for rec in daily_records:
            st = static_terrain.get((rec["territory_type"], rec["territory_id"]))
            if not st:
                continue
            if rec.get("elevation_m") is None and st.get("elevation_m") is not None:
                rec["elevation_m"] = st["elevation_m"]
            if rec.get("dem_source") is None:
                if rec["date"] < "2012-01-01":
                    st_src = st.get("dem_source")
                    rec["dem_source"] = st_src if (st_src and st_src != "COPERNICUS_DEM_GLO30") else "NASA_NASADEM_HGT_001"
                elif st.get("dem_source") is not None:
                    rec["dem_source"] = st["dem_source"]

    if env_context_rows and (static_terrain or static_landcover):
        enriched_ctx: list[dict[str, Any]] = []
        for row in env_context_rows:
            merged = dict(row)
            key = (str(merged.get("territory_type") or ""), str(merged.get("territory_id") or ""))
            st = static_terrain.get(key)
            if st:
                if parse_float(merged.get("slope_class_area_pct")) is None and st.get("slope_class_area_pct") is not None:
                    merged["slope_class_area_pct"] = st["slope_class_area_pct"]
                if not merged.get("dem_source"):
                    p_id = str(merged.get("period_id") or "")
                    if p_id and p_id < "2012-01":
                        st_src = st.get("dem_source")
                        merged["dem_source"] = st_src if (st_src and st_src != "COPERNICUS_DEM_GLO30") else "NASA_NASADEM_HGT_001"
                    elif st.get("dem_source"):
                        merged["dem_source"] = st["dem_source"]
            lc = static_landcover.get(key)
            if lc:
                for lc_field in (
                    "vegetation_area_pct",
                    "water_area_pct",
                    "water_buffer_150m_pct",
                    "effective_vegetation_area_pct",
                    "landcover_source",
                    "landcover_year",
                ):
                    if merged.get(lc_field) in (None, "") and lc.get(lc_field) is not None:
                        merged[lc_field] = lc[lc_field]
            enriched_ctx.append(merged)
        env_context_rows = enriched_ctx

    summary_items = summarize_monthly_activity(daily_records)
    attach_historical_anomalies(summary_items)
    comparisons = build_sensor_comparisons(summary_items)
    daily_env_monthly = aggregate_daily_env_monthly(daily_records)

    assessments = (
        assess_conditions(env_context_rows, daily_env_monthly=daily_env_monthly, comparison_items=comparisons)
        if env_context_rows
        else []
    )
    metadata = build_metadata(
        daily_records,
        summary_items,
        assessments,
        manifest=manifest,
        verified_dates=verified_dates,
    )

    eff_from = _resolve_daily_bound(daily_from, verified_dates, "start")
    eff_to = _resolve_daily_bound(daily_to, verified_dates, "end")
    daily_out = [
        r
        for r in daily_records
        if (not eff_from or r["date"] >= eff_from) and (not eff_to or r["date"] <= eff_to)
    ]

    _write_json(processed_dir / "activity_daily.json", {"schema_version": "1.0", "items": daily_out}, compact=compact)
    _write_json(processed_dir / "activity_summary.json", {"schema_version": "1.0", "items": summary_items}, compact=compact)
    _write_json(processed_dir / "sensor_comparison.json", {"schema_version": "1.0", "items": comparisons}, compact=compact)
    _write_json(processed_dir / "conditions_assessment.json", {"schema_version": "1.0", "items": assessments}, compact=compact)
    _write_json(processed_dir / "metadata.json", metadata, compact=False)

    return {
        "daily_items": len(daily_out),
        "summary_items": len(summary_items),
        "comparison_items": len(comparisons),
        "assessment_items": len(assessments),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="McHanaq Analytics Pipeline")
    parser.add_argument("--intermediate", type=Path, default=DEFAULT_INTERMEDIATE)
    parser.add_argument("--processed", type=Path, default=DEFAULT_PROCESSED)
    parser.add_argument(
        "--daily-from",
        type=str,
        default="common_window",
        help="Fecha mínima YYYY-MM-DD para activity_daily.json ('common_window' usa gee_verified_dates.json, 'all' desactiva el corte)",
    )
    parser.add_argument(
        "--daily-to",
        type=str,
        default="common_window",
        help="Fecha máxima YYYY-MM-DD para activity_daily.json ('common_window' usa gee_verified_dates.json, 'all' desactiva el corte)",
    )
    args = parser.parse_args()

    stats = run_pipeline(args.intermediate, args.processed, daily_from=args.daily_from, daily_to=args.daily_to)
    total_bytes = sum(p.stat().st_size for p in args.processed.glob("*.json")) + (
        (args.processed / "territories.geojson").stat().st_size if (args.processed / "territories.geojson").exists() else 0
    )
    print(f"OK analytics: {stats} | total data/processed = {total_bytes / (1024 * 1024):.2f} MB")


if __name__ == "__main__":
    main()
