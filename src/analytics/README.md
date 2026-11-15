# McHanaq — Módulo Analítico (`src/analytics/`)

Convierte las exportaciones crudas de Google Earth Engine (`data/intermediate/`) en los JSON precomputados para la API (`data/processed/`).

## Entradas esperadas en `data/intermediate/`

* `daily_activity*.csv` (de `src/gee/hotspots_pipeline.js`)
* `environmental_daily*.csv` (de `src/gee/environmental_daily.js`)
* `environmental_context*.csv` (de `src/gee/environmental_context.js`)
* `gee_manifest.json` (opcional; metadatos reales exportados por Angelo)

## Ejecución

```powershell
python -m src.analytics.run_pipeline
```

Si `activity_daily.json` supera el margen recomendado para **Azure App Service Free F1 / Azure Blob Storage** (< 30–40 MB totales en `data/processed/`), puedes acotar la serie diaria (por defecto `--daily-from common_window` y `--daily-to common_window`, es decir `2012-01-19` a `2026-11-02`) manteniendo la ventana común completa en `activity_summary.json`:

```powershell
python -m src.analytics.run_pipeline --daily-from 2018-01-01
```
