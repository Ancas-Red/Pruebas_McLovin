# Fase 2 — Simulación Espacial de Propagación de Fuego (48 h) con SAVI, Topografía y Viento Horario

**Proyecto:** McHanaq (NASA Space Apps Challenge 2026)  
**Estado:** Opcional y desacoplada de la Fase 1 (Arquitectura v1.2 §12)  
**Modelo:** `heuristic_wind_slope_spread_v1` (extensión horaria 48 h en Python)

---

## 1. Marco Metodológico, Documental y Normativo de Referencia (Argentina)

El diseño de la simulación espacial de propagación de Fase 2 adapta al territorio piloto peruano (Ucayali y extensibilidad nacional) el flujo técnico del taller **"Simulación Espacial de Incendios Forestales en Argentina | Pronosticá la Propagación del Fuego"** de **GIS Dev Academy** (`https://www.youtube.com/watch?v=6vFqDo5cKpA`, caso de estudio **Capilla del Monte, Valle de Punilla, Córdoba, Argentina**) y se fundamenta en el marco normativo, científico y espacial argentino:

1. **Marco legal y operativo nacional (SNMF / SMN):**
   * **Ley Nacional N.º 26.815 — Sistema Federal de Manejo del Fuego** (Argentina) y protocolos del **Servicio Nacional de Manejo del Fuego (SNMF)** para el monitoreo de comportamiento del fuego, índices de peligro meteorológico (**FWI** — *Fire Weather Index*) y planificación táctica en emergencias ígneas.
   * Integración con pronósticos horarios de viento en superficie (10 m) provenientes de modelos numéricos meteorológicos (**ERA5-Land Hourly** / **NOAA GFS / Open-Meteo API**), siguiendo los estándares operativos de análisis meteorológico de incendio en coordinación con el **Servicio Meteorológico Nacional (SMN)**.

2. **Marco espacial y de simulación computacional (CONAE – Instituto Gulich – UNC):**
   * **Comisión Nacional de Actividades Espaciales (CONAE)** e **Instituto de Altos Estudios Espaciales "Mario Gulich" (CONAE – Universidad Nacional de Córdoba / FaMAF)**: desarrollos aplicados a emergencias ambientales y respuesta temprana frente a incendios de vegetación (sistema **SARTiv** — *Sistema de Alerta y Respuesta Temprana a Incendios de Vegetación*).
   * **Modelado por Autómatas Celulares (AC) y propagación elíptica en grilla ráster:** basado en las líneas de investigación del Instituto Gulich / FaMAF-UNC (*"Desarrollo del Motor de Cálculo de un Simulador de Incendios Forestales"*, dir. Dr. Marcelo Scavuzzo y Dr. Elvio Pilotta), acoplando reglas discretas celda a celda sobre una malla georreferenciada con propagación direccional elíptica clásica:
     * **Rothermel (1972):** amortiguamiento por humedad de combustible fino y tasa base de avance ($R_0$).
     * **Anderson (1983) y Alexander (1985):** relación largo/ancho ($L/B$) y excentricidad de la elipse de fuego en función de la velocidad del viento a 10 m.
     * **Huete (1988):** índice de vegetación ajustado al suelo (**SAVI**) para estimar biomasa/combustible disponible minimizando el sesgo de suelo desnudo en coberturas abiertas o heterogéneas.

> [!IMPORTANT]
> **Alcance científico y descargo obligatorio (Regla McHanaq §6 y §12):**  
> Esta simulación es una **proyección exploratoria condicional a un punto de ignición hipotético o foco detectado**. No predice dónde ni cuándo se iniciará un incendio, no estima probabilidad de ignición, no ha sido calibrada con cicatrices históricas locales y **no sustituye modelos físicos operativos en tiempo real ni protocolos de alerta, despacho o evacuación**.

---

## 2. Arquitectura del Modelo en Python (`src/analytics/spread_model.py`)

El motor de Fase 2 opera sobre una grilla espacial regular proyectada en metros (UTM / proyección local métrica) centrada en el foco de ignición o territorio seleccionado, avanzando hora por hora hasta completar un horizonte de **48 horas** (`Hora 01` → `Hora 48`).

### 2.1. Entradas combinadas

| Capa | Variable | Fuente en McHanaq / Externa | Rol en el Autómata Celular |
|---|---|---|---|
| **Vegetación / Combustible** | **SAVI** (`[-1, 1]`) | Bandas NIR y RED (Sentinel-2 / Landsat / MODIS) o `GeoTIFF` exportado de GEE; respaldo parametrizado por `vegetation_area_pct` / `CobVeg_180615.shp` | Modula la carga y continuidad del combustible por celda ($f_{ij} \in [0, 1]$). Valores bajos (`SAVI <= 0.12`, agua o suelo desnudo) actúan como barrera no combustible. |
| **Topografía** | **Elevación ($z$)** y **Pendiente ($\theta$)** | `COPERNICUS_DEM_GLO30` (30 m) vía GEE / `GeoTIFF` local o relieve sintético calibrado con `slope_class_area_pct` | Calcula la pendiente direccional entre celda origen $i$ y celda vecina $j$: $\theta_{ij} = \arctan\!\left(\frac{z_j - z_i}{d_{ij}}\right)$. |
| **Meteorología (48 h)** | **Viento horario** (`wind_speed_10m_ms`, `wind_dir_deg`) | Serie horaria de 48 pasos (`ERA5-Land Hourly`, **Open-Meteo API** o perfil horario determinista derivado del día seleccionado) | Define hora a hora la velocidad de cabeza ($R_{\text{head}}(h)$), el eje principal de avance ($\alpha_{\text{to}} = (\alpha_{\text{from}} + 180^\circ) \bmod 360^\circ$) y la elongación elíptica $L/B(U_h)$. |
| **Humedad del combustible** | `fuel_moisture_pct` | Estimada desde `precip_30d_mm`, `relative_humidity_2m_pct` y `t_amb_c` | Aplica el factor cuadrático de extinción ($M_{\text{ext}} = 30\,\%$). |

### 2.2. Formulación matemática

1. **Índice SAVI (Huete, 1988):**
   $$\text{SAVI} = \frac{\text{NIR} - \text{RED}}{\text{NIR} + \text{RED} + L} \cdot (1 + L), \quad L = 0.5$$
   La carga de combustible normalizada por celda se obtiene escalando $\text{SAVI}_{ij}$ sobre el umbral mínimo combustible ($\text{SAVI}_{\min} = 0.12$) hasta saturación ($\text{SAVI}_{\max} = 0.78$).

2. **Relación Largo/Ancho y Excentricidad Elíptica (Anderson, 1983):**
   $$\frac{L}{B}(U) = \operatorname{clip}\!\left(0.936\,e^{0.2566\,U} + 0.461\,e^{-0.1548\,U} - 0.397,\; 1,\; 8\right), \quad e = \frac{\sqrt{(L/B)^2 - 1}}{L/B}$$
   donde $U$ es la velocidad horaria del viento a 10 m ($\text{m/s}$). El factor direccional desde el foco de la elipse en la dirección unitaria $\hat{u}$ respecto al vector de avance del viento $\hat{w}(h)$ es:
   $$E(\hat{u}, h) = \frac{1 - e(h)}{\max(0.05,\; 1 - e(h)\,(\hat{u}\cdot\hat{w}(h)))}$$

3. **Factor de Pendiente ($\phi_s$) y Tasa de Propagación ($ROS$):**
   $$\phi_s(\theta) = \begin{cases} \min(8,\; e^{0.0693\,\theta}) & \text{si } \theta \ge 0^\circ \text{ (duplica cada } +10^\circ\text{)} \\ \max(0.35,\; e^{0.03465\,\theta}) & \text{si } \theta < 0^\circ \text{ (freno pendiente abajo)} \end{cases}$$
   $$ROS_{i \to j}(h) = R_0 \cdot (1 + 0.72\,U_h^{1.22}) \cdot \left(1 - \min\!\left(1,\frac{M_f}{30}\right)\right)^2 \cdot \left(0.4 + 0.6\,f_j\right) \cdot E(\hat{u}_{ij}, h) \cdot \phi_s(\theta_{ij})$$

4. **Integración horaria hasta 48 h:**
   El algoritmo resuelve el tiempo mínimo de llegada $T_{ij}$ en minutos sobre vecindad de Moore (8 vecinos), evaluando la hora activa $h = \lfloor t / 60 \rfloor + 1 \in \{1,\dots,48\}$ para actualizar el vector horario de viento durante el cruce de cada celda.

---

## 3. Productos Generados por Fase 2

Al ejecutar `python -m src.analytics.spread_model`, el pipeline exporta en `data/processed/spread_outputs/` y `data/processed/spread_forecasts.json`:

| Producto | Formato | Contenido |
|---|---|---|
| `simulacion_48h.gif` | GIF animado (48 frames) | Avance celular hora por hora (`Hora 01` a `Hora 48`) con vector de viento horario, fondo SAVI/pendiente y área acumulada en hectáreas. |
| `pronostico_48h.mp4` | Video MP4 (H.264) | Misma animación de 48 h lista para presentaciones, reportes y visor web. |
| `shapefiles/*.shp` + `mchanaq_propagacion_48h_qgis.zip` | Shapefiles ESRI (`.shp/.shx/.dbf/.prj/.cpg`, WGS84) | `isocronas_48h.shp` (`+6h`, `+12h`, `+24h`, `+36h`, `+48h`), `celdas_horarias_48h.shp` (hora de llegada `1..48`, SAVI y pendiente), `ignicion_y_viento_48h.shp` (punto de inicio y trayectoria horaria) y `vectores_viento_48h.shp` (vectores horarios cada 3 h). |
| `panel_modelo_48h.png` | Infografía PNG (300 DPI) | Panel triple comparativo: **SAVI** \| **Pendiente + Viento 48h** \| **Simulación 48hs del Modelo** con métricas horarias y resumen de salidas. |
| `infografia_impacto_48h.png` | Infografía Ejecutiva PNG (300 DPI) | Lámina técnica oscura lista para reporte: mapa territorial con isócronas `+6h..+48h`, rampas **SAVI** y **PENDIENTE**, recuadros de **VIENTO** y **SIMULACIÓN**, resumen **OUTPUTS GIS** e impacto acumulado en hectáreas. |
| `data/processed/spread_forecasts.json` | JSON / GeoJSON contrato §12.2 | Alimenta `GET /api/v1/territories/{type}/{id}/spread-forecast` y permite consulta directa desde el frontend. |

---

## 4. Cómo Conectar Datos Reales de GEE o Focos Específicos

El módulo funciona de manera autónoma con los datos territoriales de McHanaq (`territories.geojson`, `conditions_assessment.json`, `activity_daily.json` o `hotspots.geojson`), pero admite directamente insumos reales de mayor resolución espacial:

1. **Ráster SAVI (`--savi-tif ruta/savi.tif`):** exportado desde Google Earth Engine (Sentinel-2 o Landsat 8/9) para el área de estudio.
2. **Ráster DEM (`--dem-tif ruta/dem.tif`):** `COPERNICUS/DEM/GLO30` a 30 m para calcular pendientes exactas píxel a píxel.
3. **Viento horario real (`--open-meteo`):** consulta directa a Open-Meteo (`https://api.open-meteo.com/v1/forecast` o archivo histórico ERA5) en lugar del perfil horario sintetizado desde `environmental_daily`.
4. **Coordenadas y fecha específicas (`--lat`, `--lon`, `--date`, `--territory-type`, `--territory-id`):** permite apuntar a cualquier foco FIRMS real o coordenada de interés (ej. Ucayali o cualquier provincia del Perú).

---

## 5. Evaluación Mundial vía APIs, Modo Liviano Azure F1 y Flujo UI

Para evaluar propagación desde **cualquier coordenada del mundo** sin bloquear la interfaz web ni agotar el servidor (Plan Free F1), el flujo separa el cálculo interactivo de la exportación multimedia pesada:

1. **Integración global por APIs (`use_open_meteo=true`, `use_global_savi`, `/api/v1/realtime/area` y `/api/v1/reverse-geocode`):**
   * **Vegetación / Combustible global (SAVI real):** Sentinel-2 L2A vía **Microsoft Planetary Computer STAC API** (`sentinel-2-l2a`, bandas `B04` RED y `B08` NIR con firma SAS pública sin API key; `savi_source = SENTINEL2_L2A_PLANETARY_COMPUTER`) cuando `use_global_savi=true` (activo por defecto si `use_open_meteo=true` y no se pasa `--savi-tif`).
   * **Meteorología horaria 48 h:** Open-Meteo Forecast/Archive API (`wind_speed_10m`, `wind_direction_10m`, `temperature_2m`, `relative_humidity_2m`), seleccionando libremente cualquier fecha desde la interfaz (**`Fecha de inicio (48 h)`**, botón **"Próximas 48 h (hoy)"** o **"Usar fecha del calendario"**).
   * **Topografía global (DEM):** Open-Meteo Elevation API (`https://api.open-meteo.com/v1/elevation`, fuente `COPERNICUS_DEM_GLO90_OPEN_METEO`), muestreada en grilla `8×8` sobre el dominio de `11×11 km` e interpolada bilinealmente a `120×120` celdas en el motor completo (`spread_model.py`), o muestreada en grilla `4×4` en el fallback liviano del backend.
   * **Geocodificación administrativa global (`GET /api/v1/reverse-geocode`):** resuelve país, región/estado, provincia/condado y ciudad/distrito vía **OSM Nominatim** (`OSM_NOMINATIM`) para cualquier par `(lat, lon)` con caché en memoria; también se incluye como bloque `location` dentro de `GET /api/v1/realtime/area`.
   * **Focos activos globales NRT:** `GET /api/v1/realtime/area` consulta NASA FIRMS Area API (`MODIS_NRT`, `VIIRS_SNPP_NRT`, `VIIRS_NOAA20_NRT` sin mezclar sensores) cuando se configura `FIRMS_MAP_KEY`.
   * *Nota:* Si no hay conectividad externa o no existe escena Sentinel-2 con nubosidad `< 35 %`, el motor degrada deterministamente a `COPERNICUS_DEM_GLO30_PARAMETRIC`, `era5_daily_diurnal_profile` y `SAVI_HUETE1988_VEG_CALIBRATED`.
2. **Paso 1 — Simulación interactiva instantánea (`POST|GET /api/v1/spread-simulate`):**
   * En entornos locales/analíticos completos ejecuta `simulate_spread_48h` y devuelve el JSON/GeoJSON con isócronas (`+6h..+48h`), métricas (`SAVI`, pendiente, `ROS`, `L/B`), `data_sources` y `timings_s`.
   * **Modo liviano en Python puro (Azure App Service Free F1):** cuando el runtime solo dispone de `fastapi`, `uvicorn` y `httpx` (sin `geopandas`, `numpy`, `matplotlib` o `rasterio`), `src/backend/app/main.py` activa automáticamente `_run_lightweight_global_spread` + `_fetch_open_meteo_dem_slope_py`: consulta Open-Meteo Elevation (`COPERNICUS_DEM_GLO90_OPEN_METEO`, grilla `4×4`) y Open-Meteo actual vía `httpx` para devolver `slope_summary`, `dominant_wind`, `spread_summary` (`head_ros_m_min`, `length_to_breadth`) y `data_sources` sin dependencias GIS pesadas.
3. **Paso 2 — Exportación bajo demanda y previsualización (`POST|GET /api/v1/spread-export` → `GET /api/v1/spread-outputs/{filename}`):**
   * Genera bajo demanda los 5 artefactos descargables (`simulacion_48h.gif`, `pronostico_48h.mp4`, `mchanaq_propagacion_48h_qgis.zip`, `infografia_impacto_48h.png`, `panel_modelo_48h.png`), devolviendo las URLs y los tiempos medidos (`timings_s`). Si faltan las librerías GIS/video en el servidor liviano, responde `503 EXPORT_LIBS_UNAVAILABLE` mientras mantiene activas las descargas precalculadas en `/api/v1/spread-outputs/{filename}`.
   * **Optimización de renderizado:** `export_animation_gif_mp4` reutiliza la figura y el fondo estático mediante *blitting* en Matplotlib (`copy_from_bbox` / `restore_region` / `draw_artist`) y cuantización rápida (`FASTOCTREE` sin *dithering*) en Pillow.
4. **Flujo operativo en la interfaz (`src/frontend/src/components/SpreadRail.tsx` y `GuidedTour.tsx`):**
   * **Simulación rápida global · 1 clic (`Open-Meteo + DEM`):** botones de acceso directo para **`Ucayali`**, **`California`** y **`Grecia`**, además de campos manuales **`Latitud`** y **`Longitud`** con el botón **`Simular extensión aquí (1 clic)`** que traza el dominio, fija la ignición, consulta clima/DEM/ubicación y anima el frente sobre el mapa.
   * **Fecha de inicio (48 h):** selector de fecha con accesos rápidos **`Próximas 48 h (hoy)`** y **`Usar fecha del calendario`**.
   * **Previsualizaciones en línea (`Visualización y salidas 48 h · Python / GIS`):** los botones **`Ver GIF 48h`**, **`Ver infografía`** y **`Panel SAVI+DEM`** renderizan en línea las imágenes desde `/api/v1/spread-outputs/{filename}` sin salir del visor, junto al botón **`Generar reporte 48 h (API)`** y descargas directas (`GIF 48h`, `MP4 48h`, `Shapefiles QGIS`, `Infografía`, `Panel 48h`).
   * **Guía visual interactiva de 5 pasos (`SPREAD_TOUR_STEPS` en `? Guía`):** recorre (1) *Simulación global en 1 clic* (`spread-quick`), (2) *Ignición y clima en vivo (Open-Meteo + FIRMS)* (`spread-env`), (3) *Área libre y Condiciones físicas* (`spread-poly`), (4) *Visualización y salidas 48 h (GIF, MP4, QGIS)* (`spread-exports`) y (5) *Reproducción temporal e isócronas* (`spread-result`).

### Tiempos medidos reales (corriendo `python -m src.analytics.spread_model`, grilla `120×120`, 48 h)

| Etapa | Artefacto / Salida | Tiempo medido (local) |
|---|---|---|
| Simulación celular 48 h (`simulate_spread_48h`) | JSON/GeoJSON con isócronas `+6h..+48h` | **0.126 s** |
| Shapefiles QGIS + ZIP (`export_qgis_shapefiles`) | 4 capas `.shp` + `mchanaq_propagacion_48h_qgis.zip` | **0.070 s** |
| Infografías 300 DPI (`export_impact_infographics`) | `panel_modelo_48h.png` + `infografia_impacto_48h.png` | **1.551 s** |
| Video/GIF 48 cuadros (`export_animation_gif_mp4`) | `simulacion_48h.gif` + `pronostico_48h.mp4` | **2.487 s** |
| **Total paquete completo local** | Simulación + JSON + SHP + GIF + MP4 + 2 PNGs | **4.234 s** |

Al activar consultas en vivo a APIs externas para coordenadas globales arbitrarias, añadir ~**1–5 s** de latencia de red para viento horario Open-Meteo + elevación DEM + NASA FIRMS (y ~**2–8 s** adicionales si se incorpora lectura COG externa de Sentinel-2/SAVI en tiempo real).
