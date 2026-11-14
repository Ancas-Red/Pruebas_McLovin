"""Árbol de decisión transparente de susceptibilidad contextual (N0 -> N3)."""

from __future__ import annotations

from collections import defaultdict
import math
from typing import Any

from src.analytics.metrics import PROCESSING_VERSION, parse_float

DEFAULT_UMBRAL_VEG_PCT = 25.0
DEFAULT_UMBRAL_PEND_PCT = 20.0
DEFAULT_WATER_HIGH_PCT = 5.0
DEFAULT_MIN_BASELINE_YEARS = 5


def _percentile(values: list[float], q: float) -> float:
    """Percentil lineal estándar (q en [0, 100]) sobre una lista ordenada no vacía."""
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    idx = (len(s) - 1) * (q / 100.0)
    lo = math.floor(idx)
    hi = math.ceil(idx)
    if lo == hi:
        return s[lo]
    return s[lo] + (s[hi] - s[lo]) * (idx - lo)


def _compute_seasonal_quantiles(
    rows: list[dict[str, Any]],
    *,
    min_baseline_years: int,
) -> dict[tuple[str, str, str, str], tuple[float, float]]:
    """Calcula (p25, p75) por (territory_type, territory_id, cal_month, variable)."""
    vars_needed = ("precip_30d_mm", "soil_moisture_surface", "wind_speed_10m_ms", "temperature_2m_c", "relative_humidity_2m_pct")
    buckets: dict[tuple[str, str, str, str], list[float]] = defaultdict(list)

    for row in rows:
        cal_month = str(row["period_id"])[5:7]
        t_type = str(row["territory_type"])
        t_id = str(row["territory_id"])
        for var in vars_needed:
            val = parse_float(row.get(var))
            if val is not None:
                buckets[(t_type, t_id, cal_month, var)].append(val)

    quantiles: dict[tuple[str, str, str, str], tuple[float, float]] = {}
    for key, vals in buckets.items():
        if len(vals) >= min_baseline_years:
            quantiles[key] = (_percentile(vals, 25.0), _percentile(vals, 75.0))
    return quantiles


def assess_conditions(
    env_context_rows: list[dict[str, Any]],
    *,
    daily_env_monthly: dict[tuple[str, str, str], dict[str, Any]] | None = None,
    comparison_items: list[dict[str, Any]] | None = None,
    umbral_veg_pct: float = DEFAULT_UMBRAL_VEG_PCT,
    umbral_pend_pct: float = DEFAULT_UMBRAL_PEND_PCT,
    min_baseline_years: int = DEFAULT_MIN_BASELINE_YEARS,
    processing_version: str = PROCESSING_VERSION,
) -> list[dict[str, Any]]:
    """Evalúa el árbol N0..N3 para cada (period_id, territory_type, territory_id)."""
    daily_env_monthly = daily_env_monthly or {}
    thermal_elevated_keys = {
        (c["period_id"], c["territory_type"], c["territory_id"])
        for c in (comparison_items or [])
        if any(
            (sdata or {}).get("signal_status") == "elevated"
            for sdata in (c.get("sensors") or {}).values()
        )
    }

    # Fusionar variables mensuales de environmental_daily si faltan en environmental_context
    merged_rows: list[dict[str, Any]] = []
    for row in env_context_rows:
        period_id = str(row["period_id"])
        t_type = str(row["territory_type"])
        t_id = str(row["territory_id"])
        d_env = daily_env_monthly.get((period_id, t_type, t_id), {})
        merged = dict(row)
        if parse_float(merged.get("temperature_2m_c")) is None:
            merged["temperature_2m_c"] = d_env.get("t_amb_c")
        if parse_float(merged.get("relative_humidity_2m_pct")) is None:
            merged["relative_humidity_2m_pct"] = d_env.get("relative_humidity_2m_pct")
        if parse_float(merged.get("wind_speed_10m_ms")) is None:
            merged["wind_speed_10m_ms"] = d_env.get("wind_speed_10m_ms")
        merged_rows.append(merged)

    quantiles = _compute_seasonal_quantiles(merged_rows, min_baseline_years=min_baseline_years)
    assessments: list[dict[str, Any]] = []

    for row in sorted(merged_rows, key=lambda r: (str(r["period_id"]), str(r["territory_type"]), str(r["territory_id"]))):
        period_id = str(row["period_id"])
        cal_month = period_id[5:7]
        t_type = str(row["territory_type"])
        t_id = str(row["territory_id"])

        veg_pct = parse_float(row.get("vegetation_area_pct"))
        precip = parse_float(row.get("precip_30d_mm"))
        soil_m = parse_float(row.get("soil_moisture_surface"))
        wind = parse_float(row.get("wind_speed_10m_ms"))
        temp = parse_float(row.get("temperature_2m_c"))
        rh = parse_float(row.get("relative_humidity_2m_pct"))
        slope_pct = parse_float(row.get("slope_class_area_pct"))
        water_pct = parse_float(row.get("water_area_pct"))

        missing: list[str] = []
        if veg_pct is None:
            missing.append("vegetation_area_pct")
        if precip is None and soil_m is None:
            missing.append("dryness_indicator")
        if wind is None and (temp is None or rh is None):
            missing.append("weather_indicator")

        evidence: list[dict[str, Any]] = []

        def add_ev(var: str, val: float | None, unit: str, status: str, src: str, src_per: str, res: str) -> None:
            if val is None:
                return
            evidence.append(
                {
                    "variable": var,
                    "value": round(val, 3),
                    "unit": unit,
                    "rule_status": status,
                    "source_product": src,
                    "source_period": src_per,
                    "source_resolution": res,
                }
            )

        q_precip = quantiles.get((t_type, t_id, cal_month, "precip_30d_mm"))
        q_soil = quantiles.get((t_type, t_id, cal_month, "soil_moisture_surface"))
        q_wind = quantiles.get((t_type, t_id, cal_month, "wind_speed_10m_ms"))
        q_temp = quantiles.get((t_type, t_id, cal_month, "temperature_2m_c"))
        q_rh = quantiles.get((t_type, t_id, cal_month, "relative_humidity_2m_pct"))

        dry_precip = precip is not None and q_precip is not None and precip < q_precip[0]
        dry_soil = soil_m is not None and q_soil is not None and soil_m < q_soil[0]
        dryness_estimable = (precip is not None and q_precip is not None) or (soil_m is not None and q_soil is not None)

        wind_high = wind is not None and q_wind is not None and wind > q_wind[1]
        warm_dry = (
            temp is not None and q_temp is not None and temp > q_temp[1]
            and rh is not None and q_rh is not None and rh < q_rh[0]
        )
        weather_estimable = (wind is not None and q_wind is not None) or (
            temp is not None and q_temp is not None and rh is not None and q_rh is not None
        )

        add_ev(
            "vegetation_area_pct",
            veg_pct,
            "%",
            "above_umbral_veg" if (veg_pct is not None and veg_pct >= umbral_veg_pct) else "below_umbral_veg",
            "MAPBIOMAS_PERU_C4",
            str(row.get("landcover_year") or period_id[:4]),
            "30 m",
        )
        add_ev(
            "precip_30d_mm",
            precip,
            "mm",
            "not_estimable_baseline" if q_precip is None else ("below_seasonal_p25" if dry_precip else "not_below_seasonal_p25"),
            "ERA5_LAND_HOURLY",
            period_id,
            "~11.1 km",
        )
        add_ev(
            "soil_moisture_surface",
            soil_m,
            "m3/m3",
            "not_estimable_baseline" if q_soil is None else ("below_seasonal_p25" if dry_soil else "not_below_seasonal_p25"),
            "ERA5_LAND_HOURLY",
            period_id,
            "~11.1 km",
        )
        add_ev(
            "wind_speed_10m_ms",
            wind,
            "m/s",
            "not_estimable_baseline" if q_wind is None else ("above_seasonal_p75" if wind_high else "not_above_seasonal_p75"),
            "ERA5_LAND_HOURLY",
            period_id,
            "~11.1 km",
        )
        add_ev(
            "temperature_2m_c",
            temp,
            "°C",
            "not_estimable_baseline" if q_temp is None else ("above_seasonal_p75" if temp is not None and temp > q_temp[1] else "not_above_seasonal_p75"),
            "ERA5_LAND_HOURLY",
            period_id,
            "~11.1 km",
        )
        add_ev(
            "relative_humidity_2m_pct",
            rh,
            "%",
            "not_estimable_baseline" if q_rh is None else ("below_seasonal_p25" if rh is not None and rh < q_rh[0] else "not_below_seasonal_p25"),
            "ERA5_LAND_HOURLY",
            period_id,
            "~11.1 km",
        )
        add_ev(
            "slope_class_area_pct",
            slope_pct,
            "%",
            "above_umbral_pend" if (slope_pct is not None and slope_pct >= umbral_pend_pct) else "below_umbral_pend",
            str(row.get("dem_source") or "SRTM"),
            "static",
            "30 m",
        )

        # Compuerta N0: bloques esenciales y referencia estacional suficiente
        if missing or not (dryness_estimable and weather_estimable):
            if not dryness_estimable and "dryness_seasonal_baseline" not in missing:
                missing.append("dryness_seasonal_baseline")
            if not weather_estimable and "weather_seasonal_baseline" not in missing:
                missing.append("weather_seasonal_baseline")
            classification = "not_evaluable" if len(evidence) == 0 else "partial"
            assessments.append(
                {
                    "period_id": period_id,
                    "territory_type": t_type,
                    "territory_id": t_id,
                    "classification": classification,
                    "decision_path": ["N0:fail"],
                    "rules_triggered": [],
                    "modifiers": [],
                    "evidence": evidence,
                    "missing_variables": missing,
                    "data_quality_status": "insufficient" if classification == "not_evaluable" else "partial",
                    "source_products": sorted({e["source_product"] for e in evidence}),
                    "processing_version": processing_version,
                }
            )
            continue

        path = ["N0:pass"]
        rules: list[str] = []
        modifiers: list[str] = []

        if slope_pct is not None and slope_pct >= umbral_pend_pct:
            modifiers.append("steep_slope_share_high")
        if (period_id, t_type, t_id) in thermal_elevated_keys:
            modifiers.append("thermal_history_elevated")
        if water_pct is not None and water_pct >= DEFAULT_WATER_HIGH_PCT:
            modifiers.append("water_share_high")

        if veg_pct < umbral_veg_pct:
            path.append("N1:no")
            classification = "low"
        else:
            path.append("N1:yes")
            rules.append("vegetation_present")
            is_dry = dry_precip or dry_soil

            if is_dry:
                path.append("N2:yes")
                rules.append("dryness_high")
                if wind_high or warm_dry:
                    path.append("N3a:yes")
                    if wind_high:
                        rules.append("wind_high")
                    if warm_dry:
                        rules.append("warm_dry")
                    classification = "high"
                else:
                    path.append("N3a:no")
                    classification = "moderate"
            else:
                path.append("N2:no")
                steep = slope_pct is not None and slope_pct >= umbral_pend_pct
                if wind_high and steep:
                    path.append("N3b:yes")
                    rules.extend(["wind_high", "steep_slope"])
                    classification = "moderate"
                else:
                    path.append("N3b:no")
                    classification = "low"

        assessments.append(
            {
                "period_id": period_id,
                "territory_type": t_type,
                "territory_id": t_id,
                "classification": classification,
                "decision_path": path,
                "rules_triggered": rules,
                "modifiers": modifiers,
                "evidence": evidence,
                "missing_variables": [],
                "data_quality_status": "usable",
                "source_products": sorted({e["source_product"] for e in evidence}),
                "processing_version": processing_version,
            }
        )

    return assessments
