import { useId } from "react";

/**
 * McTropic Astronauta programando en gravedad cero (`#/tecnologia`).
 * Conserva exactamente el diseño de personaje de `McTropicReader`
 * (tronco curvo ambar-obsidiana, 6 frondas, lentes McLovin adaptados,
 * domo espacial con antena y collarin), sumando su laptop abierta
 * y flotando detras del borde superior de `.tech-term`.
 */
export function McTropicCoder() {
  const uid = useId().replace(/:/g, "");
  const trunkId = `mctc-trunk-${uid}`;
  const frondId = `mctc-frond-${uid}`;
  const glassId = `mctc-helmet-glass-${uid}`;
  const haloId = `mctc-halo-${uid}`;

  return (
    <div className="mctropic-coder" aria-hidden="true">
      <svg
        className="mctropic-coder__svg"
        viewBox="0 0 260 232"
        preserveAspectRatio="xMidYMid meet"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={trunkId} x1="106" y1="88" x2="146" y2="232" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#352715" />
            <stop offset="60%" stopColor="#231c11" />
            <stop offset="100%" stopColor="#141811" />
          </linearGradient>
          <linearGradient id={frondId} x1="70" y1="34" x2="180" y2="112" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#226842" />
            <stop offset="100%" stopColor="#0f2f1e" />
          </linearGradient>
          <radialGradient id={glassId} cx="38%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#e8efe9" stopOpacity="0.16" />
            <stop offset="50%" stopColor="#39e08a" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#07100b" stopOpacity="0.24" />
          </radialGradient>
          <radialGradient id={haloId} cx="50%" cy="48%" r="50%">
            <stop offset="0%" stopColor="#39e08a" stopOpacity="0.16" />
            <stop offset="65%" stopColor="#d8ff33" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#07100b" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Halo espacial suave */}
        <circle cx="128" cy="118" r="102" fill={`url(#${haloId})`} />

        {/* Destellos orbitales */}
        <circle className="mctropic-spark mctropic-spark--1" cx="30" cy="82" r="2.2" fill="#d8ff33" />
        <circle className="mctropic-spark mctropic-spark--2" cx="228" cy="70" r="1.9" fill="#39e08a" />
        <circle className="mctropic-spark mctropic-spark--3" cx="218" cy="176" r="2.1" fill="#e8efe9" />

        {/* Flote completo en gravedad cero */}
        <g className="mctropic-coder-float">
          {/* Antena de comunicaciones sobre el casco */}
          <path d="M 183 52 L 198 33" stroke="#e8efe9" strokeWidth="2.2" strokeLinecap="round" />
          <circle className="mctropic-beacon" cx="200" cy="30" r="4" fill="#d8ff33" />

          {/* Tronco curvo identico al de Marco normativo */}
          <path
            d="M 106 96 C 102 142 97 188 90 230 Q 123 235 154 230 C 151 186 146 142 141 96 Z"
            fill={`url(#${trunkId})`}
            stroke="#ffb224"
            strokeOpacity="0.78"
            strokeWidth="2.3"
            strokeLinejoin="round"
          />
          {/* Sombreo lateral sutil y muescas de corteza */}
          <path
            d="M 134 102 C 139 144 142 186 145 224"
            stroke="#ffb224"
            strokeOpacity="0.22"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M 102 178 H 116 M 131 190 H 146"
            stroke="#ffb224"
            strokeOpacity="0.68"
            strokeWidth="2.1"
            strokeLinecap="round"
          />

          {/* Corona de 6 hojas de palmera dentro del casco */}
          <g className="mctropic-fronds">
            <path
              d="M 122 80 C 114 61 105 46 91 37 C 99 46 100 54 92 59 C 102 61 109 68 116 82 Z"
              fill={`url(#${frondId})`}
              stroke="#39e08a"
              strokeWidth="2.1"
              strokeLinejoin="round"
            />
            <path
              d="M 127 79 C 133 60 144 46 161 40 C 152 48 150 56 159 61 C 148 63 139 70 132 81 Z"
              fill={`url(#${frondId})`}
              stroke="#39e08a"
              strokeWidth="2.1"
              strokeLinejoin="round"
            />
            <path
              d="M 116 83 C 98 73 81 71 63 78 C 74 83 80 89 76 96 C 88 92 101 91 115 89 Z"
              fill={`url(#${frondId})`}
              stroke="#39e08a"
              strokeWidth="2.1"
              strokeLinejoin="round"
            />
            <path
              d="M 132 83 C 150 74 168 75 186 89 C 174 91 167 96 170 103 C 158 98 145 92 131 88 Z"
              fill={`url(#${frondId})`}
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

          {/* Lentes estilo McLovin adaptados al rostro (nitidos a escala) */}
          <g className="mctropic-glasses">
            <path
              d="M 88 106 L 97 104"
              stroke="#e8efe9"
              strokeWidth="3.3"
              strokeLinecap="round"
            />
            <path
              d="M 96 109 C 96 101 101 99 110 100 C 118 101 121 104 120 111 C 119 119 114 123 106 122 C 98 121 96 115 96 109 Z"
              fill="#050e09"
              fillOpacity="0.97"
              stroke="#e8efe9"
              strokeWidth="3.6"
              strokeLinejoin="round"
            />
            <path
              d="M 120 106 C 123 103 127 103 130 107"
              stroke="#e8efe9"
              strokeWidth="3.4"
              strokeLinecap="round"
            />
            <path
              d="M 129 110 C 129 102 134 100 144 101 C 154 102 157 105 156 113 C 155 121 149 125 140 124 C 132 123 129 117 129 110 Z"
              fill="#050e09"
              fillOpacity="0.97"
              stroke="#e8efe9"
              strokeWidth="3.6"
              strokeLinejoin="round"
            />
            <path
              d="M 155 107 L 166 103"
              stroke="#e8efe9"
              strokeWidth="3.3"
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
              <circle cx="108" cy="111" r="3" fill="#d8ff33" />
              <circle cx="143" cy="112" r="3.1" fill="#d8ff33" />
            </g>
          </g>

          {/* Domo transparente del casco astronauta + aro de sellado */}
          <circle
            cx="126"
            cy="96"
            r="80"
            fill={`url(#${glassId})`}
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

          {/* Collar metalico estilizado del casco */}
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

          {/* Bracitos sutiles detras de la tapa trasera de la laptop (tecleando en oculto) */}
          <g className="mctropic-paw mctropic-paw--left">
            <path
              d="M 103 172 Q 86 178 82 188"
              stroke="#ffb224"
              strokeOpacity="0.82"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx="81" cy="189" r="3.4" fill="#e8efe9" stroke="#0a1610" strokeWidth="1.4" />
          </g>
          <g className="mctropic-paw mctropic-paw--right">
            <path
              d="M 149 172 Q 166 178 170 188"
              stroke="#ffb224"
              strokeOpacity="0.82"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx="171" cy="189" r="3.4" fill="#e8efe9" stroke="#0a1610" strokeWidth="1.4" />
          </g>

          {/* Tapa trasera de la laptop abierta frente a McTropic (cubre el teclado detras) */}
          <g className="mctropic-laptop">
            {/* Carcasa exterior mate con ligero escorzo hacia el frente */}
            <path
              d="M 81 168 Q 81 163 86 163 L 166 163 Q 171 163 171 168 L 167 206 L 85 206 Z"
              fill="#08140d"
              stroke="#e8efe9"
              strokeOpacity="0.88"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            {/* Bisel interior sutil */}
            <path
              d="M 85 168 Q 85 166 87 166 L 165 166 Q 167 166 167 168 L 164 202 L 88 202 Z"
              fill="#0c1c13"
              stroke="#39e08a"
              strokeOpacity="0.34"
              strokeWidth="1"
              strokeLinejoin="round"
            />
            {/* Borde superior luminoso de la bisagra superior de pantalla */}
            <line
              x1="92"
              y1="163"
              x2="160"
              y2="163"
              stroke="#d8ff33"
              strokeOpacity="0.45"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            {/* Emblema minimalista de McHanaq en el centro de la tapa */}
            <g transform="translate(126 184)">
              <circle r="7.5" fill="#07130c" stroke="#39e08a" strokeOpacity="0.72" strokeWidth="1.2" />
              <ellipse
                rx="12.5"
                ry="4.2"
                transform="rotate(-24)"
                stroke="#e8efe9"
                strokeOpacity="0.72"
                strokeWidth="1.1"
              />
              <circle className="mctropic-beacon" cx="9.8" cy="-4.8" r="1.9" fill="#d8ff33" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
