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

## Alcance metodológico de susceptibilidad (`decision_rules.py` vs. protocolo CENEPRED/SERFOR)

El árbol de decisión (`N0 -> N3` en `src/analytics/decision_rules.py`) calcula **susceptibilidad contextual a la expansión** por unidad territorial (`province` y `hydro_unit`) usando reglas transparentes y percentiles estacionales propios (`p25`/`p75` por territorio y mes calendario, con mínimo `5` años de línea base):

* **Alineación con factores condicionantes del Perú:** incorpora cobertura vegetal oficial del MINAM (`CobVeg_180615.shp`, excluyendo agua/no combustibles, `umbral_veg = 20%` y atenuación `high -> moderate` cuando `water_buffer_150m_pct >= 5%` o `water_area_pct >= 5%`), pendiente (`COPERNICUS_DEM_GLO30`, `umbral_pend = 15%`) y variables hidrometeorológicas diarias/mensuales de ERA5-Land (`precip_30d_mm`, `soil_moisture_surface`, `wind_speed_10m_ms`, `temperature_2m_c`, `relative_humidity_2m_pct`).
* **Diferencias frente a un Escenario de Riesgo oficial (CENEPRED/SERFOR):**
  1. **Factor desencadenante antrópico:** `thermal_history_elevated` se registra como modificador informativo, pero no se modelan variables de presión humana (distancia a vías, centros poblados o frontera agrícola).
  2. **Combustible binario:** las clases vegetales de `CobVeg_180615.shp` se agrupan como presencia/ausencia de combustible sin ponderación diferencial de inflamabilidad por tipo de cobertura.
  3. **Escala territorial agregada:** evalúa polígonos completos (provincia / cuenca Pfafstetter nivel 4) en 3 clases (`high`, `moderate`, `low`) en lugar de mapas ráster continuos AHP en 4 niveles (*Muy Alto, Alto, Medio, Bajo*).
  4. **Sin elementos expuestos:** no estima riesgo (susceptibilidad × población/infraestructura/ANP) ni probabilidad de ignición.
