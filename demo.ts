import {
  leer_buzon,
  extraer,
  validar,
  registrar,
  descartar,
  alertas,
  type ToolContext,
} from './src/tools/contratos.ts';
import { createLlmAdapter } from './src/llm/adapter.ts';
import { createAgent } from './src/agent/index.ts';

async function runDemo(): Promise<void> {
  console.log('=== DEMO: Registro de Contratos Vigentes (Esqueleto) ===\n');

  const context: ToolContext = {
    directory: process.cwd(),
    sessionId: 'demo-session-001',
  };

  console.log('1. Verificando herramientas de contratos:');
  const toolList = [
    { name: 'leer_buzon', tool: leer_buzon, sampleArgs: {} },
    { name: 'extraer', tool: extraer, sampleArgs: { mensaje_id: 'msg_001.pdf' } },
    { name: 'validar', tool: validar, sampleArgs: { mensaje_id: 'msg_001', contrato: { titulo: 'Contrato Servicios' } } },
    { name: 'registrar', tool: registrar, sampleArgs: { mensaje_id: 'msg_001', contrato: { titulo: 'Contrato Servicios' }, confirmado: true } },
    { name: 'descartar', tool: descartar, sampleArgs: { mensaje_id: 'msg_001', motivo: 'Firma incompleta' } },
    { name: 'alertas', tool: alertas, sampleArgs: { hoy: '2026-10-29' } },
  ] as const;

  for (const item of toolList) {
    const result = await item.tool.execute(item.sampleArgs as never, context);
    console.log(` - [${item.name}]: ${item.tool.description}`);
    console.log(`   Resultado de prueba: ${result}`);
  }

  console.log('\n2. Inicializando Adaptador LLM y Agente:');
  const llm = createLlmAdapter('gemini-3.8-flash');
  console.log(` - Proveedor LLM: ${llm.provider}`);
  console.log(` - Modelo LLM: ${llm.model}`);

  const agent = createAgent(llm);
  const cycleResult = await agent.runCycle('Procesar nuevos contratos del buzón', context);
  console.log(` - Ciclo del agente: paso=${cycleResult.step}, finalizado=${cycleResult.finished}`);
  console.log(` - Mensaje: ${cycleResult.message}`);

  console.log('\n=== Demo finalizada con éxito ===');
}

void runDemo();
