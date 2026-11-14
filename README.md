# McHanaq

**NASA Space Apps Challenge 2026 — reto *Harmonization of MODIS and VIIRS Hot Spots***
Equipo: Los McLovin · Perú

Calendario territorial de actividad térmica a partir de MODIS y VIIRS, con comparación
multisensor, anomalías estacionales, árbol de susceptibilidad contextual y una simulación
exploratoria de recorrido de fuego.

---

## Estructura

```
McHanaq/
├── docs/
│   └── hamess/          # FUENTE VERDADERA: documentos que mandan sobre el código
│       ├── documento-tecnico-operativo.md
│       ├── arquitectura-frontend-backend.md
│       └── README.md
└── src/
    ├── backend/         # Angelo + Tom — FastAPI de solo lectura
    └── frontend/        # Sebastian — React + Vite + TypeScript + Leaflet
```

Si el código y `docs/hamess/` no coinciden, manda `docs/hamess/`.

## Arrancar el frontend

```bash
cd src/frontend
npm install
npm run dev          # http://localhost:5173
```

El frontend solo habla con `/api/v1`. Vite reenvía esa ruta a `http://localhost:8000`.
Mientras el backend no responda, la interfaz usa su juego de datos de muestra y lo
indica de forma visible en el encabezado y en la barra de estado.

```bash
npm run build        # genera dist/
npm run typecheck
```

## Qué hace la aplicación

Son dos páginas, con el mismo encabezado para pasar de una a otra.

### Inicio — `#/`

Portada de desplazamiento por bloques a pantalla completa, sobre un planeta animado:
presentación, el problema, la solución, el flujo de datos, **el equipo** y el alcance.
La navegación lateral de puntos salta a cada bloque.

### Mapa — `#/mapa`

La herramienta, con dos vistas:

| Vista | Contenido |
|---|---|
| **Calendario** | Mapa del Perú con focos por sensor, selección de área por polígono, rectángulo o coordenadas, calendario de años × meses, serie diaria, indicadores, comparación multisensor y árbol de susceptibilidad. |
| **Simulación** | Recorrido exploratorio desde una ignición hipotética, con viento, humedad del combustible, vegetación, pendiente y horizonte configurables. |

Los paneles laterales se **pliegan** uno a uno, y el botón **Solo mapa** recoge todo
para dejar el mapa a pantalla completa.

Descargas: focos en CSV, calendario en CSV y área de interés en GeoJSON. Cada archivo
lleva una columna `data_origin` que dice si la fila viene del backend o del juego de muestra.

## Fotos del equipo

Cada integrante deja su foto en `src/frontend/public/equipo/` con su nombre de archivo
(`angelo.jpg`, `tom.jpg`, `jhan.jpg`, `sebastian.jpg`, `jean-pierrer.jpg`). No hay que
tocar código: si el archivo no está, la tarjeta muestra un monograma con las iniciales.
Las instrucciones completas están en `src/frontend/public/equipo/README.md`.

## Límites que la interfaz declara siempre

- Un foco térmico es una anomalía detectada, no un incendio confirmado ni un perímetro.
- Nube y falta de dato no son ausencia de fuego: se muestran como cobertura, nunca como cero.
- Los conteos no se suman entre sensores. Cada uno se compara contra su propio umbral estacional.
- La susceptibilidad es un índice cualitativo basado en reglas, sin validar contra incendios reales.
- La simulación de recorrido **no predice** dónde ni cuándo habrá un incendio. Parte de una
  ignición hipotética que pone el usuario y no sirve para decisiones operativas.

## Ramas

| Rama | Responsable | Carpeta |
|---|---|---|
| `feature/frontend-dashboard` | Sebastian | `src/frontend/` |
| `feature/api-backend` | backend | `src/backend/` |
| `feature/gee-data-pipeline` | Angelo | pipeline GEE |
| `feature/analytics-engine` | Tom | analítica |
| `feature/product-qa-demo` | Jean Pierrer | docs, fixtures, QA, demo |

Sin commits directos a `main`.

## Créditos de datos

Productos de focos activos: MODIS MOD14A1.061 y MYD14A1.061, VIIRS VNP14A1.002 (NASA LP DAAC).
Contexto ambiental: ERA5-Land (Copernicus/ECMWF), SRTM, MapBiomas Perú.
Mapas base: OpenStreetMap y CARTO, OpenTopoMap, Esri World Imagery.
El listado completo con versiones y licencias se mantiene en `docs/hamess/`.
