# Notas para Tom (`feature/analytics-engine`) — De parte de Angelo

> **Estado:** Angelo está probando y corriendo localmente estas ecuaciones y umbrales para **Ucayali**. No se ha modificado `src/analytics/` ni `tests/` todavía en esta rama hasta obtener resultados reales en local.

## Resumen de parámetros y ecuaciones en prueba local

1. **Cobertura vegetal (`CobVeg_180615.shp` - MINAM 2015):**
   - Se considera **toda vegetación** como cobertura combustible (excluyendo cuerpos de agua, urbano y suelo desnudo).
   - Umbral de vegetación por defecto: `umbral_veg = 0.20` (20 % por distrito/unidad).
2. **Pendiente:**
   - Umbral de pendiente: `umbral_pend = 0.15` (15 %).
3. **Amortiguamiento por agua superficial:**
   - Radio de buffer: `water_buffer_m = 150.0` m (si un cuerpo de agua superficial está dentro de 150 m, se amortigua la susceptibilidad de la zona).
4. **Clima (`ERA5-Land` + `LST`):**
   - Humedad relativa (`HR %`) derivada de `T2m` y `Td2m` (Magnus-Tetens).
   - Magnitud y dirección vectorial de viento a 10 m (`u10`, `v10`).
   - `LST` MODIS/VIIRS escalado (`DN * 0.02 - 273.15` °C) filtrado por calidad y `< 30 %` de nubosidad.
   - Percentiles locales `p25`/`p75` por distrito y mes calendario (con `min_baseline_years = 5`) para el cálculo de `robust_z` y clasificación cualitativa (`high`, `moderate`, `low`, `partial`, `not_evaluable`).
5. **Ventana común multisensor verificada en GEE:**
   - `2012-01-19` a `2026-11-02` (último mes completo común: `2026-10`). Ver `gee_verified_dates.json`.
