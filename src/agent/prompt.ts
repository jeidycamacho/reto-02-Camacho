import fs from 'node:fs';
import path from 'node:path';

export function construirPromptSistema(baseDir = process.cwd(), fechaReferencia?: string): string {
  const rutaPrompt = path.join(baseDir, 'agent', 'prompt.md');
  const rutaConocimiento = path.join(baseDir, 'src', 'knowledge', 'registro-contratos.md');

  const contenidoPrompt = fs.existsSync(rutaPrompt)
    ? fs.readFileSync(rutaPrompt, 'utf-8')
    : '# Agente de Registro de Contratos Vigentes';

  const contenidoConocimiento = fs.existsSync(rutaConocimiento)
    ? fs.readFileSync(rutaConocimiento, 'utf-8')
    : '';

  const fechaRealServidor = new Date().toISOString().slice(0, 10);
  const fechaHoy = fechaReferencia ?? fechaRealServidor;

  return [
    `# FECHA REAL DEL SERVIDOR: ${fechaRealServidor}`,
    fechaReferencia
      ? `Fecha de referencia especificada para esta ejecución: "${fechaReferencia}".`
      : `Fecha actual del sistema: "${fechaRealServidor}". Si la persona usuaria indica en su mensaje una fecha de referencia específica para la demo (por ejemplo "2026-09-03"), usa esa fecha provista en el mensaje para los cálculos, argumentos de herramientas (como contratos_alertas) y reportes.`,
    ``,
    contenidoPrompt,
    ``,
    `---`,
    `# BASE DE CONOCIMIENTO NORMATIVA Y DE PROCESO`,
    contenidoConocimiento,
  ].join('\n');
}
