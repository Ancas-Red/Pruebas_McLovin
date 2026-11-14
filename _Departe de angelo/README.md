# Notas de Angelo — Pruebas en curso para Ucayali (GEE + Analytics)

> **Estado:** En pruebas locales (Angelo está ejecutando y validando la extracción en Google Earth Engine y el cálculo analítico para Ucayali antes de integrar código final en `src/analytics/` o `src/gee/`).

## 1. Región piloto y capas base locales
- **Región:** Ucayali (Perú).
- **Límites políticos y unidades hidrográficas:** cargados en `data/reference/` (INEI 2023 distrital y ANA Unidades Hidrográficas).
- **Cobertura vegetal:** `CobVeg_180615.shp` (MINAM 2015). **Se considera toda vegetación** como combustible potencial (excluyendo únicamente cuerpos de agua, zonas urbanas y suelo desnudo/sin vegetación).

## 2. Parámetros iniciales en prueba (Ucayali)
- **Umbral de cobertura vegetal (`umbral_veg`):** `0.20` (20 % por distrito/unidad).
- **Umbral de pendiente (`umbral_pend`):** `0.15` (15 %).
- **Amortiguamiento por cuerpo de agua superficial:** distancia de `150 m` (amortigua/reduce la susceptibilidad en zonas cercanas a agua superficial).
- **Regla de nubosidad diaria:** `< 30 %` de cobertura de nubes para considerar un día válido.
- **Línea base histórica (`min_baseline_years`):** mínimo `5` años válidos por mes calendario para calcular `robust_z`.
- **Clima:** `ERA5-Land` (`ECMWF/ERA5_LAND/HOURLY` o `DAILY_AGGR`) para temperatura del aire (`2m`), temperatura de punto de rocío (`2m` -> Humedad Relativa por Magnus-Tetens) y viento (`u10`, `v10`), complementado con LST de MODIS/VIIRS.

## 3. Ventana temporal multisensor verificada en GEE
Fechas reales obtenidas directamente en Google Earth Engine (ver `gee_verified_dates.json` y `check_common_dates.js`):

- `MOD14A1` (Terra Focos): `2000-02-24` a `2026-11-08`
- `MYD14A1` (Aqua Focos): `2002-07-04` a `2026-11-08`
- `VNP14A1` (VIIRS Focos): `2012-01-19` a `2026-11-02`
- `MOD11A1` (Terra LST): `2000-02-24` a `2026-11-13`
- `VNP21A1D` (VIIRS LST): `2012-01-19` a `2026-11-02`
- `ERA5-Land` (Clima/Viento): `1950-01-01` a `2026-11-08`

### Ventana común exacta
- **Inicio común:** `2012-01-19`
- **Fin común:** `2026-11-02`
- **Último mes completo común:** `2026-10`

> Nota: `src/analytics/` y `tests/analytics_test.py` se mantienen aún en local mientras terminamos de correr las pruebas y obtener resultados reales.
