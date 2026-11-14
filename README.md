# McHanaq

Calendario longitudinal de actividad térmica (MODIS Terra/Aqua y VIIRS S-NPP) con contexto ambiental, susceptibilidad contextual y comparación multisensor.

## Documentación principal

* [Documento técnico y operativo v1.7](docs/McHanaq_documento_tecnico_operativo_v1.7.md)
* [Arquitectura frontend ↔ backend y procesamiento longitudinal (v1.2)](docs/arquitectura_frontend_backend_McHanaq.md)
* [Descripción del reto](docs/reto.txt)

## Estructura del repositorio

```text
McHanaq/
├── contracts/        # Contrato de API y esquemas JSON (Jean / Jhan)
├── gee/              # Pipelines de Google Earth Engine (Angelo)
├── analytics/        # Métricas, anomalías y reglas en Python (Tom)
├── backend/          # API FastAPI /api/v1 (Jhan; Fase A temporal: Tom)
├── frontend/         # Dashboard React + Vite (Sebastian)
├── data/
│   ├── reference/    # Capas territoriales oficiales de referencia (Jean)
│   ├── fixtures/     # Datos sintéticos para desarrollo/pruebas (Jean)
│   ├── intermediate/ # Exportaciones GEE crudas (ignorado en Git)
│   └── processed/    # JSON/GeoJSON listos para la API
├── tests/            # Pruebas unitarias y de aceptación
├── docs/             # Documentación técnica y metodológica
└── presentation/     # Deck y guion de exposición (Jean Pierrer)
```

## Ramas del equipo

| Rama | Responsable | Carpeta principal |
|---|---|---|
| `feature/gee-data-pipeline` | Angelo | `gee/` |
| `feature/analytics-engine` | Tom | `analytics/` |
| `feature/api-backend` | Jhan | `backend/` |
| `feature/frontend-dashboard` | Sebastian | `frontend/` |
| `feature/product-qa-demo` | Jean Pierrer | `data/reference/`, `contracts/`, `data/fixtures/`, `docs/`, `tests/acceptance/`, `presentation/` |

## Inicio rápido

```bash
git clone https://github.com/TomJordan1/McHanaq.git
cd McHanaq
git checkout <tu-rama>
```

* **Motor geoespacial:** Google Earth Engine (exportando `daily_activity.csv` y `environmental_daily.csv` por bloques de 1–2 años sobre el área piloto).
* **Backend en modo fixtures:**
  * Bash/Linux/macOS: `MCHANAQ_DATA_DIR=data/fixtures MCHANAQ_NO_CACHE=1 uvicorn backend.app.main:app --port 8000`
  * Windows PowerShell: `$env:MCHANAQ_DATA_DIR="data/fixtures"; $env:MCHANAQ_NO_CACHE="1"; uvicorn backend.app.main:app --port 8000`
