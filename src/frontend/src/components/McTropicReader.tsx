import { useEffect, useState } from "react";
import { Logo } from "./Logo";

interface ShuffleCard {
  id: string;
  tag: string;
  title: string;
  tone: "acid" | "term" | "ember" | "violet";
}

const DECK_CARDS: ShuffleCard[] = [
  {
    id: "undrr",
    tag: "UNDRR · FAO",
    title: "Susceptibility ≠ Risk",
    tone: "acid",
  },
  {
    id: "firms",
    tag: "NASA FIRMS",
    title: "FireMask 8–9 · QA = 2",
    tone: "term",
  },
  {
    id: "cenepred",
    tag: "CENEPRED",
    title: "N0–N3 Tree",
    tone: "ember",
  },
  {
    id: "ley26815",
    tag: "LAW 26.815",
    title: "SNMF · Phase 2 48 h",
    tone: "violet",
  },
];

/**
 * Escena espacial abierta en `#/convenciones`:
 * McTropic astronauta (con casco espacial y lentes estilo McLovin adaptados)
 * flota en gravedad cero mientras lee y alterna tarjetas normativas en bucle.
 */
export function McTropicReader() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActive((prev) => (prev + 1) % DECK_CARDS.length);
    }, 1700);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="mctropic-float-scene"
      aria-label="McTropic the astronaut floating in space with the McHanaq orbital emblem behind while reading and flipping regulatory cards"
    >
      <div className="mctropic-bg-logo" aria-hidden="true">
        <Logo size={84} tone="light" animate />
      </div>

      <div className="mctropic-astronaut">
        <svg
          className="mctropic-svg"
          viewBox="0 0 260 260"
          preserveAspectRatio="xMidYMid meet"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="McTropic the astronaut with a space helmet and McLovin-style glasses floating in space"
        >
          <defs>
            <linearGradient id="mct-trunk" x1="106" y1="88" x2="146" y2="232" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#352715" />
              <stop offset="60%" stopColor="#231c11" />
              <stop offset="100%" stopColor="#141811" />
            </linearGradient>
            <linearGradient id="mct-frond" x1="70" y1="34" x2="180" y2="112" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#226842" />
              <stop offset="100%" stopColor="#0f2f1e" />
            </linearGradient>
            <radialGradient id="mct-helmet-glass" cx="38%" cy="30%" r="65%">
              <stop offset="0%" stopColor="#e8efe9" stopOpacity="0.16" />
              <stop offset="50%" stopColor="#39e08a" stopOpacity="0.07" />
              <stop offset="100%" stopColor="#07100b" stopOpacity="0.24" />
            </radialGradient>
            <radialGradient id="mct-halo" cx="50%" cy="48%" r="50%">
              <stop offset="0%" stopColor="#39e08a" stopOpacity="0.16" />
              <stop offset="65%" stopColor="#d8ff33" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#07100b" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Halo espacial suave */}
          <circle cx="128" cy="130" r="110" fill="url(#mct-halo)" />

          {/* Destellos orbitales */}
          <circle className="mctropic-spark mctropic-spark--1" cx="30" cy="82" r="2.2" fill="#d8ff33" />
          <circle className="mctropic-spark mctropic-spark--2" cx="228" cy="70" r="1.9" fill="#39e08a" />
          <circle className="mctropic-spark mctropic-spark--3" cx="210" cy="212" r="2.1" fill="#e8efe9" />

          {/* Flote completo en gravedad cero */}
          <g className="mctropic-zero-g">
            {/* Antena de comunicaciones sobre el casco */}
            <path d="M 183 52 L 198 33" stroke="#e8efe9" strokeWidth="2.2" strokeLinecap="round" />
            <circle className="mctropic-beacon" cx="200" cy="30" r="4" fill="#d8ff33" />

            {/* Tronco curvo limpio fiel a la silueta original (sin cajas detrás) */}
            <path
              d="M 106 96 C 102 142 97 188 90 232 Q 123 237 154 232 C 151 186 146 142 141 96 Z"
              fill="url(#mct-trunk)"
              stroke="#ffb224"
              strokeOpacity="0.78"
              strokeWidth="2.3"
              strokeLinejoin="round"
            />
            {/* Sombreo lateral sutil y muescas de corteza */}
            <path
              d="M 134 102 C 139 144 142 186 145 226"
              stroke="#ffb224"
              strokeOpacity="0.22"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M 102 178 H 116 M 131 190 H 146 M 98 202 H 115 M 131 214 H 148 M 94 221 H 110"
              stroke="#ffb224"
              strokeOpacity="0.68"
              strokeWidth="2.1"
              strokeLinecap="round"
            />

            {/* Corona de 6 hojas de palmera dentro del casco */}
            <g className="mctropic-fronds">
              <path
                d="M 122 80 C 114 61 105 46 91 37 C 99 46 100 54 92 59 C 102 61 109 68 116 82 Z"
                fill="url(#mct-frond)"
                stroke="#39e08a"
                strokeWidth="2.1"
                strokeLinejoin="round"
              />
              <path
                d="M 127 79 C 133 60 144 46 161 40 C 152 48 150 56 159 61 C 148 63 139 70 132 81 Z"
                fill="url(#mct-frond)"
                stroke="#39e08a"
                strokeWidth="2.1"
                strokeLinejoin="round"
              />
              <path
                d="M 116 83 C 98 73 81 71 63 78 C 74 83 80 89 76 96 C 88 92 101 91 115 89 Z"
                fill="url(#mct-frond)"
                stroke="#39e08a"
                strokeWidth="2.1"
                strokeLinejoin="round"
              />
              <path
                d="M 132 83 C 150 74 168 75 186 89 C 174 91 167 96 170 103 C 158 98 145 92 131 88 Z"
                fill="url(#mct-frond)"
                stroke="#39e08a"
                strokeWidth="2.1"
                strokeLinejoin="round"
              />
              <path
                d="M 114 90 C 99 95 86 108 77 126 C 87 121 94 121 98 128 C 105 115 111 103 119 94 Z"
                fill="#0b2417"
                stroke="#d8ff33"
                strokeOpacity="0.82"
                strokeWidth="1.9"
                strokeLinejoin="round"
              />
              <path
                d="M 133 90 C 150 95 166 105 176 125 C 165 119 158 119 155 127 C 148 114 140 103 129 93 Z"
                fill="#0b2417"
                stroke="#d8ff33"
                strokeOpacity="0.82"
                strokeWidth="1.9"
                strokeLinejoin="round"
              />
            </g>

            {/* Sonrisa limpia */}
            <path
              d="M 113 137 C 119 144 129 144 134 136"
              stroke="#e8efe9"
              strokeWidth="2.8"
              strokeLinecap="round"
            />

            {/* Lentes estilo McLovin adaptados al rostro */}
            <g className="mctropic-glasses">
              <path
                d="M 88 103 L 99 97"
                stroke="#e8efe9"
                strokeWidth="3.1"
                strokeLinecap="round"
              />
              <path
                d="M 96 109 C 96 101 101 99 110 100 C 118 101 121 104 120 111 C 119 119 114 123 106 122 C 98 121 96 115 96 109 Z"
                fill="#07150d"
                fillOpacity="0.92"
                stroke="#e8efe9"
                strokeWidth="3.2"
                strokeLinejoin="round"
              />
              <path
                d="M 120 106 C 123 103 127 103 130 107"
                stroke="#e8efe9"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path
                d="M 129 110 C 129 102 134 100 144 101 C 154 102 157 105 156 113 C 155 121 149 125 140 124 C 132 123 129 117 129 110 Z"
                fill="#07150d"
                fillOpacity="0.92"
                stroke="#e8efe9"
                strokeWidth="3.2"
                strokeLinejoin="round"
              />
              <path
                d="M 155 107 L 170 101"
                stroke="#e8efe9"
                strokeWidth="3.1"
                strokeLinecap="round"
              />
              <path
                d="M 101 105 L 106 104 M 134 106 L 140 105"
                stroke="#39e08a"
                strokeOpacity="0.72"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <g className="mctropic-eyes">
                <circle cx="108" cy="111" r="3.1" fill="#d8ff33" />
                <circle cx="143" cy="112" r="3.2" fill="#d8ff33" />
              </g>
            </g>

            {/* Domo transparente del casco astronauta + aro de sellado */}
            <circle
              cx="126"
              cy="96"
              r="80"
              fill="url(#mct-helmet-glass)"
              stroke="#e8efe9"
              strokeOpacity="0.82"
              strokeWidth="2.8"
            />
            <circle
              cx="126"
              cy="96"
              r="75"
              stroke="#39e08a"
              strokeOpacity="0.28"
              strokeWidth="1.2"
              strokeDasharray="6 6"
            />
            <path
              d="M 71 57 A 65 65 0 0 1 116 28"
              stroke="#ffffff"
              strokeOpacity="0.58"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="M 62 72 A 65 65 0 0 1 67 63"
              stroke="#ffffff"
              strokeOpacity="0.58"
              strokeWidth="3"
              strokeLinecap="round"
            />

            {/* Collar metálico estilizado del casco */}
            <path
              d="M 76 155 Q 126 174 176 155"
              stroke="#e8efe9"
              strokeWidth="6.5"
              strokeLinecap="round"
            />
            <path
              d="M 76 155 Q 126 174 176 155"
              stroke="#0a1610"
              strokeWidth="2.6"
              strokeLinecap="round"
            />
            <circle cx="96" cy="162" r="2.2" fill="#d8ff33" />
            <circle cx="156" cy="162" r="2.2" fill="#39e08a" />
          </g>
        </svg>
      </div>

      {/* Abanico abierto de tarjetas: alternan continuamente con movimiento claro */}
      <div className="mctropic-fan" aria-hidden="true">
        {DECK_CARDS.map((card, idx) => {
          const slot = (idx - active + DECK_CARDS.length) % DECK_CARDS.length;
          return (
            <div
              key={card.id}
              data-slot={slot}
              className={`mctropic-fcard mctropic-fcard--${card.tone}`}
            >
              <div className="mctropic-fcard__top">
                <span className="mctropic-fcard__tag">{card.tag}</span>
                <span className="mctropic-fcard__check">
                  {slot === 0 ? "✓ VERIFICANDO" : `0${idx + 1}`}
                </span>
              </div>
              <strong className="mctropic-fcard__title">{card.title}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}
