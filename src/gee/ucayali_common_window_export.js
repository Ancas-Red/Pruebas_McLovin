// McHanaq — Script de exportación GEE para Ucayali (Ventana común multisensor verificada)
// Ventana común verificada: 2012-01-19 a 2026-11-02 (último mes completo común: 2026-10)
// Coincidencia simultánea: MODIS_TERRA (MOD14A1) + MODIS_AQUA (MYD14A1) + VIIRS_SNPP (VNP14A1) + ERA5-Land (~14.8 años > 5 años mínimo de línea base).
// Decisión de equipo: ya NO se exportan bloques pre-2012 (2000–2011). Todo el flujo usa COPERNICUS/DEM/GLO30.
//
// Puente de datos (GEE -> Local -> Azure Blob Storage):
//   GEE solo exporta tablas CSV hacia Google Drive (limitación nativa de Export.table.toDrive).
//   Flujo operativo: Google Drive (descarga) -> data/intermediate/ (local) -> src/analytics/run_pipeline.py ->
//   data/processed/ -> Azure Blob Storage (puente en nube para build/deploy en Azure App Service).
//
// Incluye:
//   1. Terreno estático (COPERNICUS/DEM/GLO30): elevación, pendiente >= 15% y aspecto
//   2. Focos diarios separados por sensor (MOD14A1, MYD14A1, VNP14A1) con control de nubes (< 30%)
//   3. Clima diario ERA5-Land (T_amb, HR Magnus-Tetens, viento vectorial u10/v10) + LST (MOD11A1 / VNP21A1D) + elevation_m
//   4. Contexto mensual para compuerta N0..N3 en provincias y unidades hidrográficas (WorldCover v200 + JRC GSW buffer 150 m + DEM + ERA5-Land + MOD13A3)

var USE_UPLOADED_ASSET = true; // Subir data/processed/territories.geojson (o ucayali_territories.geojson) como Asset en GEE
var UCAYALI_ASSET = 'projects/mchanaq/assets/ucayali_territories';

// ---------------------------------------------------------------------------
// Presets oficiales de exportación dentro de la ventana común [2012-01-19, 2026-11-03)
//   Estrategia 1 — Prueba rápida:       EXPORT_PRESET = 'quick_test'       ('2024-01-01' .. '2026-11-03')
//   Estrategia 2 — Mínimo 5 años base:  EXPORT_PRESET = 'baseline_5yr_min' ('2018-01-01' .. '2026-11-03')
//   Estrategia 3 — Ventana común completa en 7 bloques de ~2 años:
//     'block_2012_2014' ('2012-01-19' .. '2014-01-01')
//     'block_2014_2016' ('2014-01-01' .. '2016-01-01')
//     'block_2016_2018' ('2016-01-01' .. '2018-01-01')
//     'block_2018_2020' ('2018-01-01' .. '2020-01-01')
//     'block_2020_2022' ('2020-01-01' .. '2022-01-01')
//     'block_2022_2024' ('2022-01-01' .. '2024-01-01')
//     'block_2024_2026' ('2024-01-01' .. '2026-11-03')  // cubre hasta 2026-11-02 inclusive
// ---------------------------------------------------------------------------
var PRESETS = {
  quick_test:       { start: '2024-01-01', end: '2026-11-03', label: 'Estrategia 1: Prueba rápida (2024-01-01..2026-11-02)' },
  baseline_5yr_min: { start: '2018-01-01', end: '2026-11-03', label: 'Estrategia 2: Mínimo 5+ años de línea base (2018-01-01..2026-11-02)' },
  block_2012_2014:  { start: '2012-01-19', end: '2014-01-01', label: 'Estrategia 3 (1/7): 2012-01-19..2013-12-31' },
  block_2014_2016:  { start: '2014-01-01', end: '2016-01-01', label: 'Estrategia 3 (2/7): 2014-01-01..2015-12-31' },
  block_2016_2018:  { start: '2016-01-01', end: '2018-01-01', label: 'Estrategia 3 (3/7): 2016-01-01..2017-12-31' },
  block_2018_2020:  { start: '2018-01-01', end: '2020-01-01', label: 'Estrategia 3 (4/7): 2018-01-01..2019-12-31' },
  block_2020_2022:  { start: '2020-01-01', end: '2022-01-01', label: 'Estrategia 3 (5/7): 2020-01-01..2021-12-31' },
  block_2022_2024:  { start: '2022-01-01', end: '2024-01-01', label: 'Estrategia 3 (6/7): 2022-01-01..2023-12-31' },
  block_2024_2026:  { start: '2024-01-01', end: '2026-11-03', label: 'Estrategia 3 (7/7): 2024-01-01..2026-11-02' }
};

var EXPORT_PRESET = 'quick_test'; // Cambiar al ejecutar cada estrategia o bloque de 2 años
var presetCfg = PRESETS[EXPORT_PRESET];
if (!presetCfg) {
  throw new Error('EXPORT_PRESET inválido: ' + EXPORT_PRESET);
}

var COMMON_WINDOW_START = '2012-01-19';
var COMMON_WINDOW_END_EXCLUSIVE = '2026-11-03'; // Incluye 2026-11-02; último mes completo común: 2026-10

var BLOCK_START = presetCfg.start;
var BLOCK_END   = presetCfg.end; // Exclusivo
if (BLOCK_START < COMMON_WINDOW_START || BLOCK_END > COMMON_WINDOW_END_EXCLUSIVE) {
  throw new Error('Fuera de la ventana común verificada [2012-01-19, 2026-11-03): ' + BLOCK_START + ' .. ' + BLOCK_END);
}

var SENSOR      = 'VIIRS_SNPP'; // 'MODIS_TERRA' | 'MODIS_AQUA' | 'VIIRS_SNPP' (ejecutar una vez por sensor en cada bloque)
var LST_SOURCE  = 'VIIRS';      // 'MODIS' (MOD11A1) | 'VIIRS' (VNP21A1D)
var PROCESSING_VERSION = '0.2.0-ucayali';

print('Preset activo:', EXPORT_PRESET, presetCfg.label, '| Sensor:', SENSOR, '| LST:', LST_SOURCE);

var territories = USE_UPLOADED_ASSET
  ? ee.FeatureCollection(UCAYALI_ASSET).filter(ee.Filter.inList('territory_type', ['province', 'hydro_unit']))
  : ee.FeatureCollection('FAO/GAUL/2015/level2')
      .filter(ee.Filter.eq('ADM0_NAME', 'Peru'))
      .filter(ee.Filter.eq('ADM1_NAME', 'Ucayali'))
      .map(function(f) {
        return f.set({
          territory_type: 'province',
          territory_id: ee.String(f.get('ADM2_CODE')),
          territory_name: f.get('ADM2_NAME')
        });
      });

// ---------------------------------------------------------------------------
// 1. Terreno estático para ventana común 2012+ (COPERNICUS/DEM/GLO30)
// ---------------------------------------------------------------------------
var demSourceName = 'COPERNICUS_DEM_GLO30';
var demImg = ee.ImageCollection('COPERNICUS/DEM/GLO30')
  .filterBounds(territories)
  .mosaic()
  .select('DEM')
  .rename('elevation_m');

var slopeDeg = ee.Terrain.slope(demImg);
var slopePct = slopeDeg.multiply(Math.PI / 180).tan().multiply(100).rename('slope_pct');
var slopeGe15 = slopePct.gte(15).rename('slope_ge_15pct_fraction');
var slopeClassAreaPct = slopeGe15.multiply(100).rename('slope_class_area_pct');
var aspectMean = ee.Terrain.aspect(demImg).rename('aspect_mean_deg');

var terrainStatic = ee.Image.cat([demImg, slopePct, slopeGe15, slopeClassAreaPct, aspectMean]).reduceRegions({
  collection: territories,
  reducer: ee.Reducer.mean(),
  scale: 30,
  tileScale: 4
}).map(function(f) {
  return f.set({
    dem_source: demSourceName,
    slope_threshold_pct: 15
  });
});

// GEE solo exporta CSVs a Google Drive -> descargar a data/intermediate/ y respaldar en Azure Blob Storage
Export.table.toDrive({
  collection: terrainStatic,
  description: 'ucayali_terrain_slope15_static_2012plus',
  folder: 'McHanaq_GEE_Ucayali',
  fileFormat: 'CSV',
  selectors: [
    'territory_type', 'territory_id', 'territory_name',
    'elevation_m', 'slope_pct', 'slope_ge_15pct_fraction',
    'slope_class_area_pct', 'aspect_mean_deg',
    'slope_threshold_pct', 'dem_source'
  ]
});

// ---------------------------------------------------------------------------
// 2. Focos diarios por sensor (sin sumar entre sensores)
// Nota de catálogo VIIRS: se usa NOAA/VIIRS/001/VNP14A1 (verificado en GEE hasta 2026-11-02);
// usar NASA/VIIRS/002/VNP14A1 si el proyecto migra a Colección 2 completa.
// ---------------------------------------------------------------------------
var SENSOR_CFG = {
  MODIS_TERRA: { col: 'MODIS/061/MOD14A1',      scale: 1000, prod: 'MOD14A1_061' },
  MODIS_AQUA:  { col: 'MODIS/061/MYD14A1',      scale: 1000, prod: 'MYD14A1_061' },
  VIIRS_SNPP:  { col: 'NOAA/VIIRS/001/VNP14A1', scale: 1000, prod: 'VNP14A1_001' }
};
var cfg = SENSOR_CFG[SENSOR];

var refLand = ee.ImageCollection(cfg.col).first().select('QA').bitwiseAnd(3).eq(2);
var expectedByTerr = refLand.rename('expected_land_pixels_per_day').reduceRegions({
  collection: territories,
  reducer: ee.Reducer.sum(),
  scale: cfg.scale
});

var fireCol = ee.ImageCollection(cfg.col)
  .filterDate(BLOCK_START, BLOCK_END)
  .filterBounds(territories);

var dailyActivity = fireCol.map(function(img) {
  var dateStr = img.date().format('YYYY-MM-dd');
  var fm = img.select('FireMask').bitwiseAnd(15);
  var isLand = img.select('QA').bitwiseAnd(3).eq(2);

  var validLand = isLand.and(fm.eq(5).or(fm.gte(7).and(fm.lte(9)))).rename('valid_land_pixels');
  var fireLow = isLand.and(fm.eq(7)).rename('fire_pixels_low');
  var fireNomHigh = isLand.and(fm.gte(8).and(fm.lte(9))).rename('fire_pixels_nominal_high');

  return ee.Image.cat([fireLow, fireNomHigh, validLand]).reduceRegions({
    collection: expectedByTerr,
    reducer: ee.Reducer.sum(),
    scale: cfg.scale
  }).map(function(f) {
    var valid = ee.Number(f.get('valid_land_pixels'));
    var expected = ee.Number(f.get('expected_land_pixels_per_day'));
    var cov = ee.Algorithms.If(expected.gt(0), valid.divide(expected), null);
    return f.set({
      date: dateStr,
      sensor: SENSOR,
      observation_coverage: cov,
      cloud_ok_lt30pct: ee.Algorithms.If(cov, ee.Number(cov).gte(0.70), false),
      source_product: cfg.prod,
      processing_version: PROCESSING_VERSION
    });
  });
}).flatten();

Export.table.toDrive({
  collection: dailyActivity,
  description: 'ucayali_daily_activity_' + SENSOR + '_' + BLOCK_START + '_' + BLOCK_END,
  folder: 'McHanaq_GEE_Ucayali',
  fileFormat: 'CSV',
  selectors: [
    'date', 'territory_type', 'territory_id', 'sensor',
    'fire_pixels_low', 'fire_pixels_nominal_high',
    'valid_land_pixels', 'expected_land_pixels_per_day', 'observation_coverage',
    'cloud_ok_lt30pct', 'source_product', 'processing_version'
  ]
});

// ---------------------------------------------------------------------------
// 3. Clima diario (ERA5-Land) + LST (MOD11A1 o VNP21A1D) + DEM Copernicus GLO-30
// Nota de catálogo VIIRS LST: NOAA/VIIRS/001/VNP21A1D (verificado) vs NASA/VIIRS/002/VNP21A1D (C2).
// ---------------------------------------------------------------------------
var terrWithDem = demImg.reduceRegions({
  collection: territories,
  reducer: ee.Reducer.mean(),
  scale: 30,
  tileScale: 4
});

var era5 = ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR')
  .filterDate(BLOCK_START, BLOCK_END)
  .filterBounds(territories);

var lstCol = LST_SOURCE === 'MODIS'
  ? ee.ImageCollection('MODIS/061/MOD11A1').filterDate(BLOCK_START, BLOCK_END).filterBounds(territories)
  : ee.ImageCollection('NOAA/VIIRS/001/VNP21A1D').filterDate(BLOCK_START, BLOCK_END).filterBounds(territories);

var nDays = ee.Date(BLOCK_END).difference(ee.Date(BLOCK_START), 'day');
var dayOffsets = ee.List.sequence(0, nDays.subtract(1));

var dailyEnv = ee.FeatureCollection(dayOffsets.map(function(offset) {
  var d0 = ee.Date(BLOCK_START).advance(offset, 'day');
  var d1 = d0.advance(1, 'day');
  var dateStr = d0.format('YYYY-MM-dd');

  var eraDayCol = era5.filterDate(d0, d1);
  var hasEra = eraDayCol.size().gt(0);
  var zeroMask = ee.Image.constant(0);
  var eraEmpty = ee.Image.constant([0, 0, 0, 0]).updateMask(zeroMask).toFloat()
    .rename(['temperature_2m', 'dewpoint_temperature_2m', 'u_component_of_wind_10m', 'v_component_of_wind_10m']);
  var eraDay = ee.Image(ee.Algorithms.If(hasEra, eraDayCol.first(), eraEmpty));

  var tAmbC = eraDay.select('temperature_2m').subtract(273.15).rename('t_amb_c');
  var tDewC = eraDay.select('dewpoint_temperature_2m').subtract(273.15).rename('t_dew_c');
  var rh = tDewC.expression(
    'min(100, max(0, 100 * exp((17.625 * Td) / (243.04 + Td)) / exp((17.625 * T) / (243.04 + T))))',
    { T: tAmbC, Td: tDewC }
  ).rename('relative_humidity_2m_pct');
  var u10 = eraDay.select('u_component_of_wind_10m').rename('u10');
  var v10 = eraDay.select('v_component_of_wind_10m').rename('v10');

  var lstDayCol = lstCol.filterDate(d0, d1);
  var hasLst = lstDayCol.size().gt(0);
  var lstEmpty = ee.Image.constant(0).updateMask(ee.Image.constant(0)).toFloat().rename('t_suelo_c')
    .addBands(ee.Image.constant(0).toFloat().rename('lst_valid'));

  var lstClean = ee.Image(ee.Algorithms.If(hasLst, (function() {
    var lstImg = lstDayCol.first();
    if (LST_SOURCE === 'MODIS') {
      var qcOk = lstImg.select('QC_Day').bitwiseAnd(3).eq(0);
      var tSuelo = lstImg.select('LST_Day_1km').multiply(0.02).subtract(273.15).updateMask(qcOk).toFloat().rename('t_suelo_c');
      return ee.Image.cat([tSuelo, qcOk.unmask(0).toFloat().rename('lst_valid')]);
    } else {
      var qcOkV = lstImg.select('QC').bitwiseAnd(3).eq(0);
      var tSueloV = lstImg.select('LST_1KM').multiply(0.02).subtract(273.15).updateMask(qcOkV).toFloat().rename('t_suelo_c');
      return ee.Image.cat([tSueloV, qcOkV.unmask(0).toFloat().rename('lst_valid')]);
    }
  })(), lstEmpty));

  return ee.Image.cat([tAmbC, rh, u10, v10, lstClean]).reduceRegions({
    collection: terrWithDem,
    reducer: ee.Reducer.mean(),
    scale: 1000
  }).map(function(f) {
    var uRaw = f.get('u10');
    var vRaw = f.get('v10');
    var hasWind = ee.Algorithms.IsEqual(uRaw, null).not().and(ee.Algorithms.IsEqual(vRaw, null).not());
    var u = ee.Number(ee.Algorithms.If(hasWind, uRaw, 0));
    var v = ee.Number(ee.Algorithms.If(hasWind, vRaw, 0));
    var windSpeed = ee.Algorithms.If(hasWind, u.hypot(v), null);
    var windDir = ee.Algorithms.If(hasWind, u.multiply(-1).atan2(v.multiply(-1)).multiply(180 / Math.PI).add(360).mod(360), null);
    var lstPct = ee.Number(f.get('lst_valid')).multiply(100);
    var tSueloFinal = ee.Algorithms.If(lstPct.gte(70), f.get('t_suelo_c'), null);

    return f.set({
      date: dateStr,
      t_suelo_c: tSueloFinal,
      lst_valid_pixel_pct: lstPct,
      wind_speed_10m_ms: windSpeed,
      wind_dir_deg: windDir,
      lst_source: LST_SOURCE,
      elevation_m: f.get('elevation_m'),
      dem_source: demSourceName
    });
  });
})).flatten();

Export.table.toDrive({
  collection: dailyEnv,
  description: 'ucayali_environmental_daily_' + LST_SOURCE + '_' + BLOCK_START + '_' + BLOCK_END,
  folder: 'McHanaq_GEE_Ucayali',
  fileFormat: 'CSV',
  selectors: [
    'date', 'territory_type', 'territory_id',
    't_amb_c', 'relative_humidity_2m_pct',
    't_suelo_c', 'lst_valid_pixel_pct', 'lst_source',
    'wind_dir_deg', 'wind_speed_10m_ms',
    'elevation_m', 'dem_source'
  ]
});

// ---------------------------------------------------------------------------
// 4. Contexto mensual para el árbol N0..N3 en TODOS los territorios (province + hydro_unit)
//    Cobertura (ESA/WorldCover/v200) + Agua/Buffer 150 m (JRC/GSW1_4/GlobalSurfaceWater) + DEM + ERA5-Land + MOD13A3
// ---------------------------------------------------------------------------
var wc = ee.ImageCollection('ESA/WorldCover/v200')
  .filterBounds(territories)
  .mosaic()
  .select('Map');
var gsw = ee.Image('JRC/GSW1_4/GlobalSurfaceWater');

var vegMask = wc.remap([10, 20, 30, 40, 95, 100], [1, 1, 1, 1, 1, 1], 0);
var waterMask = wc.eq(80).or(wc.eq(90)).or(gsw.select('occurrence').gte(50).unmask(0));
var waterBuf150 = waterMask.focalMax({ radius: 150, kernelType: 'circle', units: 'meters' });
var effVegMask = vegMask.and(waterBuf150.not());

var staticContextImg = ee.Image.cat([
  vegMask.multiply(100).rename('vegetation_area_pct'),
  waterMask.multiply(100).rename('water_area_pct'),
  waterBuf150.multiply(100).rename('water_buffer_150m_pct'),
  effVegMask.multiply(100).rename('effective_vegetation_area_pct'),
  slopeClassAreaPct,
  aspectMean
]);

var terrStaticCtx = staticContextImg.reduceRegions({
  collection: territories,
  reducer: ee.Reducer.mean(),
  scale: 30,
  tileScale: 4
});

var startDateObj = ee.Date(BLOCK_START);
var endDateObj = ee.Date(BLOCK_END);
var nMonths = endDateObj.difference(startDateObj, 'month').ceil();
var monthOffsets = ee.List.sequence(0, nMonths.subtract(1));

var monthlyContext = ee.FeatureCollection(monthOffsets.map(function(mOff) {
  var m0 = startDateObj.advance(mOff, 'month');
  var m1 = m0.advance(1, 'month');
  var periodId = m0.format('YYYY-MM');

  var eraMonth = ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR')
    .filterDate(m0, m1)
    .filterBounds(territories);
  var precip30 = eraMonth.select('total_precipitation_sum').sum().multiply(1000).rename('precip_30d_mm');
  var soilM = eraMonth.select('volumetric_soil_water_layer_1').mean().rename('soil_moisture_surface');

  var mod13 = ee.ImageCollection('MODIS/061/MOD13A3').filterDate(m0, m1).filterBounds(territories);
  var hasNdvi = mod13.size().gt(0);
  var ndviImg = ee.Image(ee.Algorithms.If(
    hasNdvi,
    (function() {
      var img = mod13.first();
      var qaOk = img.select('DetailedQA').bitwiseAnd(3).lte(1);
      return img.select('NDVI').multiply(0.0001).updateMask(qaOk).toFloat().rename('ndvi_median');
    })(),
    ee.Image.constant(0).updateMask(ee.Image.constant(0)).toFloat().rename('ndvi_median')
  ));

  return ee.Image.cat([precip30, soilM, ndviImg]).reduceRegions({
    collection: terrStaticCtx,
    reducer: ee.Reducer.mean(),
    scale: 1000
  }).map(function(f) {
    return f.set({
      period_id: periodId,
      landcover_year: 2021,
      landcover_source: 'ESA_WORLDCOVER_V200+JRC_GSW1_4',
      dem_source: demSourceName,
      source_product: 'ESA_WORLDCOVER_V200+JRC_GSW1_4+ERA5_LAND_DAILY_AGGR+MOD13A3',
      processing_version: PROCESSING_VERSION
    });
  });
})).flatten();

Export.table.toDrive({
  collection: monthlyContext,
  description: 'ucayali_environmental_context_' + BLOCK_START + '_' + BLOCK_END,
  folder: 'McHanaq_GEE_Ucayali',
  fileFormat: 'CSV',
  selectors: [
    'period_id', 'territory_type', 'territory_id',
    'landcover_year', 'landcover_source',
    'vegetation_area_pct', 'water_area_pct', 'water_buffer_150m_pct', 'effective_vegetation_area_pct',
    'ndvi_median', 'precip_30d_mm', 'soil_moisture_surface',
    'slope_class_area_pct', 'aspect_mean_deg', 'dem_source',
    'source_product', 'processing_version'
  ]
});
