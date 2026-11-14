// McHanaq — Script de exportación GEE para Ucayali (Ventana común verificada)
// Ventana común multisensor verificada: 2012-01-19 a 2026-11-02 (último mes completo: 2026-10)
// Incluye:
//   1. Terreno estático (COPERNICUS/DEM/GLO30): elevación y fracción con pendiente >= 15%
//   2. Focos diarios separados por sensor (MOD14A1, MYD14A1, VNP14A1) con control de nubes (< 30%)
//   3. Clima diario ERA5-Land (T_amb, HR Magnus-Tetens, viento vectorial u10/v10) + LST (MOD11A1 / VNP21A1D)
//
// Uso recomendado: ejecutar por bloques de 1-2 años dentro de [2012-01-19, 2026-11-03).

var USE_UPLOADED_ASSET = false; // Cambiar a true tras subir data/processed/ucayali_territories.geojson como Asset
var UCAYALI_ASSET = 'projects/mchanaq/assets/ucayali_territories';

// Bloque temporal a exportar (dentro de la ventana común 2012-01-19 .. 2026-11-03 exclusivo)
var BLOCK_START = '2024-01-01';
var BLOCK_END   = '2025-01-01'; // Para el último tramo usar '2026-11-03' (incluye 2026-11-02)
var SENSOR      = 'VIIRS_SNPP'; // 'MODIS_TERRA' | 'MODIS_AQUA' | 'VIIRS_SNPP'
var LST_SOURCE  = 'VIIRS';      // 'MODIS' (MOD11A1) | 'VIIRS' (VNP21A1D)
var PROCESSING_VERSION = '0.2.0-ucayali';

var territories = USE_UPLOADED_ASSET
  ? ee.FeatureCollection(UCAYALI_ASSET)
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
// 1. Terreno estático: Elevación + Pendiente >= 15% (COPERNICUS GLO-30)
// ---------------------------------------------------------------------------
var dem = ee.ImageCollection('COPERNICUS/DEM/GLO30')
  .filterBounds(territories)
  .mosaic()
  .select('DEM')
  .rename('elevation_m');

var slopeDeg = ee.Terrain.slope(dem);
var slopePct = slopeDeg.multiply(Math.PI / 180).tan().multiply(100).rename('slope_pct');
var slopeGe15 = slopePct.gte(15).rename('slope_ge_15pct_fraction');

var terrainStatic = ee.Image.cat([dem, slopePct, slopeGe15]).reduceRegions({
  collection: territories,
  reducer: ee.Reducer.mean(),
  scale: 30
}).map(function(f) {
  return f.set({
    dem_source: 'COPERNICUS_DEM_GLO30',
    slope_threshold_pct: 15
  });
});

Export.table.toDrive({
  collection: terrainStatic,
  description: 'ucayali_terrain_slope15_static',
  folder: 'McHanaq_GEE_Ucayali',
  fileFormat: 'CSV',
  selectors: [
    'territory_type', 'territory_id', 'territory_name',
    'elevation_m', 'slope_pct', 'slope_ge_15pct_fraction',
    'slope_threshold_pct', 'dem_source'
  ]
});

// ---------------------------------------------------------------------------
// 2. Focos diarios por sensor (sin sumar entre sensores)
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
// 3. Clima diario (ERA5-Land) + LST (MOD11A1 o VNP21A1D)
// ---------------------------------------------------------------------------
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
  var eraDay = ee.Image(ee.Algorithms.If(hasEra, eraDayCol.first(), ee.Image.constant([273.15, 273.15, 0, 0]).rename(['temperature_2m', 'dewpoint_temperature_2m', 'u_component_of_wind_10m', 'v_component_of_wind_10m'])));

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
    collection: territories,
    reducer: ee.Reducer.mean(),
    scale: 1000
  }).map(function(f) {
    var u = ee.Number(f.get('u10'));
    var v = ee.Number(f.get('v10'));
    var windSpeed = u.hypot(v);
    var windDir = u.multiply(-1).atan2(v.multiply(-1)).multiply(180 / Math.PI).add(360).mod(360);
    var lstPct = ee.Number(f.get('lst_valid')).multiply(100);
    var tSueloFinal = ee.Algorithms.If(lstPct.gte(70), f.get('t_suelo_c'), null);

    return f.set({
      date: dateStr,
      t_suelo_c: tSueloFinal,
      lst_valid_pixel_pct: lstPct,
      wind_speed_10m_ms: windSpeed,
      wind_dir_deg: windDir,
      lst_source: LST_SOURCE
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
    'wind_dir_deg', 'wind_speed_10m_ms'
  ]
});
