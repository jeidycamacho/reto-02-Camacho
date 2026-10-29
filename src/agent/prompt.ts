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

  const fechaHoy = fechaReferencia ?? new Date().toISOString().split('T')[0] ?? '2026-09-03';

  return [
    `# FECHA ACTUAL DEL SISTEMA: ${fechaHoy}`,
    `Utiliza "${fechaHoy}" como fecha de hoy para cualquier cálculo de vigencias, alertas y fecha de registro.`,
    ``,
    contenidoPrompt,
    ``,
    `---`,
    `# BASE DE CONOCIMIENTO NORMATIVA Y DE PROCESO`,
    contenidoConocimiento,
  ].join('\n');
}
