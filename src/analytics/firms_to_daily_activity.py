"""Convierte el archivo histórico de NASA FIRMS (CSV crudo, puntos de foco de calor)
en el formato `*daily_activity*.csv` que espera `src/analytics/run_pipeline.py`.

Por qué existe este script
---------------------------
El pipeline oficial calcula "actividad diaria por territorio y sensor" exportando
desde Google Earth Engine un `reduceRegions` que cuenta píxeles de fuego por
distrito/provincia/cuenca cada día (ver `src/gee/*.js`). A escala nacional ese
`reduceRegions` se queda sin memoria (Error code: 8) en GEE.

Angelo descargó el archivo histórico oficial de NASA FIRMS ya filtrado para Perú
(carpeta `firms_peru/{viirs-snpp,modis}/<sensor>_<año>_Peru.csv`, una fila por foco
detectado). Este script hace localmente, con un join espacial, lo que GEE intentaba
hacer en la nube: asigna cada foco a su territorio (provincia o cuenca, usando
`data/processed/peru_territories.geojson`) y agrega conteos por día.

Aproximación importante (léelo antes de confiar en los números)
-----------------------------------------------------------------
Los CSV de FIRMS son solo detecciones de fuego (puntos), NO incluyen la grilla
completa de píxeles observados cada día. Por eso:
  - `expected_land_pixels_per_day` se estima como área del territorio / área de un
    píxel del sensor (VIIRS ~375 m, MODIS ~1 km). Es una aproximación geométrica,
    no el conteo real de píxeles del sensor.
  - `valid_land_pixels` se asume igual a `expected_land_pixels_per_day` (se asume
    cobertura completa sin nubes), porque el archivo de puntos no dice qué parte
    del territorio estaba cubierta ese día. Esto es optimista: si hubo nubes, la
    tasa de actividad (fire/valid) sale subestimada, nunca sobreestimada.
  - La confianza de FIRMS (`confidence`) se usa para separar fire_pixels_low de
    fire_pixels_nominal_high: VIIRS usa letras l/n/h; MODIS usa 0-100 (<50 = low).

Esto es suficiente para destrabar el hackathon (evita el OOM de GEE), pero no es
un reemplazo 1:1 de un export real de píxeles. Documentarlo en el informe técnico.

Uso
---
    pip install pandas geopandas shapely --break-system-packages
    python3 -m src.analytics.firms_to_daily_activity \
        --firms-dir /ruta/a/firms_peru \
        --territories data/processed/peru_territories.geojson \
        --out data/intermediate/daily_activity_firms.csv

El resultado va a `data/intermediate/`, que es justo donde `run_pipeline.py` busca
`*daily_activity*.csv`.

Por defecto solo se queda con focos entre 2012-01-19 y 2026-11-02 (la ventana
operativa comun a MODIS_TERRA + MODIS_AQUA + VIIRS_SNPP + ERA5-Land segun
AGENTS.md). Si tu carpeta `firms_peru/` trae anios anteriores a 2012 (legacy,
solo 2 de 3 sensores), se descartan automaticamente para no inflar el tamano
del `activity_daily.json` final sin aportar nada comparable entre sensores.
Para cambiar la ventana: `--since AAAA-MM-DD --until AAAA-MM-DD`.
"""

from __future__ import annotations

import argparse
from pathlib import Path

PIXEL_AREA_KM2 = {
    "VIIRS_SNPP": 0.375 * 0.375,
    "MODIS_TERRA": 1.0 * 1.0,
    "MODIS_AQUA": 1.0 * 1.0,
}

SOURCE_PRODUCT = {
    "VIIRS_SNPP": "VNP14A1",
    "MODIS_TERRA": "MOD14A1",
    "MODIS_AQUA": "MYD14A1",
}

PROCESSING_VERSION = "0.1.0-firms-local"


def _confidence_bucket(sensor: str, raw: str) -> str:
    """Devuelve 'low' o 'nominal_high' a partir del campo confidence de FIRMS."""
    raw = (raw or "").strip().lower()
    if sensor == "VIIRS_SNPP":
        # VIIRS: letras l/n/h (low/nominal/high)
        if raw in {"l", "low"}:
            return "low"
        return "nominal_high"
    # MODIS: 0-100
    try:
        val = float(raw)
    except ValueError:
        return "nominal_high"
    return "low" if val < 50 else "nominal_high"


def _modis_sensor(raw_satellite: str) -> str | None:
    s = (raw_satellite or "").strip().lower()
    if s in {"terra", "t"}:
        return "MODIS_TERRA"
    if s in {"aqua", "a"}:
        return "MODIS_AQUA"
    return None


#: Ventana operativa oficial del proyecto (AGENTS.md): comun a MODIS_TERRA +
#: MODIS_AQUA + VIIRS_SNPP + ERA5-Land. Todo lo anterior a 2012-01-19 es
#: "legacy" fuera de alcance (solo 2 de 3 sensores, infla el tamano de los
#: JSON sin aportar nada comparable) y se descarta por defecto.
DEFAULT_SINCE = "2012-01-19"
DEFAULT_UNTIL = "2026-11-02"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--firms-dir", required=True, type=Path, help="Carpeta firms_peru/ con subcarpetas viirs-snpp/ y modis/")
    parser.add_argument("--territories", required=True, type=Path, help="GeoJSON de territorios (data/processed/peru_territories.geojson)")
    parser.add_argument("--out", required=True, type=Path, help="CSV de salida (data/intermediate/daily_activity_firms.csv)")
    parser.add_argument(
        "--since",
        default=DEFAULT_SINCE,
        help=f"Fecha minima (inclusive, YYYY-MM-DD). Por defecto {DEFAULT_SINCE}: inicio de la ventana operativa comun a los 3 sensores.",
    )
    parser.add_argument(
        "--until",
        default=DEFAULT_UNTIL,
        help=f"Fecha maxima (inclusive, YYYY-MM-DD). Por defecto {DEFAULT_UNTIL}: ultimo mes completo verificado en GEE.",
    )
    args = parser.parse_args()

    import geopandas as gpd  # import diferido: falla con mensaje claro si falta la dependencia
    import pandas as pd

    territories = gpd.read_file(args.territories)
    if territories.crs is None:
        territories = territories.set_crs("EPSG:4326")
    else:
        territories = territories.to_crs("EPSG:4326")

    # Área real por territorio (proyección UTM 18S, aproximación razonable para Perú)
    territories_m = territories.to_crs("EPSG:32718")
    territories["area_km2"] = territories_m.geometry.area / 1_000_000.0

    frames = []

    viirs_dir = args.firms_dir / "viirs-snpp"
    for csv_path in sorted(viirs_dir.glob("*.csv")):
        df = pd.read_csv(csv_path, encoding="utf-8-sig")
        df["sensor"] = "VIIRS_SNPP"
        frames.append(df)

    modis_dir = args.firms_dir / "modis"
    for csv_path in sorted(modis_dir.glob("*.csv")):
        df = pd.read_csv(csv_path, encoding="utf-8-sig")
        df["sensor"] = df["satellite"].map(_modis_sensor)
        df = df.dropna(subset=["sensor"])
        frames.append(df)

    if not frames:
        raise FileNotFoundError(
            f"No se encontraron CSV en {viirs_dir} ni {modis_dir}. "
            "Revisa que --firms-dir apunte a la carpeta firms_peru (con subcarpetas viirs-snpp/ y modis/)."
        )

    points = pd.concat(frames, ignore_index=True)
    points["date"] = points["acq_date"].astype(str).str[:10]

    n_before = len(points)
    points = points[(points["date"] >= args.since) & (points["date"] <= args.until)]
    print(
        f"Filtro de ventana [{args.since}, {args.until}]: {n_before} -> {len(points)} focos "
        f"({n_before - len(points)} descartados por estar fuera de la ventana operativa)."
    )
    if points.empty:
        raise ValueError(
            f"No quedo ningun foco dentro de [{args.since}, {args.until}]. Revisa las fechas de los CSV de entrada."
        )

    points["confidence_bucket"] = [
        _confidence_bucket(sensor, conf)
        for sensor, conf in zip(points["sensor"], points["confidence"].astype(str))
    ]

    points_gdf = gpd.GeoDataFrame(
        points,
        geometry=gpd.points_from_xy(points["longitude"], points["latitude"]),
        crs="EPSG:4326",
    )

    joined = gpd.sjoin(points_gdf, territories, how="inner", predicate="within")
    n_dropped = len(points_gdf) - len(joined)
    print(f"Focos totales: {len(points_gdf)} | asignados a un territorio: {len(joined)} | fuera de todos los polígonos: {n_dropped}")

    counts = (
        joined.groupby(["date", "territory_type", "territory_id", "sensor", "confidence_bucket"])
        .size()
        .unstack(fill_value=0)
        .reset_index()
    )
    for col in ("low", "nominal_high"):
        if col not in counts.columns:
            counts[col] = 0

    area_lookup = territories.set_index(["territory_type", "territory_id"])["area_km2"].to_dict()

    rows = []
    for _, row in counts.iterrows():
        sensor = row["sensor"]
        key = (row["territory_type"], row["territory_id"])
        area_km2 = area_lookup.get(key)
        pixel_area = PIXEL_AREA_KM2.get(sensor, 1.0)
        expected = max(1, round(area_km2 / pixel_area)) if area_km2 else 1
        fire_low = int(row["low"])
        fire_high = int(row["nominal_high"])
        rows.append(
            {
                "date": row["date"],
                "territory_type": row["territory_type"],
                "territory_id": row["territory_id"],
                "sensor": sensor,
                "valid_land_pixels": expected,  # se asume cobertura total (ver docstring)
                "expected_land_pixels_per_day": expected,
                "fire_pixels_low": fire_low,
                "fire_pixels_nominal_high": fire_low + fire_high,
                "source_product": SOURCE_PRODUCT.get(sensor, ""),
                "processing_version": PROCESSING_VERSION,
            }
        )

    out_df = pd.DataFrame(rows).sort_values(["territory_type", "territory_id", "sensor", "date"])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    out_df.to_csv(args.out, index=False)
    print(f"Listo: {len(out_df)} filas escritas en {args.out}")


if __name__ == "__main__":
    main()
