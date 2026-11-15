/**
 * Dibuja una versión diminuta de McTropic Astronauta emergiendo detrás de la Tierra
 * y flotando a la deriva en gravedad cero cuando la portada entra en `#equipo`.
 */
export function drawMcTropicAdrift(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  adriftT: number,
  alpha: number,
  reduced: boolean,
) {
  if (alpha <= 0.004 || R <= 20) return;

  // Curva de salida suave desde detrás del limbo superior izquierdo de la Tierra.
  const emergeRaw = reduced ? 1 : Math.min(1, adriftT / 2.6);
  const emerge = emergeRaw * emergeRaw * (3 - 2 * emergeRaw);

  const wanderT = reduced ? 0.8 : Math.max(0, adriftT - 0.6);
  const driftX = (Math.sin(wanderT * 0.43) * 0.065 + Math.sin(wanderT * 0.19 + 1.2) * 0.04) * emerge;
  const driftY = (Math.cos(wanderT * 0.37 + 0.5) * 0.032 + Math.sin(wanderT * 0.17) * 0.02) * emerge;

  const nx = -0.28 + (-0.52 - -0.28) * emerge + driftX;
  const ny = -0.84 + (-1.07 - -0.84) * emerge + driftY;

  const px = cx + nx * R;
  const py = cy + ny * R;

  // Muy pequeño respecto al planeta (~27-31 px totales en desktop).
  const sc = Math.max(0.105, Math.min(0.145, (R / 280) * 0.132));
  const tilt = reduced
    ? -0.22
    : Math.sin(adriftT * 0.52) * 0.34 + Math.cos(adriftT * 0.23 + 0.7) * 0.18;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(tilt);
  ctx.scale(sc, sc);
  ctx.translate(-126, -118);
  ctx.globalAlpha = alpha;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Antena superior con destello ácido
  ctx.strokeStyle = "#e8efe9";
  ctx.lineWidth = 5.5;
  ctx.beginPath();
  ctx.moveTo(180, 52);
  ctx.lineTo(197, 31);
  ctx.stroke();

  const blink = reduced ? 0.9 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(adriftT * 3.8));
  ctx.fillStyle = `rgba(216, 255, 51, ${blink.toFixed(2)})`;
  ctx.beginPath();
  ctx.arc(200, 28, 7, 0, Math.PI * 2);
  ctx.fill();

  // Tronco curvo ambar-obsidiana fiel a McTropic
  ctx.fillStyle = "#241b11";
  ctx.strokeStyle = "rgba(255, 178, 36, 0.85)";
  ctx.lineWidth = 6.5;
  ctx.beginPath();
  ctx.moveTo(106, 98);
  ctx.bezierCurveTo(102, 140, 97, 180, 91, 214);
  ctx.quadraticCurveTo(123, 219, 152, 214);
  ctx.bezierCurveTo(149, 180, 145, 140, 141, 98);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Corona de frondas dentro del casco
  const drawFrond = (fill: string, stroke: string, pathFn: () => void) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    pathFn();
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };

  drawFrond("#194f32", "#39e08a", () => {
    ctx.moveTo(122, 82);
    ctx.bezierCurveTo(114, 62, 104, 46, 89, 37);
    ctx.bezierCurveTo(99, 48, 100, 55, 92, 60);
    ctx.bezierCurveTo(102, 62, 110, 69, 116, 82);
  });
  drawFrond("#194f32", "#39e08a", () => {
    ctx.moveTo(127, 81);
    ctx.bezierCurveTo(134, 61, 145, 46, 162, 40);
    ctx.bezierCurveTo(153, 49, 151, 56, 160, 61);
    ctx.bezierCurveTo(148, 64, 139, 71, 132, 82);
  });
  drawFrond("#15442b", "#39e08a", () => {
    ctx.moveTo(116, 85);
    ctx.bezierCurveTo(96, 74, 79, 73, 62, 80);
    ctx.bezierCurveTo(75, 86, 80, 91, 76, 97);
    ctx.bezierCurveTo(89, 93, 102, 92, 115, 90);
  });
  drawFrond("#15442b", "#39e08a", () => {
    ctx.moveTo(132, 85);
    ctx.bezierCurveTo(152, 75, 170, 76, 187, 90);
    ctx.bezierCurveTo(174, 92, 167, 97, 170, 104);
    ctx.bezierCurveTo(158, 99, 145, 93, 131, 90);
  });

  // Lentes estilo McLovin + ojitos ácido
  ctx.fillStyle = "rgba(7, 21, 13, 0.94)";
  ctx.strokeStyle = "#e8efe9";
  ctx.lineWidth = 7.2;

  // Lente izquierdo
  ctx.beginPath();
  ctx.roundRect(95, 99, 27, 23, 8);
  ctx.fill();
  ctx.stroke();

  // Lente derecho
  ctx.beginPath();
  ctx.roundRect(129, 100, 28, 24, 8);
  ctx.fill();
  ctx.stroke();

  // Puente y patillas
  ctx.beginPath();
  ctx.moveTo(122, 108);
  ctx.lineTo(129, 108);
  ctx.moveTo(86, 104);
  ctx.lineTo(95, 106);
  ctx.moveTo(157, 106);
  ctx.lineTo(169, 102);
  ctx.stroke();

  // Pupilas
  ctx.fillStyle = "#d8ff33";
  ctx.beginPath();
  ctx.arc(108, 111, 4.4, 0, Math.PI * 2);
  ctx.arc(143, 112, 4.4, 0, Math.PI * 2);
  ctx.fill();

  // Domo transparente del casco + aro de sellado
  ctx.fillStyle = "rgba(57, 224, 138, 0.08)";
  ctx.strokeStyle = "rgba(232, 239, 233, 0.85)";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(126, 98, 80, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Brillo blanco del cristal
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineWidth = 6.5;
  ctx.beginPath();
  ctx.arc(126, 98, 65, -Math.PI * 0.84, -Math.PI * 0.56);
  ctx.stroke();

  // Collarín metálico
  ctx.strokeStyle = "#e8efe9";
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(76, 157);
  ctx.quadraticCurveTo(126, 176, 176, 157);
  ctx.stroke();

  ctx.restore();
}
