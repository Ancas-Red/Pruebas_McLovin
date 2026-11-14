"""Anomalía histórica estacional robusta mediante mediana y MAD."""

from __future__ import annotations

from collections import defaultdict
from statistics import median
from typing import Any

MIN_BASELINE_YEARS = 5
MIN_COVERAGE_FOR_BASELINE = 0.5
MAD_SCALE = 1.4826


def attach_historical_anomalies(
    summary_items: list[dict[str, Any]],
    *,
    min_baseline_years: int = MIN_BASELINE_YEARS,
    min_coverage: float = MIN_COVERAGE_FOR_BASELINE,
) -> list[dict[str, Any]]:
    """Calcula `historical_anomaly` comparando el mismo mes calendario entre años previos."""
    buckets: dict[tuple[str, str, str, str], list[tuple[int, float]]] = defaultdict(list)

    for row in summary_items:
        rate = row.get("activity_rate")
        cov = row.get("observation_coverage")
        if rate is None or cov is None or cov < min_coverage:
            continue
        year = int(row["period_id"][:4])
        cal_month = row["period_id"][5:7]
        key = (row["territory_type"], row["territory_id"], row["sensor"], cal_month)
        buckets[key].append((year, float(rate)))

    for row in summary_items:
        rate = row.get("activity_rate")
        cov = row.get("observation_coverage")
        if rate is None or (cov is not None and cov < min_coverage):
            row["historical_anomaly"] = {
                "value": None,
                "status": "not_estimable" if cov is not None and cov < min_coverage else "insufficient_baseline",
                "baseline_years": 0,
            }
            continue

        year = int(row["period_id"][:4])
        cal_month = row["period_id"][5:7]
        key = (row["territory_type"], row["territory_id"], row["sensor"], cal_month)
        hist_rates = [r for y, r in buckets[key] if y != year]

        if len(hist_rates) < min_baseline_years:
            row["historical_anomaly"] = {
                "value": None,
                "status": "insufficient_baseline",
                "baseline_years": len(hist_rates),
            }
            continue

        med = median(hist_rates)
        mad = median([abs(r - med) for r in hist_rates])
        if mad <= 1e-12:
            row["historical_anomaly"] = {
                "value": None,
                "status": "not_estimable",
                "baseline_years": len(hist_rates),
            }
            continue

        robust_z = round((float(rate) - med) / (MAD_SCALE * mad), 3)
        row["historical_anomaly"] = {
            "value": robust_z,
            "status": "estimated",
            "baseline_years": len(hist_rates),
        }

    return summary_items
