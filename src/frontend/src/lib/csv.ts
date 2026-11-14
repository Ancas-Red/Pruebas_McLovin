import type { Hotspot, MonthCell } from "../api/types";

function escapeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(escapeCell).join(","))].join("\n");
}

export function download(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** CSV de focos detectados en la busqueda actual. */
export function hotspotsCsv(points: Hotspot[], origin: string): string {
  const header = [
    "latitude",
    "longitude",
    "acq_date",
    "acq_time_utc",
    "sensor",
    "source_product",
    "frp_mw",
    "confidence",
    "data_origin",
  ];
  const PRODUCTS: Record<string, string> = {
    MODIS_TERRA: "MOD14A1.061",
    MODIS_AQUA: "MYD14A1.061",
    VIIRS_SNPP: "VNP14A1.002",
  };
  return toCsv(
    header,
    points.map((h) => [
      h.lat,
      h.lon,
      h.date,
      h.acq_time,
      h.sensor,
      PRODUCTS[h.sensor] ?? "",
      h.frp,
      h.confidence,
      origin,
    ])
  );
}

/** CSV del calendario mensual. */
export function calendarCsv(cells: MonthCell[], sensor: string, origin: string): string {
  const header = [
    "period_id",
    "sensor",
    "detections_class_8_9",
    "activity_rate",
    "observation_coverage",
    "active_days",
    "max_consecutive_active_days",
    "historical_anomaly_robust_z",
    "baseline_years",
    "data_origin",
  ];
  return toCsv(
    header,
    cells.map((c) => [
      `${c.year}-${String(c.month).padStart(2, "0")}`,
      sensor,
      c.detections,
      c.activity_rate === null ? "" : c.activity_rate.toExponential(4),
      c.observation_coverage.toFixed(4),
      c.active_days,
      c.max_consecutive_active_days,
      c.historical_anomaly === null ? "" : c.historical_anomaly.toFixed(3),
      c.baseline_years,
      origin,
    ])
  );
}

/** GeoJSON del area de interes dibujada. */
export function ringGeoJson(ring: [number, number][], areaKm2: number): string {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            name: "Area de interes McHanaq",
            area_km2: Math.round(areaKm2),
            generated_at: new Date().toISOString(),
          },
          geometry: {
            type: "Polygon",
            // GeoJSON es [lon, lat] y exige el anillo cerrado.
            coordinates: [[...ring.map(([lat, lon]) => [lon, lat]), [ring[0][1], ring[0][0]]]],
          },
        },
      ],
    },
    null,
    2
  );
}
