import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createLlmAdapter } from './llm/adapter.ts';
import { createAgent, type AgentContext } from './agent/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
const PORT = Number(process.env['PORT'] ?? 3000);

app.use(express.json());

const llmAdapter = createLlmAdapter('gemini-3.8-flash');
const agent = createAgent(llmAdapter);

// Health check endpoint
// Responds with { ok, provider, model } without exposing the API key
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    provider: llmAdapter.provider,
    model: llmAdapter.model,
  });
});

// Chat endpoint (Esqueleto del ciclo de agente)
app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { message?: string; sessionId?: string } | undefined;
  const userMessage = body?.message?.trim() ?? '';
  const sessionId = body?.sessionId ?? 'session-default';

  if (!userMessage) {
    res.status(400).json({ ok: false, error: 'El mensaje no puede estar vacío' });
    return;
  }

  const ctx: AgentContext = {
    directory: path.join(rootDir, 'out'),
    sessionId,
  };

  const result = await agent.runCycle(userMessage, ctx);
  res.json({
    ok: true,
    reply: result.message,
    step: result.step,
    finished: result.finished,
  });
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
