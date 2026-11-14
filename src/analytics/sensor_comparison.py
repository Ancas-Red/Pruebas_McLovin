"""Comparación multisensor sin sumar conteos brutos entre instrumentos."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

SENSORS_ORDER = ("MODIS_TERRA", "MODIS_AQUA", "VIIRS_SNPP")
MIN_COVERAGE_COMPARISON = 0.5
ELEVATED_ROBUST_Z = 2.0
METHOD_VERSION = "0.1.0"

INTERPRETATIONS = {
    "concordant_elevated": "Al menos dos sensores comparables señalan actividad anómala elevada respecto a su patrón estacional.",
    "concordant_not_elevated": "Los sensores comparables coinciden en que la actividad no supera su umbral estacional.",
    "discordant": "Los sensores no muestran una señal estacional concordante; revisar cobertura, hora de sobrevuelo y diferencias instrumentales.",
    "single_sensor": "Solo un sensor alcanza cobertura y línea base suficientes; no es posible contrastar señales entre instrumentos.",
    "insufficient": "Ningún sensor alcanza cobertura y línea base suficientes para comparar en este período.",
}


def build_sensor_comparisons(
    summary_items: list[dict[str, Any]],
    *,
    min_coverage: float = MIN_COVERAGE_COMPARISON,
    elevated_z: float = ELEVATED_ROBUST_Z,
    method_version: str = METHOD_VERSION,
) -> list[dict[str, Any]]:
    """Genera los registros de `sensor_comparison.json` por territorio y mes."""
    grouped: dict[tuple[str, str, str], dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in summary_items:
        grouped[(row["period_id"], row["territory_type"], row["territory_id"])][row["sensor"]] = row

    comparisons: list[dict[str, Any]] = []
    for (period_id, t_type, t_id), by_sensor in sorted(grouped.items()):
        sensors_out: dict[str, dict[str, Any]] = {}
        elevated_cnt = 0
        not_elevated_cnt = 0
        usable_cnt = 0

        for sensor in SENSORS_ORDER:
            row = by_sensor.get(sensor)
            if not row:
                sensors_out[sensor] = {
                    "available": False,
                    "activity_rate": None,
                    "historical_anomaly": None,
                    "observation_coverage": 0.0,
                    "signal_status": None,
                }
                continue

            cov = row.get("observation_coverage")
            anom = row.get("historical_anomaly") or {}
            anom_val = anom.get("value")
            anom_status = anom.get("status")
            usable = cov is not None and cov >= min_coverage and anom_status == "estimated" and anom_val is not None

            signal_status: str | None = None
            if usable:
                usable_cnt += 1
                if float(anom_val) >= elevated_z:
                    signal_status = "elevated"
                    elevated_cnt += 1
                else:
                    signal_status = "not_elevated"
                    not_elevated_cnt += 1

            sensors_out[sensor] = {
                "available": row.get("valid_land_pixel_days", 0) > 0,
                "activity_rate": row.get("activity_rate"),
                "historical_anomaly": anom_val,
                "observation_coverage": cov if cov is not None else 0.0,
                "signal_status": signal_status,
            }

        if usable_cnt == 0:
            status = "insufficient"
        elif usable_cnt == 1:
            status = "single_sensor"
        elif elevated_cnt >= 2 and not_elevated_cnt == 0:
            status = "concordant_elevated"
        elif not_elevated_cnt >= 2 and elevated_cnt == 0:
            status = "concordant_not_elevated"
        elif elevated_cnt > 0 and not_elevated_cnt > 0:
            status = "discordant"
        else:
            status = "concordant_not_elevated"

        comparisons.append(
            {
                "period_id": period_id,
                "territory_type": t_type,
                "territory_id": t_id,
                "status": status,
                "sensors": sensors_out,
                "interpretation": INTERPRETATIONS[status],
                "method_version": method_version,
            }
        )

    return comparisons
