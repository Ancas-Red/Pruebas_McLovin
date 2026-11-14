# hamess — fuente verdadera

Esta carpeta es la referencia que manda sobre el proyecto. Si el código, un comentario o una
diapositiva contradicen lo que dice aquí, lo que vale es lo que está en esta carpeta.

## Qué hay

| Archivo | Qué contiene | Quién lo mantiene |
|---|---|---|
| `documento-tecnico-operativo.md` | Alcance, fuentes, metodología, contratos de datos, árbol de susceptibilidad, rúbrica y entrega. Versión 1.7. | Jean Pierrer, con validación técnica de cada responsable |
| `arquitectura-frontend-backend.md` | Contrato `/api/v1`, reparto de archivos, dueños por carpeta, pruebas de integración. | Backend, con revisión de Sebastian |

## Reglas

1. **Un cambio aquí se acuerda, no se improvisa.** Nadie renombra campos, tipos ni unidades
   por su cuenta. Un cambio de contrato se hace en un PR que toca a la vez este documento,
   los fixtures y el código afectado.
2. **Las cifras entran verificadas.** Ningún número llega a la presentación sin que lo
   confirme quien produce el dato o el cálculo.
3. **Los fixtures no son resultados.** Los datos de muestra sirven para desarrollar y probar.
   Nunca se presentan como observaciones en la demo ni en el pitch.
4. **Los límites se declaran.** Un foco térmico no es un incendio confirmado; la susceptibilidad
   es cualitativa y no validada; la simulación de recorrido parte de una ignición hipotética y
   no es un pronóstico.

## Qué queda fuera del alcance

Predicción de ocurrencia o ignición, probabilidad de incendio, estimación de superficie futura
quemada, modelos entrenados con aprendizaje automático y cualquier uso operativo de alerta,
despacho o evacuación.
