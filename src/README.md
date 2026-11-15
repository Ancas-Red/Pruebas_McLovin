# Comandos para levantar Backend y Frontend (`src/`)

Todos los comandos se ejecutan desde la **raíz del repositorio** (`McHanaq/`), salvo que se indique lo contrario.

---

## 1. Script rápido (Frontend + Backend juntos)

### Windows (PowerShell)
```powershell
# Levanta backend (:8000) y frontend (:5173) en ventanas/procesos separados.
# Usa data/processed (Ucayali + Fase 2) si territories.geojson existe; si no, usa data/fixtures automáticamente.
.\src\dev.ps1

# Forzar fixtures explícitamente:
.\src\dev.ps1 -Fixtures
```

### Linux / macOS (Bash)
```bash
bash src/dev.sh
# O forzando fixtures:
bash src/dev.sh --fixtures
```

---

## 2. Backend (FastAPI — puerto `8000`)

### Windows (PowerShell)
```powershell
# Con datos procesados (data/processed/):
.\.venv\Scripts\python.exe -m uvicorn src.backend.app.main:app --reload --port 8000

# Con fixtures de desarrollo (data/fixtures/):
$env:MCHANAQ_DATA_DIR="data/fixtures"
$env:MCHANAQ_NO_CACHE="1"
.\.venv\Scripts\python.exe -m uvicorn src.backend.app.main:app --reload --port 8000
```

### Linux / macOS (Bash)
```bash
# Con datos procesados (data/processed/):
.venv/bin/python -m uvicorn src.backend.app.main:app --reload --port 8000

# Con fixtures de desarrollo (data/fixtures/):
MCHANAQ_DATA_DIR=data/fixtures MCHANAQ_NO_CACHE=1 .venv/bin/python -m uvicorn src.backend.app.main:app --reload --port 8000
```

> Si necesitas instalar dependencias de Python primero:
> `.\.venv\Scripts\python.exe -m pip install -r requirements.txt` (Windows) o `.venv/bin/pip install -r requirements.txt` (Linux/macOS).

---

## 3. Frontend (Vite + React — puerto `5173`)

### Windows (PowerShell)
> Nota: Si PowerShell bloquea `npm.ps1` por política de ejecución, usa `npm.cmd`.
```powershell
cd src\frontend
npm.cmd install   # solo la primera vez
npm.cmd run dev
```

### Linux / macOS (Bash)
```bash
cd src/frontend
npm install       # solo la primera vez
npm run dev
```

### Variables útiles del frontend
- `VITE_API_BASE` (por defecto `http://localhost:8000/api/v1`)
- `npm run build` / `npm.cmd run build`: compila en `src/frontend/dist/`
- `npm run typecheck` / `npm.cmd run typecheck`: verifica tipos con `tsc --noEmit`

---

## 4. URLs locales

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:8000/api/v1/health
- **Documentación OpenAPI (Swagger):** http://localhost:8000/docs
