import {
  leer_buzon,
  extraer,
  validar,
  registrar,
  descartar,
  alertas,
  type ToolContext,
} from './src/tools/contratos.ts';
import type { Contrato } from './src/tools/lib/esquema.ts';
import { createLlmAdapter } from './src/llm/adapter.ts';
import { createAgent } from './src/agent/index.ts';

async function runDemo(): Promise<void> {
  console.log('=== DEMO: Registro de Contratos Vigentes (Esqueleto) ===\n');

  const context: ToolContext = {
    directory: process.cwd(),
    sessionId: 'demo-session-001',
  };

  const muestraContrato: Contrato = {
    id_contrato: 'CT-2026-015',
    cliente: 'Industrias Delta S.A.S.',
    nit_cliente: '890900111',
    pais: 'CO',
    objeto: 'Implementación CRM',
    valor: 265000000,
    moneda: 'COP',
    fecha_inicio: '2026-08-01',
    fecha_fin: '2027-07-31',
    requiere_poliza: true,
    tipo_poliza: 'cumplimiento',
    estado_poliza: 'pendiente',
    comercial: 'Laura Gómez Restrepo',
    ruta_sharepoint: 'Contratos/2026/industrias-delta/CT-2026-015.pdf',
    fecha_registro: '2026-09-03',
    fuente: 'buzon',
    confianza: { id_contrato: 0.95, valor: 0.95, fecha_inicio: 0.9, fecha_fin: 0.9 },
  };

  console.log('1. Verificando herramientas de contratos:');
  const toolList = [
    { name: 'leer_buzon', tool: leer_buzon, sampleArgs: {} },
    { name: 'extraer', tool: extraer, sampleArgs: { mensaje_id: 'msg-001' } },
    { name: 'validar', tool: validar, sampleArgs: { mensaje_id: 'msg-001', contrato: muestraContrato } },
    { name: 'registrar', tool: registrar, sampleArgs: { mensaje_id: 'msg-001', contrato: muestraContrato, confirmado: true } },
    { name: 'descartar', tool: descartar, sampleArgs: { mensaje_id: 'msg-005', motivo: 'Es una cotización, no hay contrato' } },
    { name: 'alertas', tool: alertas, sampleArgs: { hoy: '2026-09-03' } },
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
