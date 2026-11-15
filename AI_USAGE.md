# AI Usage & Transparency Disclosure — McHanaq

**Project:** McHanaq — Harmonized Burning Activity Calendar & Contextual Susceptibility Explorer
**Event:** NASA Space Apps Challenge 2026 (*Harmonization of MODIS and VIIRS Hot Spots*)
**Team:** Los McLovin (Angelo, Tom, Jhan, Sebastian, Jean Pierrer)

In accordance with **NASA Space Apps Challenge 2026** eligibility and transparency guidelines, this document discloses all Generative AI and LLM-assisted tools used during the hackathon, the components affected, and the human verification performed by the team.

---

## 1. Summary of AI Tools & Models Used

| Tool / Platform | Role in Workflow | Scope |
|---|---|---|
| **Antigravity IDE / Gemini coding agents** | Architecture review, analytics/backend/frontend code scaffolding, contract alignment, acceptance test authoring, and documentation drafting | Code, tests, contracts, docs |
| **LLM assistants (ChatGPT / Claude)** | Literature synthesis, NASA/GEE band-bitmask verification notes, bilingual (ES/EN) copyediting, and slide structure review | Documentation & presentation text |

---

## 2. Component-by-Component Disclosure

| Component / Files | AI Intervention Type | Specific Tasks Assisted | Human Verification Performed |
|---|---|---|---|
| **Architecture & Methodology** (`docs/McHanaq_documento_tecnico_operativo_v1.7.md`, `docs/arquitectura_frontend_backend_McHanaq.md`, `docs/harness/README.md`) | Synthesis, editing, structural alignment | Drafting unified API rules, daily vs. monthly separation, Ucayali pilot addendum (`CobVeg_180615.shp`, 150 m water buffer), and documentation cross-references | Reviewed by all 5 team members against official challenge requirements (`docs/reto.txt`) and verified GEE collection availability (`src/gee/gee_verified_dates.json`). |
| **Geospatial Pipeline** (`src/gee/*.js`, `src/gee/prepare_ucayali_layers.py`) | Code scaffolding & code review | Structuring Earth Engine export scripts (`MOD14A1`, `MYD14A1`, `VNP14A1`, `MOD11A1`, `VNP21A1D`, `ERA5-Land`, `MOD13A3`, `COPERNICUS/DEM/GLO30`), `FireMask`/`QA` bitwise extraction, and GeoPandas 150 m water-buffer spatial statistics for `2012-01-19` to `2026-11-02` | Verified manually by **Angelo** against GEE Data Catalog band specs and executed on official INEI 2023, ANA Pfafstetter level 4, and MINAM `CobVeg_180615.shp` layers to produce `data/processed/territories.geojson`. |
| **Analytics Engine** (`src/analytics/*.py`) | Code generation, refactoring, debugging | Implementing daily cloud filtering (`<30%`), `null`-preserving aggregations, weighted/vector wind monthly summaries, `robust_z` (median/MAD) historical anomalies, multisensor concordance labels, and the `N0..N3b` + 150 m buffer decision tree | Reviewed and verified by **Tom**; formulas checked manually and validated with `pytest` unit tests (`tests/test_analytics.py`). |
| **Read-Only API Backend & Deploy** (`src/backend/app/main.py`, `infra/azure/`, `requirements.txt`) | Code generation & code review | FastAPI endpoint routing (`GET /` warm-up probe + all 10 `/api/v1` routes including `/calendar`), CORS normalization + `MCHANAQ_CORS_ORIGIN_REGEX` (`*.pages.dev`), error handling (`400`/`404`/`422`/`500`), and CSV streaming | Reviewed and verified by **Tom** (Phase A owner, planned handover with **Jhan**); validated against `contracts/api-contract.md` via `pytest` (`tests/smoke_test.py` and `tests/acceptance/test_mvp_acceptance.py`). |
| **Frontend Dashboard** (`src/frontend/src/**`) | UI/UX scaffolding, TypeScript typing, code review | React + Vite + TypeScript + Leaflet components (`#/`, `#/mapa`, `#/tecnologia`), `OrbitalLoader`, `GuidedTour`, `TechTerminal`, `Starfield`, Cividis colorblind-safe palettes, API client + fixture fallback labeling, and decoupled Phase 2 heuristic spread visualization (`src/frontend/src/lib/spread.ts`) | Verified in headless Chromium / Playwright across desktop, tablet, and mobile viewports against `uvicorn`, checking `#/` scroll crossfade + Los McLovin cards, `#/tecnologia` interactive terminal, `#/mapa` fixtures fallback, and zero console/overflow errors. |
| **Contracts, Fixtures & Acceptance QA** (`contracts/`, `data/fixtures/`, `tests/acceptance/test_mvp_acceptance.py`, `presentation/README.md`, `AI_USAGE.md`) | Drafting, test generation, bilingual structuring | Updating `/calendar` contract, writing automated MVP acceptance tests, preparing `AI_USAGE.md`, and structuring the 7-slide Space Apps outline and 30-second video script | Verified by **Jean Pierrer** and **Tom** against the 18-point MVP checklist (§13 of technical doc v1.7) and executed via `pytest`. |

---

## 3. Compliance with NASA Space Apps 2026 Eligibility Rules

1. **Zero AI-Generated Fake Satellite Imagery, Maps, or Observation Results:**
   * All active fire and environmental data come exclusively from authoritative sources: **NASA LP DAAC / FIRMS** (`MOD14A1.061`, `MYD14A1.061`, `VNP14A1.002`, `MOD11A1.061`, `VNP21A1D`, `MOD13A3.061`), **Copernicus / ECMWF** (`ERA5_LAND/DAILY_AGGR`, `COPERNICUS/DEM/GLO30` across the operational `2012-01-19` to `2026-11-02` common window; pre-2012 `NASADEM` retired as legacy), **MINAM** (`CobVeg_180615.shp`), **INEI 2023**, and **ANA** (Pfafstetter level 4 hydrographic units).
   * Synthetic datasets in `data/fixtures/` are deterministic test fixtures generated by `data/fixtures/generate_fixtures.py`, explicitly tagged `"data_origin": "fixture"` in JSON payloads and UI status banners, and are **never** presented as real satellite observations.
   * No generative image, diffusion, or video model was used to fabricate satellite scenes, maps, charts, or UI screenshots. All visual demonstrations originate directly from the working application.
2. **Zero AI-Generated or Altered NASA Branding:**
   * No NASA logos, insignias, flags, seals, or official identity assets were generated, edited, or embedded using AI tools.
3. **Human Scientific Responsibility:**
   * AI did not autonomously choose scientific thresholds or override domain constraints. All non-negotiable rules — separating `MODIS_TERRA`, `MODIS_AQUA`, and `VIIRS_SNPP` without cross-sensor count summing, preserving `null` instead of `0` on unobserved/cloudy days (`<30%` cloud-free filter), requiring `min_baseline_years = 5` for `robust_z`, and labeling contextual susceptibility as qualitative (not ignition or spread prediction) — were defined, reviewed, and tested by the human team.
