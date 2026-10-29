import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { GeminiAdaptador } from './llm/gemini.ts';
import { CicloAgente } from './agent/ciclo.ts';
import {
  obtenerOCrearSesion,
  intentarBloquearSesion,
  desbloquearSesion,
} from './agent/sesion.ts';
import { leerMaestro, asegurarMaestro } from './tools/lib/almacen.ts';
import { generarReporteAlertas } from './tools/lib/alertas.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
const PORT = Number(process.env['PORT'] ?? 3000);

app.use(express.json());

const llmAdapter = new GeminiAdaptador();
const cicloAgente = new CicloAgente(llmAdapter);

// Middleware para ACCESS_KEY opcional en rutas /api/* (excepto /api/health)
app.use((req: Request, res: Response, next: NextFunction): void => {
  if (req.path.startsWith('/api') && req.path !== '/api/health') {
    const accessKey = process.env['ACCESS_KEY'];
    if (accessKey && accessKey.trim().length > 0) {
      const clientKey = req.headers['x-access-key'];
      if (!clientKey || clientKey !== accessKey) {
        res.status(401).json({
          ok: false,
          error: 'Acceso no autorizado: clave de acceso inválida o ausente en cabecera x-access-key',
        });
        return;
      }
    }
  }
  next();
});

// Endpoint de salud: responde sin exponer claves
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    provider: llmAdapter.proveedor,
    model: llmAdapter.modelo,
  });
});

// Endpoint de chat con soporte JSON estándar y streaming NDJSON
app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { message?: string; sessionId?: string } | undefined;
  const userMessage = body?.message?.trim() ?? '';
  const sessionId = body?.sessionId?.trim() || 'session-default';

  if (!userMessage) {
    res.status(400).json({ ok: false, error: 'El mensaje no puede estar vacío' });
    return;
  }

  if (userMessage.length > 4000) {
    res.status(400).json({
      ok: false,
      error: 'El mensaje excede el límite máximo de 4000 caracteres',
    });
    return;
  }

  // Control de concurrencia: bloqueo por sesión (409 Conflict si está ocupada)
  if (!intentarBloquearSesion(sessionId, rootDir)) {
    res.status(409).json({
      ok: false,
      error: 'La sesión se encuentra ocupada con otra solicitud en proceso',
    });
    return;
  }

  const acceptHeader = req.headers['accept'] ?? '';
  const esStreaming = acceptHeader.includes('application/x-ndjson');

  if (esStreaming) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    try {
      await cicloAgente.ejecutarTurno(sessionId, userMessage, rootDir, (evento) => {
        res.write(JSON.stringify(evento) + '\n');
      });
      res.end();
    } catch (error) {
      desbloquearSesion(sessionId, rootDir);
      const errMsg = error instanceof Error ? error.message : String(error);
      res.write(JSON.stringify({ tipo: 'error', error: errMsg }) + '\n');
      res.end();
    }
  } else {
    try {
      const resultado = await cicloAgente.ejecutarTurno(sessionId, userMessage, rootDir);
      res.json({
        ok: true,
        reply: resultado.reply,
        toolCalls: resultado.toolCalls,
        needsConfirmation: resultado.needsConfirmation,
      });
    } catch (error) {
      desbloquearSesion(sessionId, rootDir);
      const errMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: errMsg });
    }
  }
});

// Endpoint para consultar estado de una sesión
app.get('/api/sessions/:id', (req: Request, res: Response): void => {
  const sessionId = req.params['id']?.trim() || 'session-default';
  const sesion = obtenerOCrearSesion(sessionId, rootDir);
  res.json({
    ok: true,
    sesion,
    ...sesion,
  });
});

// Endpoint para consultar el maestro de contratos en formato tabular
app.get('/api/maestro', (_req: Request, res: Response): void => {
  try {
    const filas = leerMaestro(rootDir);
    res.json({
      ok: true,
      total: filas.length,
      filas,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, error: errMsg });
  }
});

// Endpoint para consultar el reporte de alertas en Markdown
app.get('/api/alertas', (req: Request, res: Response): void => {
  try {
    const rutaAlertas = path.join(rootDir, 'out', 'alertas.md');
    let contenido = '';

    if (fs.existsSync(rutaAlertas)) {
      contenido = fs.readFileSync(rutaAlertas, 'utf-8');
    } else {
      const resReporte = generarReporteAlertas('2026-09-03', rootDir);
      const rutaGenerada = path.join(rootDir, resReporte.ruta);
      if (fs.existsSync(rutaGenerada)) {
        contenido = fs.readFileSync(rutaGenerada, 'utf-8');
      }
    }

    if (req.headers['accept']?.includes('application/json')) {
      res.json({ ok: true, markdown: contenido });
    } else {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.send(contenido);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, error: errMsg });
  }
});

// Endpoint para reiniciar el directorio out/ (protegido por ALLOW_RESET)
app.post('/api/reset', (_req: Request, res: Response): void => {
  if (process.env['ALLOW_RESET'] === 'false') {
    res.status(403).json({
      ok: false,
      error: 'El reinicio está deshabilitado por configuración (ALLOW_RESET=false)',
    });
    return;
  }

  try {
    const outDir = path.join(rootDir, 'out');
    if (fs.existsSync(outDir)) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
    asegurarMaestro(rootDir);

    res.json({
      ok: true,
      mensaje: 'Directorio out reiniciado con éxito',
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, error: errMsg });
  }
});

async function startServer(): Promise<void> {
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
      root: rootDir,
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(rootDir, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Registro de Contratos Vigentes corriendo en http://localhost:${PORT}`);
  });
}

void startServer();
