# SOLUCIÓN TÉCNICA — REGISTRO DE CONTRATOS VIGENTES

## 1. Problema en una Frase
Automatizar de forma segura y transparente el procesamiento del buzón de contratos de Periferia IT Group mediante un agente inteligente que clasifica documentos, extrae términos contractuales de forma determinista, valida reglas de negocio en SharePoint, exige confirmación humana ante valores dudosos y emite alertas de vencimiento y pólizas.

---

## 2. Arquitectura del Sistema
El sistema se organiza en tres capas claramente desacopladas:

1. **Prompt e Instrucciones (`agent/prompt.md`)**:
   - Define el rol, los principios de seguridad (fidelidad a datos de herramientas, inmunidad a inyección de instrucciones), la política de confirmación humana y la estructura canónica de la respuesta.
2. **Base de Conocimiento y Normativa (`src/knowledge/`)**:
   - `reglas.json`: Parámetros de negocio, umbrales de confianza, vocabularios de contrato/correo, tipos de pólizas y formatos de identificadores tributarios por país.
   - `registro-contratos.md`: Definición de roles (Dueño del dato, Administradora, Comercial, Custodio TI, Patrocinador), ciclo de vida de un mensaje y reglas de negocio RN1–RN8.
3. **Capa de Ejecución y Herramientas (`src/agent/`, `src/tools/`, `src/llm/`, `src/server.ts`)**:
   - `src/agent/ciclo.ts`: Controla el bucle de razonamiento del agente, la invocación de herramientas en paralelo, el tope de iteraciones y la guardia de confirmación humana.
   - `src/tools/lib/extraccion.ts`: Motor de extracción 100% determinista campo por campo sin uso del modelo de lenguaje.
   - `src/tools/lib/validacion.ts`: Lógica de validación contra el maestro de contratos, resolución de comerciales y evaluación de `requiere_revision`.
   - `src/tools/lib/almacen.ts`: Manejo atómico de archivos CSV, JSON, JSONL y archivado físico de documentos en SharePoint.
   - `src/llm/gemini.ts`: Adaptador propio para Gemini con sanitización de esquemas OpenAPI 3.0, preservación de firmas de razonamiento (`thoughtSignature`) y control de tasa de peticiones (429).
   - `src/server.ts`: Servidor HTTP Express con soporte de streaming NDJSON para el chat en vivo.

---

## 3. Ciclo del Agente y Mecanismos de Control
- **Ciclo de Ejecución (`src/agent/ciclo.ts`)**:
  - En cada turno, el agente consulta al adaptador LLM pasando el historial de mensajes, la instrucción de sistema y los esquemas sanitizados de herramientas.
  - El modelo puede responder con texto o con una o varias llamadas a herramientas en paralelo.
  - El ciclo ejecuta en bloque todas las herramientas solicitadas, registra la trazabilidad en `out/log.jsonl` y devuelve las respuestas de herramientas en el siguiente turno del modelo.
- **Tope de Iteraciones (`MAX_ITERACIONES`)**:
  - Configurable mediante variable de entorno (por defecto `25` iteraciones por turno).
  - Si el modelo agota el tope de iteraciones, el bucle se detiene ordenadamente y devuelve un resumen transparente de las operaciones realizadas y los contratos pendientes de confirmación.
- **Guardia de Confirmación Humana en Código**:
  - Si `contratos_validar` determina que un contrato tiene campos en `requiere_revision`, el mensaje ingresa al conjunto de pendientes de confirmación de la sesión.
  - Si el modelo intenta ejecutar `contratos_registrar` con `confirmado: true` en el mismo turno o sin que la confirmación haya sido otorgada por la persona en un turno posterior, el código de la herramienta bloquea la ejecución y retorna un mensaje de error de guardia.

---

## 4. Elección del Modelo de Lenguaje y Costos
- **Modelo Utilizado**: `gemini-3.6-flash`.
  - **Motivo de elección**: Garantiza respuestas rápidas y estables en llamadas con funciones (function calling), evitando los retardos altos y errores de timeout/504 que pueden presentarse en versiones de razonamiento pesado (`gemini-3.8-flash`).
- **Límites del Plan Gratuito**:
  - Se configuró el adaptador para respetar la cuota de **5 RPM (peticiones por minuto)** mediante un limitador de ritmo (`LLM_MAX_RPM=5`) y reintentos automáticos con cálculo de delay para errores HTTP 429.
- **Fórmula de Costos de Operación**:
  - $\text{Costo Total} = (\text{Tokens Entrada} \times \text{Precio Entrada}) + (\text{Tokens Salida} \times \text{Precio Salida})$.
  - Al agrupar las llamadas a herramientas en paralelo (extracción en bloque, validación en bloque), el procesamiento de un buzón de 6 mensajes se reduce de ~20 turnos a solo **4 a 5 llamadas al modelo**, optimizando el uso de cuota y minimizando costos.

---

## 5. Estrategia de Extracción
- **Naturaleza Determinista**:
  - La extracción de datos contractuales es **100% determinista** mediante expresiones regulares, delimitación de cláusulas y vocabularios normativos leídos desde `src/knowledge/reglas.json`.
  - **Cero alucinaciones**: El modelo de lenguaje NO participa en la extracción ni en el cálculo de montos o fechas.
- **Escala de Niveles de Confianza**:
  - `etiquetado` (0.95): Atributo explícito con etiqueta formal (ej. "No. CT-2026-015").
  - `patron` (0.90): Coincidencia por expresión regular o estructura estándar (ej. formato NIT/RUC).
  - `inferido` (0.85): Dato obtenido de pistas contextuales o por omisión de regla (ej. moneda por país).
  - `derivado` (0.70): Cálculo matemático o calendario (ej. fecha fin por plazo en meses).
  - `ambiguo` (0.60): Valores indeterminados o cláusulas con tarifario por demanda.
  - `ausente` (0.00): Atributo no encontrado en el texto.
- **Límites de Responsabilidad**:
  - **Dónde entra la IA**: Orquestación del flujo, interpretación de la intención del usuario, agrupación de llamadas a herramientas y redacción final estructurada.
  - **Dónde NO entra la IA**: Extracción de datos, validación de reglas de negocio, escritura en el CSV maestro, cálculo de alertas y firma de archivos.

---

## 6. Regla de Gobierno

<completar>

---

## 7. Decisiones de Diseño y Trade-offs

1. **Adaptador LLM Propio (`src/llm/gemini.ts`)**:
   - *Decisión*: Se implementó un adaptador a medida sobre `@google/genai` en lugar de usar librerías genéricas de orquestación.
   - *Ventaja*: Sanitización estricta de esquemas Zod a OpenAPI 3.0 para Gemini, control atómico de AbortController por timeout, preservación transparente de firmas de razonamiento (`thoughtSignature` / `crudoProveedor`) y manejo resipiente de errores 429.
2. **Extracción sin IA**:
   - *Decisión*: Separar totalmente la extracción de texto del modelo de lenguaje.
   - *Trade-off*: Mayor esfuerzo en la calibración de expresiones regulares y aislamientos de cláusulas, pero garantiza un comportamiento 100% reproducible y sin riesgo de alucinación.
3. **Guardia de Confirmación en Código**:
   - *Decisión*: La validación de que `confirmado: true` provenga de la persona se realiza en el código TypeScript del ciclo, no en el prompt.
   - *Ventaja*: Seguridad determinista e inquebrantable ante posibles inyecciones de instrucciones en documentos o errores del modelo.
4. **Herramienta `contratos_descartar`**:
   - *Decisión*: Crear una herramienta dedicada para cerrar mensajes duplicados o rechazados.
   - *Ventaja*: Permite registrar el motivo del descarte en `out/procesados.json` sin modificar ni contaminar el maestro de contratos en SharePoint.
5. **Servidor Express y Streaming NDJSON**:
   - *Decisión*: Servidor web ligero en Node.js que sirve la UI en React y expone la API con streaming NDJSON.
   - *Ventaja*: La interfaz muestra en vivo cada paso de pensamiento y cada tarjeta de herramienta a medida que se ejecuta.

---

## 8. Supuestos Operativos

1. **Nombres de Adjuntos en Buzón**: Los mensajes del buzón pueden contener adjuntos con diversos nombres (`contrato.txt`, `otrosi.txt`, `Anexo.pdf`, etc.); la herramienta los evalúa por su **contenido** y no por su nombre de archivo.
2. **Fechas de Firma Incompletas**: Si un documento indica firma "en el mes de X de YYYY" sin especificar el día exacto, se asume el **último día** de ese mes.
3. **Cálculo de Plazos por Meses**: Los plazos expresados en meses se calculan sumando meses calendarios exactos a la fecha de inicio.
4. **Exigencia de Pólizas Condicionales**: Si la cláusula de garantías indica que no se requieren pólizas o no se mencionan garantías, se marca `requiere_poliza = false` y `estado_poliza = "no_aplica"`.
5. **Otrosíes Modificatorios de Valor**: Si un otrosí fija un nuevo valor explícito para el contrato, dicho valor reemplaza el total del contrato base en el maestro.

---

## 9. Cobertura por Historia de Usuario

- **HU-1 (Lectura de buzón)**: Cubierta por `contratos_leer_buzon`, que inspecciona `correo.json` y clasifica preliminarmente la existencia de contratos.
- **HU-2 (Extracción determinista)**: Cubierta por `contratos_extraer`, que analiza el texto del adjunto y retorna los campos con su nivel de confianza y evidencia textual.
- **HU-3 (Validación y Comerciales)**: Cubierta por `contratos_validar`, que busca duplicados o coincidencias en el maestro, resuelve el comercial desde `comerciales.json` o emite la advertencia `remitente no registrado en comerciales.json: <correo> (no bloquea el registro)`.
- **HU-4 (Política de confirmación)**: Cubierta por la lógica de `requiere_revision` y la guardia de seguridad en `src/agent/ciclo.ts`.
- **HU-5 (Registro y Archivado)**: Cubierta por `contratos_registrar`, que actualiza el CSV maestro de forma atómica, archiva el documento estructurado en `out/sharepoint/Contratos/` y registra trazabilidad en `historial.jsonl` y `procesados.json`.
- **HU-6 (Alertas y Calidad)**: Cubierta por `contratos_alertas`, que calcula vencimientos a 60 días, pólizas pendientes y vacíos de cobertura post-corte (`2026-05-30`), generando `out/alertas.md`.

---

## 10. Uso de IA

<completar>

---

## 11. Riesgos y Mitigaciones

1. **Riesgo: Límite de Cuota del Plan Gratuito (5 RPM en Gemini)**:
   - *Mitigación*: Implementación de limitador de velocidad `LLM_MAX_RPM`, reintentos automáticos con lectura de `retryDelay`, agrupación de llamadas en paralelo y tope de espera a 60 segundos.
2. **Riesgo: Documentos Escaneados o en Imagen sin Texto**:
   - *Mitigación*: La extracción marca los campos no legibles con confianza `0.0` (`ausente`), lo que activa la bandera `requiere_revision` y solicita revisión humana sin corromper el maestro.
3. **Riesgo: Concurrencia y Colisión de Archivos en Servidor**:
   - *Mitigación*: Escritura atómica de CSV mediante archivo temporal y renombrado (`renameSync`), y bloqueo de sesión activa por `sessionId` en `/api/chat`.
4. **Riesgo: Indisponibilidad o Latencia del Proveedor LLM**:
   - *Mitigación*: Cancelación estricta con `AbortController` al alcanzar `LLM_TIMEOUT_MS` (120s), manteniendo la sesión del usuario activa para reintentar el mensaje sin perder el historial.
