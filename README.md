# Registro de Contratos Vigentes — Agente Inteligente

Sistema automatizado para el **Registro de Contratos Vigentes** de Periferia IT Group. El agente lee el buzón de correo, realiza la extracción determinista de términos contractuales, clasifica y valida los documentos contra el maestro centralizado en SharePoint, gestiona pólizas y estados de garantías, soporta confirmación humana y emite alertas automáticas de vencimiento.

---

## 🚀 Inicio Rápido en Local

Levanta la aplicación localmente ejecutando:

```bash
npm install && npm run dev
```

La aplicación web estará disponible en `http://localhost:3000`.

---

## ⚙️ Variables de Entorno

Configura las variables en un archivo `.env` tomando como base `.env.example`:

| Variable | Descripción |
| :--- | :--- |
| `GEMINI_API_KEY` | Clave de API requerida para las llamadas al modelo de lenguaje Gemini. |
| `LLM_MODEL` | Modelo de lenguaje por defecto (ej. `gemini-3.6-flash`). |
| `MAX_ITERACIONES` | Número máximo de iteraciones permitidas por turno de conversación (ej. `25`). |
| `MAX_TOKENS_SESION` | Límite máximo acumulado de tokens por sesión (ej. `400000`). |
| `MAX_TOKENS_RESPUESTA` | Límite máximo de tokens de salida por llamada al modelo (ej. `4096`). |
| `LLM_TIMEOUT_MS` | Tiempo límite en milisegundos para solicitudes al LLM (ej. `120000`). |
| `LLM_MAX_RPM` | Límite de peticiones por minuto para el plan gratuito de Gemini (ej. `5`). |
| `ACCESS_KEY` | Clave de acceso opcional para la API (cabecera `x-access-key`). Si está vacía, no se exige. |
| `ALLOW_RESET` | Habilita el endpoint de reinicio de datos `/api/reset` (`true`/`false`). |
| `APP_URL` | URL pública donde está alojada la aplicación. |

---

## 🧪 Ejecución de Demo sin Modelo de Lenguaje

Para verificar la lógica de herramientas, extracción determinista y reglas de negocio sin consumir cuota del modelo de lenguaje de Gemini, ejecuta:

```bash
npm run demo
```

---

## 🔍 Comandos de Verificación

El proyecto cuenta con scripts automáticos para verificar tipos, ciclo del agente y empaquetamiento:

```bash
# 1. Verificación de tipos TypeScript
npm run typecheck

# 2. Pruebas deterministas del ciclo del agente (guardia de confirmación y resiliencia)
npm run test:ciclo

# 3. Empaquetado y verificación del módulo reutilizable
npm run modulo
npm run modulo:check
```

---

## 📡 Tabla de Endpoints de la API

| Endpoint | Método | Descripción |
| :--- | :---: | :--- |
| `/api/health` | `GET` | Estado de salud del servidor y modelo LLM configurado. |
| `/api/diagnostico` | `GET` | Ejecuta una llamada mínima de prueba al modelo ("responde OK"). |
| `/api/chat` | `POST` | Interacción principal con el agente. Soporta streaming NDJSON mediante `Accept: application/x-ndjson`. |
| `/api/sessions/:id` | `GET` | Consulta el historial visible y estado de una sesión de conversación. |
| `/api/maestro` | `GET` | Devuelve las filas del maestro de contratos en SharePoint con su `estado_registro`. |
| `/api/alertas` | `GET` | Consulta el reporte de alertas generado (`out/alertas.md`). |
| `/api/reset` | `POST` | Elimina la carpeta `out/` y restaura el maestro desde fixtures. |

---

## 📁 Estructura del Repositorio

```text
├── agent/
│   └── prompt.md                 # Instrucciones principales y flujo del agente
├── fixtures/
│   └── reto-02/                  # Datos de prueba (buzón, comerciales, maestro original)
├── modulo/                       # Módulo empaquetado reutilizable
│   ├── agent.md
│   ├── skill/registro-contratos/
│   └── tools/
├── scripts/
│   ├── empaquetar-modulo.ts      # Generador y verificador del módulo
│   ├── probar-extraccion.ts      # Script de prueba de extracción determinista
│   └── prueba-ciclo.ts           # Pruebas automatizadas del ciclo del agente
├── src/
│   ├── agent/                    # Ciclo, registro, sesiones y prompts del agente
│   ├── components/               # Componentes UI en React (Chat, Panel Lateral, Herramientas)
│   ├── knowledge/                # Reglas JSON y documento normativo
│   ├── llm/                      # Adaptador propio de Gemini y manejo de cuotas
│   ├── tools/                    # Definición de herramientas y lógica de negocio
│   ├── App.tsx                   # Frontend principal
│   └── server.ts                 # Servidor Express y endpoints API
├── .env.example                  # Plantilla de variables de entorno
├── demo.ts                       # Script de demo ejecutable sin modelo
├── package.json                  # Scripts y dependencias del proyecto
├── README.md                     # Documentación general del proyecto
└── SOLUCION.md                   # Informe técnico de arquitectura y decisiones
```

---

Link de prueba: <pendiente>  
Clave de acceso: <pendiente>
