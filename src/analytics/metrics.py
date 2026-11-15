"""Cálculo de métricas diarias y agregaciones mensuales por territorio y sensor."""

from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date as dt_date, timedelta
import math
from typing import Any

PROCESSING_VERSION = "0.2.0-ucayali"
DEFAULT_MIN_CLOUD_FREE_COVERAGE = 0.70
DEFAULT_MIN_LST_VALID_PCT = 70.0

SENSOR_DEFAULT_PRODUCT = {
    "MODIS_TERRA": "MOD14A1",
    "MODIS_AQUA": "MYD14A1",
    "VIIRS_SNPP": "VNP14A1",
}

ENV_DAILY_NUMERIC_FIELDS = (
    "t_amb_c",
    "relative_humidity_2m_pct",
    "t_suelo_c",
    "lst_valid_pixel_pct",
    "wind_dir_deg",
    "wind_speed_10m_ms",
    "elevation_m",
)


def parse_float(val: Any) -> float | None:
    """Convierte a float si es finito y no vacío; nunca convierte None en 0."""
    if val is None:
        return None
    if isinstance(val, str):
        s = val.strip()
        if not s or s.lower() in {"null", "none", "nan", "na"}:
            return None
        val = s
    try:
        out = float(val)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def parse_int(val: Any) -> int | None:
    """Convierte a int si no es vacío ni nulo."""
    f = parse_float(val)
    return int(round(f)) if f is not None else None


def _iter_dates(start_iso: str, end_iso: str) -> list[str]:
    start = dt_date.fromisoformat(start_iso)
    end = dt_date.fromisoformat(end_iso)
    days: list[str] = []
    cur = start
    while cur <= end:
        days.append(cur.isoformat())
        cur += timedelta(days=1)
    return days


def build_daily_records(
    activity_rows: list[dict[str, Any]],
    env_daily_rows: list[dict[str, Any]],
    *,
    fill_missing_dates: bool = True,
    min_valid_coverage: float = DEFAULT_MIN_CLOUD_FREE_COVERAGE,
    processing_version: str = PROCESSING_VERSION,
) -> list[dict[str, Any]]:
    """Une actividad diaria y variables ambientales diarias, rellenando días sin imagen."""
    env_by_key: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in env_daily_rows:
        key = (str(row["date"]), str(row["territory_type"]), str(row["territory_id"]))
        env_by_key[key] = row

    act_by_key: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    series_bounds: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    expected_by_series: dict[tuple[str, str, str], int] = {}
    product_by_series: dict[tuple[str, str, str], str] = {}

    for row in activity_rows:
        d = str(row["date"])
        t_type = str(row["territory_type"])
        t_id = str(row["territory_id"])
        sensor = str(row["sensor"])
        k4 = (d, t_type, t_id, sensor)
        k3 = (t_type, t_id, sensor)
        act_by_key[k4] = row
        series_bounds[k3].append(d)
        exp = parse_int(row.get("expected_land_pixels_per_day") or row.get("expected"))
        if exp is not None and exp > 0:
            expected_by_series.setdefault(k3, exp)
        prod = row.get("source_product")
        if prod:
            product_by_series.setdefault(k3, str(prod))

    records: list[dict[str, Any]] = []
    for (t_type, t_id, sensor), dates in sorted(series_bounds.items()):
        date_list = _iter_dates(min(dates), max(dates)) if fill_missing_dates else sorted(set(dates))
        expected_default = expected_by_series.get((t_type, t_id, sensor))
        product_default = product_by_series.get((t_type, t_id, sensor), SENSOR_DEFAULT_PRODUCT.get(sensor, ""))

        for d in date_list:
            act = act_by_key.get((d, t_type, t_id, sensor))
            env = env_by_key.get((d, t_type, t_id), {})

            if act is None:
                valid = 0
                expected = expected_default
                fire_low = None
                fire_high = None
                cov = 0.0 if (expected and expected > 0) else None
                rate = None
                src_prod = product_default
                proc_ver = processing_version
            else:
                valid = parse_int(act.get("valid_land_pixels")) or 0
                expected = parse_int(act.get("expected_land_pixels_per_day") or act.get("expected")) or expected_default
                fire_low = parse_int(act.get("fire_pixels_low"))
                fire_high = parse_int(act.get("fire_pixels_nominal_high"))
                cov = round(valid / expected, 4) if (expected and expected > 0) else None
                cloud_ok = cov is not None and cov >= min_valid_coverage
                if valid > 0 and fire_high is not None and (cov is None or cloud_ok):
                    rate = round(fire_high / valid, 6)
                else:
                    rate = None
                    if valid == 0:
                        fire_low = None
                        fire_high = None
                src_prod = str(act.get("source_product") or product_default)
                proc_ver = str(act.get("processing_version") or processing_version)

            lst_pct = parse_float(env.get("lst_valid_pixel_pct"))
            t_suelo = parse_float(env.get("t_suelo_c"))
            if lst_pct is not None and lst_pct < DEFAULT_MIN_LST_VALID_PCT:
                t_suelo = None

            rec = {
                "date": d,
                "territory_type": t_type,
                "territory_id": t_id,
                "sensor": sensor,
                "fire_pixels_low": fire_low,
                "fire_pixels_nominal_high": fire_high,
                "valid_land_pixels": valid,
                "expected_land_pixels_per_day": expected,
                "observation_coverage": cov,
                "cloud_ok_lt30pct": bool(cov is not None and cov >= min_valid_coverage),
                "activity_rate": rate,
                "t_amb_c": parse_float(env.get("t_amb_c")),
                "relative_humidity_2m_pct": parse_float(env.get("relative_humidity_2m_pct")),
                "t_suelo_c": t_suelo,
                "lst_valid_pixel_pct": lst_pct,
                "wind_dir_deg": parse_float(env.get("wind_dir_deg")),
                "wind_speed_10m_ms": parse_float(env.get("wind_speed_10m_ms")),
                "elevation_m": parse_float(env.get("elevation_m")),
                "dem_source": env.get("dem_source") or None,
                "source_product": src_prod,
                "processing_version": proc_ver,
            }
            records.append(rec)

    records.sort(key=lambda r: (r["date"], r["territory_type"], r["territory_id"], r["sensor"]))
    return records


def _weighted_and_arithmetic_mean(values_weights: list[tuple[float | None, float]]) -> tuple[float | None, float | None]:
    valid_pairs = [(v, w) for v, w in values_weights if v is not None]
    if not valid_pairs:
        return None, None
    arith = sum(v for v, _ in valid_pairs) / len(valid_pairs)
    w_sum = sum(w for _, w in valid_pairs if w > 0)
    if w_sum > 0:
        weighted = sum(v * w for v, w in valid_pairs if w > 0) / w_sum
    else:
        weighted = arith
    return round(arith, 3), round(weighted, 3)


def aggregate_daily_env_monthly(daily_records: list[dict[str, Any]]) -> dict[tuple[str, str, str], dict[str, Any]]:
    """Agrega variables ambientales diarias por (period_id, territory_type, territory_id).

    Deduplica por fecha para no contar dos veces el mismo día cuando hay múltiples sensores.
    Calcula media aritmética, media ponderada por cobertura válida y viento vectorial.
    """
    dedup_by_day: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in daily_records:
        k = (row["date"], row["territory_type"], row["territory_id"])
        existing = dedup_by_day.get(k)
        cov = row.get("observation_coverage") or 0.0
        if existing is None or cov > (existing.get("observation_coverage") or 0.0):
            dedup_by_day[k] = row

    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for (d, t_type, t_id), row in dedup_by_day.items():
        grouped[(d[:7], t_type, t_id)].append(row)

    out: dict[tuple[str, str, str], dict[str, Any]] = {}
    for key, rows in grouped.items():
        weights = [float(r.get("observation_coverage") or 0.0) for r in rows]
        lst_weights = [
            float(r["lst_valid_pixel_pct"]) / 100.0 if r.get("lst_valid_pixel_pct") is not None else w
            for r, w in zip(rows, weights)
        ]

        t_amb_arith, t_amb_w = _weighted_and_arithmetic_mean([(r.get("t_amb_c"), w) for r, w in zip(rows, weights)])
        rh_arith, rh_w = _weighted_and_arithmetic_mean(
            [(r.get("relative_humidity_2m_pct"), w) for r, w in zip(rows, weights)]
        )
        t_suelo_arith, t_suelo_w = _weighted_and_arithmetic_mean(
            [(r.get("t_suelo_c"), w) for r, w in zip(rows, lst_weights)]
        )
        ws_arith, ws_w = _weighted_and_arithmetic_mean([(r.get("wind_speed_10m_ms"), w) for r, w in zip(rows, weights)])
        elev_arith, _ = _weighted_and_arithmetic_mean([(r.get("elevation_m"), 1.0) for r in rows])

        # Promedio vectorial ponderado para dirección y magnitud de viento
        u_acc = 0.0
        v_acc = 0.0
        vec_w = 0.0
        has_pos_w = any(w > 0 for w in weights)
        for r, w in zip(rows, weights):
            wd = r.get("wind_dir_deg")
            ws = r.get("wind_speed_10m_ms")
            if wd is None or ws is None:
                continue
            eff_w = w if w > 0 else (0.0 if has_pos_w else 1.0)
            if eff_w <= 0:
                continue
            rad = math.radians(wd)
            u = -ws * math.sin(rad)
            v = -ws * math.cos(rad)
            u_acc += u * eff_w
            v_acc += v * eff_w
            vec_w += eff_w

        wind_dir_vec: float | None = None
        if vec_w > 0:
            u_mean = u_acc / vec_w
            v_mean = v_acc / vec_w
            if abs(u_mean) > 1e-9 or abs(v_mean) > 1e-9:
                wind_dir_vec = round((math.degrees(math.atan2(-u_mean, -v_mean)) + 360.0) % 360.0, 1)

        dem_sources = [r["dem_source"] for r in rows if r.get("dem_source")]
        out[key] = {
            "t_amb_c": t_amb_w if t_amb_w is not None else t_amb_arith,
            "t_amb_c_arithmetic": t_amb_arith,
            "relative_humidity_2m_pct": rh_w if rh_w is not None else rh_arith,
            "relative_humidity_2m_pct_arithmetic": rh_arith,
            "t_suelo_c": t_suelo_w if t_suelo_w is not None else t_suelo_arith,
            "t_suelo_c_arithmetic": t_suelo_arith,
            "wind_speed_10m_ms": ws_w if ws_w is not None else ws_arith,
            "wind_speed_10m_ms_arithmetic": ws_arith,
            "wind_dir_deg": wind_dir_vec,
            "elevation_m": elev_arith,
            "dem_source": dem_sources[0] if dem_sources else None,
        }
    return out


def summarize_monthly_activity(daily_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Agrega los registros diarios por (period_id, territory_type, territory_id, sensor)."""
    grouped: dict[tuple[str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in daily_records:
        key = (row["date"][:7], row["territory_type"], row["territory_id"], row["sensor"])
        grouped[key].append(row)

    summaries: list[dict[str, Any]] = []
    for (period_id, t_type, t_id, sensor), rows in sorted(grouped.items()):
        rows_by_date = {r["date"]: r for r in rows}
        year, month = int(period_id[:4]), int(period_id[5:7])
        days_in_month = calendar.monthrange(year, month)[1]

        valid_pixel_days = 0
        fire_8_9 = 0
        fire_7_9 = 0
        active_days = 0
        streak = 0
        max_streak = 0
        expected_per_day: int | None = None
        source_product = SENSOR_DEFAULT_PRODUCT.get(sensor, "")
        processing_version = PROCESSING_VERSION

        for day_num in range(1, days_in_month + 1):
            d_str = f"{period_id}-{day_num:02d}"
            r = rows_by_date.get(d_str)
            if r is None:
                streak = 0
                continue
            if expected_per_day is None and r.get("expected_land_pixels_per_day"):
                expected_per_day = int(r["expected_land_pixels_per_day"])
            if r.get("source_product"):
                source_product = str(r["source_product"])
            if r.get("processing_version"):
                processing_version = str(r["processing_version"])

            valid = int(r.get("valid_land_pixels") or 0)
            valid_pixel_days += valid
            if valid <= 0:
                streak = 0
                continue

            fh = r.get("fire_pixels_nominal_high")
            fl = r.get("fire_pixels_low")
            fh_int = int(fh) if fh is not None else 0
            fl_int = int(fl) if fl is not None else 0
            fire_8_9 += fh_int
            fire_7_9 += fh_int + fl_int
            if fh_int > 0:
                active_days += 1
                streak += 1
                if streak > max_streak:
                    max_streak = streak
            else:
                streak = 0

        expected_pixel_days = (expected_per_day * days_in_month) if expected_per_day else None
        obs_cov = (
            round(valid_pixel_days / expected_pixel_days, 4)
            if (expected_pixel_days and expected_pixel_days > 0)
            else None
        )
        activity_rate = round(fire_8_9 / valid_pixel_days, 6) if valid_pixel_days > 0 else None

        summaries.append(
            {
                "period_id": period_id,
                "territory_type": t_type,
                "territory_id": t_id,
                "sensor": sensor,
                "fire_pixel_days_8_9": fire_8_9 if valid_pixel_days > 0 else None,
                "fire_pixel_days_7_9": fire_7_9 if valid_pixel_days > 0 else None,
                "valid_land_pixel_days": valid_pixel_days,
                "expected_land_pixel_days": expected_pixel_days,
                "activity_rate": activity_rate,
                "observation_coverage": obs_cov,
                "active_days": active_days if valid_pixel_days > 0 else None,
                "max_consecutive_active_days": max_streak if valid_pixel_days > 0 else None,
                "historical_anomaly": {
                    "value": None,
                    "status": "insufficient_baseline",
                    "baseline_years": 0,
                },
                "source_product": source_product,
                "processing_version": processing_version,
            }
        )

    return summaries
