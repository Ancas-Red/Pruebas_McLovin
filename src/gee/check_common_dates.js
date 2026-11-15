// Script simple de Google Earth Engine usado por Angelo para verificar
// el rango real de fechas disponibles por sensor e interceptar la ventana comun.
// Estado: ejecutado con exito; resultados guardados en gee_verified_dates.json.

var collections = [
  { name: 'MOD14A1 (Terra Focos)', id: 'MODIS/061/MOD14A1' },
  { name: 'MYD14A1 (Aqua Focos)',  id: 'MODIS/061/MYD14A1' },
  { name: 'VNP14A1 (VIIRS Focos)', id: 'NOAA/VIIRS/001/VNP14A1' },
  { name: 'MOD11A1 (Terra LST)',   id: 'MODIS/061/MOD11A1' },
  { name: 'VNP21A1D (VIIRS LST)',  id: 'NOAA/VIIRS/001/VNP21A1D' },
  { name: 'ERA5-Land (Clima/Viento)', id: 'ECMWF/ERA5_LAND/DAILY_AGGR' }
];

var starts = [];
var ends = [];

collections.forEach(function(item) {
  var col = ee.ImageCollection(item.id);
  var range = col.reduceColumns(ee.Reducer.minMax(), ['system:time_start']);
  var minDate = ee.Date(range.get('min')).format('YYYY-MM-dd');
  var maxDate = ee.Date(range.get('max')).format('YYYY-MM-dd');
  print(item.name + ' -> desde:', minDate, 'hasta:', maxDate);
  starts.push(ee.Number(range.get('min')));
  ends.push(ee.Number(range.get('max')));
});

var commonStart = ee.Date(ee.List(starts).reduce(ee.Reducer.max())).format('YYYY-MM-dd');
var commonEnd = ee.Date(ee.List(ends).reduce(ee.Reducer.min())).format('YYYY-MM-dd');

print('=== VENTANA COMUN EXACTA ===');
print('Inicio comun:', commonStart);
print('Fin comun:', commonEnd);
