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
    assess_conditions,
)
from src.analytics.metrics import (
    PROCESSING_VERSION,
    aggregate_daily_env_monthly,
    build_daily_records,
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


def _write_json(path: Path, payload: dict[str, Any], *, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else 2)
    path.write_text(text, encoding="utf-8")


def _contiguous_date_ranges(dates: list[str]) -> list[dict[str, str]]:
    if not dates:
        return []
    uniq = sorted(set(dates))
    return [{"from": uniq[0], "to": uniq[-1]}]


def build_metadata(
    daily_records: list[dict[str, Any]],
    summary_items: list[dict[str, Any]],
    assessments: list[dict[str, Any]],
    *,
    manifest: dict[str, Any] | None = None,
    processing_version: str = PROCESSING_VERSION,
) -> dict[str, Any]:
    """Genera metadata.json combinando rango real calculado y gee_manifest.json."""
    manifest = manifest or {}

    dates_by_sensor: dict[str, list[str]] = {s: [] for s in SENSORS_ORDER}
    for r in daily_records:
        s = r.get("sensor")
        if s in dates_by_sensor:
            dates_by_sensor[s].append(r["date"])

    periods_by_sensor: dict[str, set[str]] = {s: set() for s in SENSORS_ORDER}
    for s_row in summary_items:
        s = s_row.get("sensor")
        if s in periods_by_sensor:
            periods_by_sensor[s].add(s_row["period_id"])

    env_periods = sorted({a["period_id"] for a in assessments if a.get("classification") != "not_evaluable"})
    if not env_periods:
        env_periods = sorted({a["period_id"] for a in assessments})

    common_sensor_periods: set[str] | None = None
    for s in SENSORS_ORDER:
        if periods_by_sensor[s]:
            common_sensor_periods = (
                set(periods_by_sensor[s])
                if common_sensor_periods is None
                else common_sensor_periods & periods_by_sensor[s]
            )
    common_sensor_periods = common_sensor_periods or set()
    common_analysis_periods = sorted(common_sensor_periods & set(env_periods)) if env_periods else sorted(common_sensor_periods)

    all_env_dates = sorted({r["date"] for r in daily_records if r["date"][:7] in set(env_periods)})
    all_cmp_dates = sorted({r["date"] for r in daily_records if r["date"][:7] in set(common_analysis_periods)})

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
        "available_date_ranges_by_sensor": {s: _contiguous_date_ranges(dates_by_sensor[s]) for s in SENSORS_ORDER},
        "common_environmental_periods": env_periods,
        "common_environmental_dates": _contiguous_date_ranges(all_env_dates),
        "common_analysis_periods": common_analysis_periods,
        "common_analysis_dates": _contiguous_date_ranges(all_cmp_dates),
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
        "parameters": {
            "min_observation_coverage_for_comparison": MIN_COVERAGE_COMPARISON,
            "elevated_signal_robust_z": ELEVATED_ROBUST_Z,
            "min_baseline_years": MIN_BASELINE_YEARS,
            "umbral_veg_pct": DEFAULT_UMBRAL_VEG_PCT,
            "umbral_pend_pct": DEFAULT_UMBRAL_PEND_PCT,
        },
        "limitations": [
            "activity_rate no es probabilidad de incendio ni superficie quemada.",
            "No se suman conteos entre sensores.",
            "La susceptibilidad contextual es cualitativa, no un índice validado de riesgo.",
        ],
    }


def run_pipeline(
    intermediate_dir: Path = DEFAULT_INTERMEDIATE,
    processed_dir: Path = DEFAULT_PROCESSED,
    *,
    daily_from: str | None = None,
    compact: bool = True,
) -> dict[str, int]:
    """Ejecuta el flujo completo CSVs intermedios -> JSONs API-ready."""
    activity_rows = _read_csv_glob(intermediate_dir, "daily_activity*.csv")
    if not activity_rows:
        raise FileNotFoundError(f"No se encontraron archivos daily_activity*.csv en {intermediate_dir}")

    env_daily_rows = _read_csv_glob(intermediate_dir, "environmental_daily*.csv")
    env_context_rows = _read_csv_glob(intermediate_dir, "environmental_context*.csv")

    manifest_path = intermediate_dir / "gee_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}

    daily_records = build_daily_records(activity_rows, env_daily_rows)
    summary_items = summarize_monthly_activity(daily_records)
    attach_historical_anomalies(summary_items)
    comparisons = build_sensor_comparisons(summary_items)
    daily_env_monthly = aggregate_daily_env_monthly(daily_records)

    assessments = (
        assess_conditions(env_context_rows, daily_env_monthly=daily_env_monthly, comparison_items=comparisons)
        if env_context_rows
        else []
    )
    metadata = build_metadata(daily_records, summary_items, assessments, manifest=manifest)

    daily_out = [r for r in daily_records if not daily_from or r["date"] >= daily_from]

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
    parser.add_argument("--daily-from", type=str, default=None, help="Fecha mínima YYYY-MM-DD para activity_daily.json (acota tamaño en Render)")
    args = parser.parse_args()

    stats = run_pipeline(args.intermediate, args.processed, daily_from=args.daily_from)
    total_bytes = sum(p.stat().st_size for p in args.processed.glob("*.json")) + (
        (args.processed / "territories.geojson").stat().st_size if (args.processed / "territories.geojson").exists() else 0
    )
    print(f"OK analytics: {stats} | total data/processed = {total_bytes / (1024 * 1024):.2f} MB")


if __name__ == "__main__":
    main()
