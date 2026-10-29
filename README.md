# Registro de Contratos Vigentes — Agente conversacional

> Reto técnico 02 · Equipo Perxia 2.0 · Periferia IT Group

Agente que actúa como **punto único de recepción de contratos**: lee el buzón, extrae los datos del contrato con confianza por campo, detecta duplicados y otrosíes, archiva el documento, actualiza el maestro de contratos y genera alertas de vencimiento y pólizas. **Nada dudoso se registra sin confirmación humana.**

El planteamiento completo (arquitectura, decisiones, regla de gobierno y riesgos) está en [`SOLUCION.md`](SOLUCION.md).

---

## Link de prueba

- **URL:** `<pegar aquí el link de Cloud Run>`
- **Clave de acceso:** `<pegar aquí el valor de ACCESS_KEY>`

Al enviar el primer mensaje, el chat pide la clave de acceso. Prompt sugerido para la demo (sección 11 del PRD):

```text
Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.
```

Después, para registrar el contrato en revisión: `confirmo el valor 0 y la fecha fin 2027-08-31`.

---

## Arranque en local (un comando)

Requiere Node.js 20 o superior.

```bash
cp .env.example .env      # completar GEMINI_API_KEY y, si se desea, ACCESS_KEY
npm install && npm run dev
```

La app queda en `http://localhost:3000`.

## Demo sin modelo de lenguaje

```bash
npm install
npm run demo              # equivale a: npx tsx demo.ts   (también funciona: bun run demo.ts)
```

La demo:
1. Limpia `out/`.
2. Procesa los 6 mensajes del buzón en orden, llamando directamente a las herramientas (sin modelo y sin clave).
3. Deja `msg-006` sin registrar en la primera pasada y lo registra en una segunda llamada con `confirmado: true`.
4. Prueba casos malos (moneda inválida, fecha inválida, mensaje inexistente) sin detener el lote.
5. Genera `out/alertas.md` con fecha de referencia 2026-09-03.

## Verificaciones

| Comando | Qué comprueba |
|---|---|
| `npm run typecheck` | TypeScript estricto, sin `any` |
| `npm run test:ciclo` | Ciclo del agente con un proveedor simulado (sin clave): bloqueo de auto-confirmación, confirmación en el turno siguiente, timeout del proveedor y tope de iteraciones |
| `npm run modulo:check` | Que `modulo/` sea idéntico a las fuentes que usa la aplicación |

## Variables de entorno

| Variable | Valor por defecto | Uso |
|---|---|---|
| `GEMINI_API_KEY` | — | Clave del modelo. Solo se lee en el servidor; nunca llega al front, al log ni a la API |
| `LLM_MODEL` | `gemini-3.6-flash` | Modelo del agente |
| `LLM_MAX_RPM` | `4` | Máximo de peticiones por minuto al modelo (el plan gratuito permite 5) |
| `MAX_ITERACIONES` | `25` | Tope de iteraciones modelo → herramientas por turno |
| `MAX_TOKENS_SESION` | `400000` | Tope de tokens por sesión |
| `MAX_TOKENS_RESPUESTA` | `4096` | Tope de tokens por respuesta del modelo |
| `LLM_TIMEOUT_MS` | `120000` | Tiempo máximo por llamada al modelo |
| `ACCESS_KEY` | vacío | Si se define, el chat la pide (cabecera `x-access-key`) |
| `ALLOW_RESET` | `true` | Permite el botón "Reiniciar datos" |

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation }`. Con `Accept: application/x-ndjson` responde un stream de eventos `pensando`, `herramienta` y `respuesta` |
| `GET` | `/api/sessions/:id` | Historial de la sesión, uso de tokens y mensajes pendientes de confirmación |
| `GET` | `/api/health` | `{ ok, provider, model }`, sin exponer claves |
| `GET` | `/api/maestro` | Filas del maestro con su estado (nuevo, actualizado u original) |
| `GET` | `/api/alertas` | Último `out/alertas.md` |
| `GET` | `/api/diagnostico` | Llamada mínima al modelo, sin herramientas, con su latencia en milisegundos |
| `POST` | `/api/reset` | Borra `out/` (se deshabilita con `ALLOW_RESET=false`) |

Si `ACCESS_KEY` está definida, todas las rutas salvo `/api/health` exigen la cabecera `x-access-key`.

## Estructura

```
agent/prompt.md                      Comportamiento del agente (system prompt)
src/knowledge/registro-contratos.md  Conocimiento del proceso: roles, reglas RN1–RN8, diccionario, confianza
src/knowledge/reglas.json            Parámetros de negocio: umbrales, días, fecha de corte, vocabularios
src/tools/contratos.ts               Herramientas (cada export se publica como contratos_<export>)
src/tools/lib/                       Extracción, validación, registro, alertas, almacenamiento y esquema zod
src/llm/                             Adaptador propio (interfaz) e implementación para Gemini
src/agent/                           Ciclo del agente, registro de herramientas, sesiones y prompt de sistema
src/server.ts                        API HTTP (Express)
src/App.tsx                          Front de chat (React)
demo.ts                              Herramientas sin modelo
scripts/                             Pruebas del ciclo, prueba de extracción y empaquetado del módulo
modulo/                              Bonus: agente empaquetado, generado de las mismas fuentes
fixtures/reto-02/                    Datos entregados por Periferia (solo lectura)
docs/PRD.md                          Documento del reto
out/                                 Todo lo que se escribe en ejecución (no se versiona)
```

## Construcción

La aplicación se construyó en Google AI Studio (Build mode) con Gemini, por bloques verificados contra el PRD. El detalle de qué se usó, para qué y qué se descartó está en la sección 10 de [`SOLUCION.md`](SOLUCION.md).
