// McHanaq — GEE Monthly Environmental Context Pipeline
// Exporta environmental_context.csv para el árbol de susceptibilidad contextual (N0..N3).
// Variables: MapBiomas Perú Col. 4 (vegetación/agua), MOD13A3 (NDVI), ERA5-Land (precip_30d_mm, soil_moisture_surface), DEM (pendiente + aspecto).

var TERRITORIES_ASSET = 'projects/mchanaq/assets/territories_peru'; // Ajustar al asset de Angelo
var MAPBIOMAS_ASSET = 'projects/mapbiomas-public/assets/peru/collection4/mapbiomas_peru_collection4_integration_v1'; // Verificar ID exacto en peru.mapbiomas.org
var YEAR_START = 2018;
var YEAR_END = 2025; // Inclusivo
var MONTH_LIST = [9]; // Ejemplo: [9] para septiembre de cada año (comparación estacional); poner [1,2,...,12] si se desea anual completo
var SLOPE_HIGH_DEG = 15; // Umbral de pendiente elevada en grados
var PROCESSING_VERSION = '0.1.0';

var territories = ee.FeatureCollection(TERRITORIES_ASSET);
var mapbiomas = ee.Image(MAPBIOMAS_ASSET);

// Clases MapBiomas Perú (verificar leyenda oficial de Col. 4 antes de correr):
// Combustibles potenciales: bosque (3,4,5,6), matorral/herbazal/pastizal (11,12,13), mosaico/agricultura (15,18,19,20,21,39,40,41,62)
var FUEL_CLASSES = [3, 4, 5, 6, 11, 12, 13, 15, 18, 19, 20, 21, 39, 40, 41, 62];
var WATER_CLASSES = [26, 33]; // Agua y humedales/superficie hídrica

// Topografía estática (pendiente y orientación/aspecto para Fase 1 y Fase 2)
var demCop = ee.ImageCollection('COPERNICUS/DEM/GLO30').mosaic().select('DEM');
var terrain = ee.Terrain.products(demCop);
var steepMask = terrain.select('slope').gte(SLOPE_HIGH_DEG).multiply(100).rename('slope_class_area_pct');
var aspectMean = terrain.select('aspect').rename('aspect_mean_deg');
var topoStats = ee.Image.cat([steepMask, aspectMean]).reduceRegions({
  collection: territories,
  reducer: ee.Reducer.mean(),
  scale: 30
});

var years = ee.List.sequence(YEAR_START, YEAR_END);
var months = ee.List(MONTH_LIST);

var rows = years.map(function(y) {
  y = ee.Number(y);
  // MapBiomas Col. 4 llega hasta 2025; para años posteriores usar la banda más reciente disponible
  var lcYear = y.min(2025);
  var bandName = ee.String('classification_').cat(lcYear.format('%d'));
  var lc = mapbiomas.select(bandName);

  var vegMask = lc.remap(FUEL_CLASSES, ee.List.repeat(100, FUEL_CLASSES.length), 0).rename('vegetation_area_pct');
  var waterMask = lc.remap(WATER_CLASSES, ee.List.repeat(100, WATER_CLASSES.length), 0).rename('water_area_pct');
  var lcByTerr = ee.Image.cat([vegMask, waterMask]).reduceRegions({
    collection: topoStats,
    reducer: ee.Reducer.mean(),
    scale: 30
  });

  return months.map(function(m) {
    m = ee.Number(m);
    var dStart = ee.Date.fromYMD(y, m, 1);
    var dEnd = dStart.advance(1, 'month');
    var periodId = dStart.format('YYYY-MM');

    // Precipitación acumulada 30 días (ERA5-Land total_precipitation_hourly en m -> mm) y humedad del suelo
    var eraMonth = ee.ImageCollection('ECMWF/ERA5_LAND/HOURLY')
      .filterDate(dStart, dEnd)
      .filterBounds(territories);
    var precip30 = eraMonth.select('total_precipitation_hourly').sum().multiply(1000).rename('precip_30d_mm');
    var soilM = eraMonth.select('volumetric_soil_water_layer_1').mean().rename('soil_moisture_surface');

    // NDVI mensual MOD13A3 (DetailedQA bits 0-1 == 0 o 1, escala 0.0001)
    var mod13 = ee.ImageCollection('MODIS/061/MOD13A3').filterDate(dStart, dEnd).filterBounds(territories);
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

    var envImg = ee.Image.cat([precip30, soilM, ndviImg]);

    return envImg.reduceRegions({
      collection: lcByTerr,
      reducer: ee.Reducer.mean(),
      scale: 1000
    }).map(function(f) {
      return f.set({
        period_id: periodId,
        landcover_year: lcYear,
        dem_source: 'COPERNICUS_DEM_GLO30',
        source_product: 'MAPBIOMAS_C4+ERA5_LAND+MOD13A3',
        processing_version: PROCESSING_VERSION
      });
    });
  });
}).flatten().flatten();

Export.table.toDrive({
  collection: rows,
  description: 'environmental_context_' + YEAR_START + '_' + YEAR_END,
  folder: 'McHanaq_GEE',
  fileFormat: 'CSV',
  selectors: [
    'period_id', 'territory_type', 'territory_id', 'landcover_year',
    'vegetation_area_pct', 'water_area_pct',
    'ndvi_median', 'precip_30d_mm', 'soil_moisture_surface',
    'slope_class_area_pct', 'aspect_mean_deg', 'dem_source',
    'source_product', 'processing_version'
  ]
});
