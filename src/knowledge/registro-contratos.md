# Conocimiento del Proceso: Registro de Contratos Vigentes

Este documento describe la operativa, los roles participantes, las reglas de negocio y los criterios de validación para el registro y gobierno de contratos vigentes en Periferia IT Group.

---

## 1. Roles y Responsabilidades

| Rol | Actor / Responsable | Responsabilidad principal |
| :--- | :--- | :--- |
| **Dueño del dato** | Coordinación Administrativa y Financiera | Define los campos obligatorios, criterios de calidad, aprueba excepciones y responde por la integridad y vigencia del maestro de contratos. |
| **Administradora** | Analista administrativa | Usuaria principal del agente: opera el buzón único, interactúa con el chat, revisa y confirma los campos con baja confianza, valida pólizas y custodia el archivo. |
| **Productor** | Comercial que firma | Cierra la negociación con el cliente y está obligado a remitir el contrato firmado, otrosíes y actas al buzón único dentro del plazo normativo, con o sin póliza. |
| **Custodio** | TI | Mantiene la infraestructura tecnológica, la carpeta compartida en SharePoint, garantiza la disponibilidad del sistema y la persistencia de logs y respaldos. |
| **Patrocinador** | Gerencia Comercial | Impulsa el cumplimiento de la regla de gobierno entre los equipos comerciales y supervisa el indicador mensual de contratos regularizados. |

---

## 2. Ciclo de Vida de un Mensaje en el Buzón

Todo mensaje que ingresa a `fixtures/reto-02/buzon/` sigue un flujo determinista de 5 fases:

```
[1. Buzón]               [2. Extracción]          [3. Validación]               [4. Decisión]                  [5. Monitoreo]
leer_buzon        ──▶    extraer           ──▶   validar                ──▶    registrar / descartar   ──▶    alertas
Lista mensajes           Extrae campos con       Clasifica en:                 Escribe en maestro y           Genera alertas
no procesados            confianza [0,1]         - nuevo                       archiva en SharePoint,         de vencimientos
                                                 - actualizacion               o rechaza / pide               y pólizas
                                                 - duplicado                   confirmación si hay
                                                 - rechazado                   requiere_revision
```

1. **Lectura del buzón (`leer_buzon`)**:
   - Detecta los mensajes presentes en la bandeja que no han sido registrados en `out/procesados.json`.
   - Identifica si el mensaje contiene adjuntos válidos de contrato (`tiene_contrato`).
2. **Extracción estructurada (`extraer`)**:
   - Analiza el texto del adjunto (`contrato.txt`, `otrosi.txt`, etc.).
   - Estructura los campos del contrato conforme al esquema maestro, asociando a cada campo su nivel de confianza `[0, 1]` y su evidencia textual.
3. **Validación y Clasificación (`validar`)**:
   - Cruza los datos extraídos contra el maestro consolidado en `out/sharepoint/maestro-contratos.csv`.
   - Clasifica el contrato según las reglas RN1–RN4.
   - Detecta discrepancias o campos con confianza inferior a `0.80` y genera la lista `requiere_revision`.
4. **Acción de Registro o Descarte (`registrar` / `descartar`)**:
   - Si está clasificado como `duplicado` o `rechazado`, se ejecuta `descartar` dejando constancia en `out/procesados.json`.
   - Si es `nuevo` o `actualizacion` sin campos en revisión, se ejecuta `registrar`.
   - Si tiene campos en `requiere_revision`, el agente **detiene** el registro y solicita confirmación humana explícita. Solo tras la confirmación se invoca `registrar` con `confirmado=true`.
5. **Generación de Alertas (`alertas`)**:
   - Al finalizar el lote, se genera `out/alertas.md` evaluando contratos por vencer (≤ 60 días), pólizas no vigentes y contratos incorporados tras la fecha de corte (`2026-05-30`).

---

## 3. Reglas de Negocio (RN1 – RN8)

- **RN1 · Duplicado**:
  Un contrato se clasifica como `duplicado` si coincide exactamente en `id_contrato` y además presenta idénticos `valor`, `fecha_inicio` y `fecha_fin`. No se escribe en el maestro ni en el historial; se invoca `descartar` registrando el motivo.
- **RN2 · Actualización**:
  Un contrato se clasifica como `actualizacion` si:
  a) Coincide en `id_contrato` pero presenta variaciones en valor o plazos.
  b) Coincide en `nit_cliente` y similitud semántica de `objeto` ≥ `0.90` con campos modificados.
  c) El documento adjunto es identificado como **otrosí**, adenda o modificatorio.
  En este caso, se actualiza la fila correspondiente en el maestro y se inserta un registro en `out/sharepoint/historial.jsonl`.
- **RN3 · Nuevo**:
  Se clasifica como `nuevo` cuando el contrato no presenta coincidencias previas de `id_contrato` ni de contraparte/objeto en el maestro. Se inserta una nueva fila en el maestro.
- **RN4 · Rechazado**:
  Se clasifica como `rechazado` cuando el mensaje no contiene un adjunto de contrato (ejemplo: cotizaciones, ofertas comerciales, consultas informativas) o el texto carece de partes intervinientes y objeto identificables. Se cierra con `descartar`.
- **RN5 · Umbral de Confianza y Revisión Humana**:
  Todo campo extraído cuya confianza sea menor a `0.80` ingresa automáticamente a `requiere_revision`. La herramienta `registrar` rechazará cualquier intento de escritura mientras existan campos en revisión, a menos que se envíe explícitamente `confirmado=true`.
- **RN6 · Protección de Fixtures**:
  El archivo `fixtures/reto-02/maestro-contratos.csv` es estrictamente de solo lectura. La primera ejecución crea una copia en `out/sharepoint/maestro-contratos.csv` y todas las lecturas y escrituras se realizan sobre esta última.
- **RN7 · Trazabilidad Obligatoria (`log.jsonl`)**:
  Cada invocación de herramienta debe añadir una línea en `out/log.jsonl` con la estructura: `{ "ts": string, "herramienta": string, "mensaje_id": string, "ok": boolean, "resumen": string }`.
- **RN8 · Reactivación de Póliza en Otrosíes**:
  Cuando un documento clasificado como **otrosí** amplía el plazo (`fecha_fin`) de un contrato que requiere póliza (`requiere_poliza = true`), su `estado_poliza` debe pasar inmediatamente a `pendiente`, dado que la garantía constituida debe renovarse o ampliarse en vigencia.

---

## 4. Diccionario de Datos del Maestro de Contratos

El maestro de contratos (`maestro-contratos.csv`) contiene 16 columnas estandarizadas:

| Columna | Tipo | Reglas y Formato | Ejemplo |
| :--- | :--- | :--- | :--- |
| `id_contrato` | string | Identificador formal del contrato tal como aparece en el documento. Si no existe, se genera `AUTO-<año>-<secuencia>`. | `CT-2026-015` |
| `cliente` | string | Razón social completa de la contraparte o contratante. | `Industrias Delta S.A.S.` |
| `nit_cliente` | string | Número de identificación tributaria sin puntos ni dígito de verificación. | `890900111` |
| `pais` | enum | Código ISO del país de la contraparte: `CO`, `EC`, `PE`, `PA`, `HN`. | `CO` |
| `objeto` | string | Resumen conciso del objeto contractual (máximo 200 caracteres). | `Implementación, parametrización y soporte CRM` |
| `valor` | number | Valor numérico total sin separadores de miles. `0` si es indeterminado / por demanda. | `265000000` |
| `moneda` | enum | Moneda del contrato: `COP`, `USD`, `PEN`, `PAB`, `HNL`. | `COP` |
| `fecha_inicio` | string | Fecha de inicio de ejecución en formato `YYYY-MM-DD`. | `2026-08-01` |
| `fecha_fin` | string | Fecha de terminación en formato `YYYY-MM-DD`. Derivable de plazo si aplica. | `2027-07-31` |
| `requiere_poliza`| boolean | `true` si el contrato exige garantías o pólizas; `false` en caso contrario. | `true` |
| `tipo_poliza` | string | Tipos de póliza exigidos separados por punto y coma (`;`). Vacío si no requiere. | `cumplimiento` |
| `estado_poliza` | enum | Estado de la póliza: `vigente`, `pendiente`, `vencida`, `no_aplica`. Si es nuevo con póliza → `pendiente`. | `pendiente` |
| `comercial` | string | Nombre completo del ejecutivo comercial resuelto mediante `comerciales.json`. Si no existe, remitente original. | `Laura Gómez Restrepo` |
| `ruta_sharepoint`| string | Ruta relativa del archivo archivado en `out/sharepoint/`. | `Contratos/2026/industrias-delta/CT-2026-015.pdf` |
| `fecha_registro`| string | Fecha del sistema en que se realiza el registro (`YYYY-MM-DD`). | `2026-09-03` |
| `fuente` | enum | Origen del registro: `buzon`, `manual`, `migracion`. | `buzon` |

---

## 5. Niveles de Confianza de Extracción

La confianza de cada campo extraído se calibra según la fuente y la certidumbre de la evidencia:

| Nivel | Puntuación | Descripción y Casos |
| :--- | :---: | :--- |
| **Etiquetado** | `0.95` | Campo explícitamente rotulado en una cláusula clara (ej. `"SEGUNDA. VALOR: COP $265.000.000"`). |
| **Patrón** | `0.90` | Identificado mediante expresión regular inequívoca (ej. NIT con formato formal `890.900.111-4` o fechas canónicas). |
| **Inferido** | `0.85` | Deducido contextualmente de referencias cruzadas (ej. país inferido por domicilio en `"Quito, Ecuador"` y moneda `USD`). |
| **Derivado** | `0.70` | Calculado mediante cálculo de fechas o inferencias de cláusulas generales (ej. sumar 12 meses a fecha de firma). **Entra a revisión.** |
| **Ambiguo** | `0.60` | Múltiples valores posibles, redacción confusa o cláusula condicional (ej. contratos marco por demanda con valor no fijado). **Entra a revisión.** |
| **Ausente** | `0.00` | Campo no encontrado en el texto ni en los anexos. Se asigna `null`. |

---

## 6. Procedimiento para Solicitar Confirmación Humana Campo por Campo

Cuando un contrato presenta campos en `requiere_revision`:
1. El agente **no invoca** `contratos_registrar`.
2. Presenta un desglose estructurado con:
   - **Campo a revisar**: Nombre de la variable (`valor`, `fecha_fin`, etc.).
   - **Valor propuesto por extracción**: Valor preliminar extraído.
   - **Nivel de confianza**: Valor numérico y categoría.
   - **Motivo de la duda**: Explicación clara (ej. `"Contrato marco por demanda sin valor expreso; se propone 0"` o `"Fecha fin calculada a partir de 12 meses desde firma sin fecha fija explícita"`).
   - **Evidencia textual**: Fragmento literal del contrato que originó la propuesta.
3. El agente finaliza su intervención con una pregunta directa y clara pidiendo la confirmación o corrección de los valores dudosos.
4. Únicamente cuando la persona responda confirmando o suministrando el valor corregido, el agente invoca `contratos_registrar` con `confirmado=true`.
