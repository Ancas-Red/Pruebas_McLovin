# Despliegue de McHanaq en Microsoft Azure (Free Tier)

Esta carpeta contiene la infraestructura mínima y sin costo para desplegar McHanaq en **Microsoft Azure Free Tier**, reemplazando a Google Drive como puente de almacenamiento en nube para producción (conservando `render.yaml` intacto como referencia heredada).

## Arquitectura en Azure Free Tier

* **Puente de datos (`Azure Blob Storage`, LRS):** almacena los CSVs intermedios respaldados desde `data/intermediate/` y los artefactos JSON/GeoJSON procesados (`data/processed/`).
  * *Nota sobre GEE:* Google Earth Engine solo exporta tablas CSV hacia Google Drive (`Export.table.toDrive`). Luego se descargan a `data/intermediate/`, se procesan localmente con `python -m src.analytics.run_pipeline` y los resultados de `data/processed/` se suben a Azure Blob Storage con `python -m src.analytics.azure_sync upload`.
* **Backend API (`Azure App Service Plan F1` o `B1` con créditos — Linux Python 3.11):** ejecuta `infra/azure/startup.sh` con `MCHANAQ_DATA_DIR=data/processed` en modo **solo lectura** (sin llamadas a GEE ni descargas por petición HTTP; opcionalmente descarga el snapshot de `data/processed/` una sola vez al arrancar si `AZURE_BLOB_SAS_BASE_URL` está configurado y los archivos faltan localmente). El archivo raíz `requirements.txt` permite que Oryx instale `fastapi` y `uvicorn` automáticamente.
* **Frontend (`Cloudflare Pages` — o `Azure Static Web Apps` Free):** publica `src/frontend/dist` compilado con `VITE_API_BASE` apuntando a `https://<backend>.azurewebsites.net/api/v1` (el cliente acepta también `VITE_API_BASE_URL` y normaliza `/api/v1` automáticamente). Incluye `src/frontend/public/_headers` para Cloudflare Pages y `infra/azure/staticwebapp.config.json` como alternativa en Azure SWA.

## Paso a paso con Azure CLI (`az`)

### 1. Variables base y grupo de recursos

```bash
LOCATION="eastus"
RG="rg-mchanaq-prod"
STORAGE_ACCT="mchanaqstorage$RANDOM"
APP_PLAN="asp-mchanaq-free"
BACKEND_APP="mchanaq-api-prod"
SWA_NAME="mchanaq-web-prod"

az group create --name "$RG" --location "$LOCATION"
```

### 2. Azure Blob Storage (puente para CSVs intermedios y snapshot `data/processed/`)

```bash
az storage account create \
  --name "$STORAGE_ACCT" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2

az storage container create --name "intermediate" --account-name "$STORAGE_ACCT" --auth-mode login
az storage container create --name "processed" --account-name "$STORAGE_ACCT" --auth-mode login
```

Generar un token SAS de lectura/escritura temporal para subir artefactos desde tu máquina local (y otro SAS de solo lectura para `startup.sh` en App Service):

```bash
# En local, tras correr el pipeline:
python -m src.analytics.run_pipeline --intermediate data/intermediate --processed data/processed
export AZURE_BLOB_SAS_BASE_URL="https://${STORAGE_ACCT}.blob.core.windows.net/processed?<SAS_TOKEN_RW>"
python -m src.analytics.azure_sync upload --source data/processed --pattern "*.json*"
```

### 3. Backend FastAPI en Azure App Service Free (`F1`, Linux Python 3.11)

```bash
az appservice plan create \
  --name "$APP_PLAN" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku F1 \
  --is-linux

az webapp create \
  --name "$BACKEND_APP" \
  --resource-group "$RG" \
  --plan "$APP_PLAN" \
  --runtime "PYTHON:3.11"

az webapp config set \
  --name "$BACKEND_APP" \
  --resource-group "$RG" \
  --startup-file "bash infra/azure/startup.sh"

az webapp config appsettings set \
  --name "$BACKEND_APP" \
  --resource-group "$RG" \
  --settings \
    MCHANAQ_DATA_DIR="data/processed" \
    MCHANAQ_CORS_ORIGINS="https://<tu-proyecto>.pages.dev,https://${SWA_NAME}.azurestaticapps.net,http://localhost:5173" \
    MCHANAQ_CORS_ORIGIN_REGEX="^https://([a-z0-9-]+\\.)*<tu-proyecto>\\.pages\\.dev$" \
    SCM_DO_BUILD_DURING_DEPLOYMENT=true \
    AZURE_BLOB_SAS_BASE_URL="https://${STORAGE_ACCT}.blob.core.windows.net/processed?<SAS_TOKEN_RO>"
```

Desplegar el código del repositorio (Azure Oryx instala automáticamente `requirements.txt` de la raíz del repo):

```bash
az webapp up \
  --name "$BACKEND_APP" \
  --resource-group "$RG" \
  --runtime "PYTHON:3.11"
```

### 4. Frontend en Cloudflare Pages (recomendado / equipo)

En Cloudflare Pages (`Workers & Pages -> Create -> Pages -> Connect to Git`):
* **Root directory:** `src/frontend`
* **Build command:** `npm run build`
* **Build output directory:** `dist`
* **Environment variables (Production & Preview):**
  * `VITE_API_BASE` = `https://<backend-app>.azurewebsites.net/api/v1`
  * *(opcional)* `NODE_VERSION` = `20`

### 5. Alternativa Frontend en Azure Static Web Apps (`Free`)

```bash
# Construir el frontend con la URL del backend en Azure:
cd src/frontend
VITE_API_BASE="https://${BACKEND_APP}.azurewebsites.net/api/v1" npm run build
cp ../../infra/azure/staticwebapp.config.json dist/staticwebapp.config.json
cd ../..

# Crear la Static Web App (plan Free):
az staticwebapp create \
  --name "$SWA_NAME" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku Free
```

Luego publica `src/frontend/dist` usando el token de despliegue de Static Web Apps (`az staticwebapp secrets list` + `npx @azure/static-web-apps-cli deploy ./src/frontend/dist`).
