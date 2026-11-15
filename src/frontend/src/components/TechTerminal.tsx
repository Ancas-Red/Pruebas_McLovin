import { useEffect, useState } from "react";

type SessionId = "bash" | "python" | "api";

type LineKind = "prompt" | "cmd" | "accent" | "kv" | "ok" | "code" | "muted" | "spacer";

interface TermLine {
  kind: LineKind;
  text: string;
}

interface TermSession {
  id: SessionId;
  label: string;
  hostPrompt: string;
  lines: TermLine[];
}

const SESSIONS: TermSession[] = [
  {
    id: "bash",
    label: "BASH",
    hostPrompt: "mchanaq@peru ~/McHanaq %",
    lines: [
      { kind: "cmd", text: "$ python -m src.analytics.run_pipeline --processed data/processed" },
      { kind: "spacer", text: "" },
      { kind: "accent", text: "> [[ MCHANAQ PIPELINE · PERÚ ]]" },
      { kind: "kv", text: "> window........: 2012-01-19 -> 2026-11-02 (14.8 yr)" },
      { kind: "kv", text: "> sensors.......: MODIS_TERRA | MODIS_AQUA | VIIRS_SNPP" },
      { kind: "kv", text: "> cloud_gate....: observation_coverage >= 0.70" },
      { kind: "kv", text: "> water_buffer..: 150 m (JRC GSW + CobVeg)" },
      { kind: "kv", text: "> artifacts.....: metadata.json, activity_daily.json, territories.geojson" },
      { kind: "ok", text: "> status........: READY (solo lectura · 0 llamadas a GEE por HTTP)" },
    ],
  },
  {
    id: "python",
    label: "PYTHON",
    hostPrompt: "python 3.11 · src/analytics/decision_rules.py",
    lines: [
      { kind: "code", text: ">>> from src.analytics.decision_rules import assess_conditions" },
      { kind: "code", text: ">>> items = assess_conditions(" },
      { kind: "code", text: "...     env_context_rows," },
      { kind: "code", text: "...     umbral_veg_pct=20.0," },
      { kind: "code", text: "...     umbral_pend_pct=15.0," },
      { kind: "code", text: "...     min_baseline_years=5," },
      { kind: "code", text: "... )" },
      { kind: "spacer", text: "" },
      { kind: "ok", text: '[{"territory_id": "2501", "classification": "high", "confidence": "high"}]' },
    ],
  },
  {
    id: "api",
    label: "API",
    hostPrompt: "fastapi + uvicorn · /api/v1",
    lines: [
      {
        kind: "cmd",
        text: '$ curl -s "/api/v1/territories/province/2501/sensor-comparison?date=2026-10-15"',
      },
      { kind: "muted", text: "HTTP/1.1 200 OK · cache-control: public, max-age=300" },
      { kind: "code", text: "{" },
      { kind: "code", text: '  "territory": { "type": "province", "id": "2501" },' },
      { kind: "code", text: '  "date": "2026-10-15",' },
      { kind: "code", text: '  "sensors": {' },
      { kind: "kv", text: '    "MODIS_TERRA": { "observation_coverage": 0.89, "activity_rate": 0.42 },' },
      { kind: "kv", text: '    "VIIRS_SNPP":  { "observation_coverage": 0.94, "activity_rate": 0.68 }' },
      { kind: "code", text: "  }," },
      { kind: "ok", text: '  "note": "sin suma cruzada entre sensores; null != 0"' },
      { kind: "code", text: "}" },
    ],
  },
];

export function TechTerminal() {
  const [sessionIdx, setSessionIdx] = useState(0);
  const [lineIdx, setLineIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  const session = SESSIONS[sessionIdx];
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const selectSession = (idx: number) => {
    setSessionIdx(idx);
    if (reduceMotion) {
      setLineIdx(SESSIONS[idx].lines.length);
      setCharIdx(0);
    } else {
      setLineIdx(0);
      setCharIdx(0);
      setPaused(false);
    }
  };

  useEffect(() => {
    if (reduceMotion) {
      setLineIdx(session.lines.length);
      setCharIdx(0);
      return;
    }

    if (paused) return;

    if (lineIdx >= session.lines.length) {
      const pauseId = window.setTimeout(() => {
        setSessionIdx((prev) => (prev + 1) % SESSIONS.length);
        setLineIdx(0);
        setCharIdx(0);
      }, 4200);
      return () => window.clearTimeout(pauseId);
    }

    const currentLine = session.lines[lineIdx];
    if (currentLine.kind === "spacer") {
      const nextId = window.setTimeout(() => {
        setLineIdx((l) => l + 1);
        setCharIdx(0);
      }, 70);
      return () => window.clearTimeout(nextId);
    }

    const isTypedInput =
      currentLine.kind === "cmd" ||
      (session.id === "python" && currentLine.kind === "code");

    if (isTypedInput && charIdx < currentLine.text.length) {
      const charId = window.setTimeout(() => {
        setCharIdx((c) => Math.min(currentLine.text.length, c + 3));
      }, 16);
      return () => window.clearTimeout(charId);
    }

    const lineDoneId = window.setTimeout(
      () => {
        setLineIdx((l) => l + 1);
        setCharIdx(0);
      },
      isTypedInput ? 120 : 95
    );
    return () => window.clearTimeout(lineDoneId);
  }, [session, sessionIdx, lineIdx, charIdx, paused, reduceMotion]);

  return (
    <div
      className="tech-term"
      role="region"
      aria-label="Terminal interactiva del flujo técnico de McHanaq"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="tech-term__bar">
        <span className="tech-term__host">{session.hostPrompt}</span>
        <div className="tech-term__tabs" role="tablist" aria-label="Lenguajes del flujo">
          {SESSIONS.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              className="tech-term__tab"
              aria-selected={sessionIdx === idx}
              onClick={() => selectSession(idx)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="tech-term__body">
        {session.lines.map((line, i) => {
          if (i > lineIdx) return null;
          const isCurrent = i === lineIdx && lineIdx < session.lines.length;
          const isTypedInput =
            line.kind === "cmd" || (session.id === "python" && line.kind === "code");
          const shown =
            isCurrent && isTypedInput ? line.text.slice(0, charIdx) : line.text;

          if (line.kind === "spacer") {
            return <div key={i} className="tech-term__spacer" aria-hidden="true" />;
          }

          return (
            <div key={i} className={`tech-term__line tech-term__line--${line.kind}`}>
              <span>{shown}</span>
              {isCurrent && !reduceMotion && <span className="tech-term__cursor" aria-hidden="true" />}
            </div>
          );
        })}

        {lineIdx >= session.lines.length && !reduceMotion && (
          <div className="tech-term__line tech-term__line--muted">
            <span>$ </span>
            <span className="tech-term__cursor" aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}
