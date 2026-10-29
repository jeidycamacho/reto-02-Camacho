import fs from 'node:fs';
import path from 'node:path';

function empaquetarModulo(): void {
  const baseDir = process.cwd();
  const esCheck = process.argv.includes('--check');

  const rutaPromptFuente = path.join(baseDir, 'agent', 'prompt.md');
  const rutaConocimientoFuente = path.join(
    baseDir,
    'src',
    'knowledge',
    'registro-contratos.md'
  );

  if (!fs.existsSync(rutaPromptFuente)) {
    console.error(`❌ No se encontró el archivo fuente: ${rutaPromptFuente}`);
    process.exit(1);
  }

  if (!fs.existsSync(rutaConocimientoFuente)) {
    console.error(
      `❌ No se encontró el archivo fuente: ${rutaConocimientoFuente}`
    );
    process.exit(1);
  }

  const contenidoPrompt = fs.readFileSync(rutaPromptFuente, 'utf-8');
  const contenidoConocimiento = fs.readFileSync(
    rutaConocimientoFuente,
    'utf-8'
  );

  const esperadoAgentMd = [
    '---',
    'description: Agente especializado en la automatización del Registro de Contratos Vigentes y gestión de pólizas de Periferia IT Group.',
    'mode: primary',
    'permission:',
    '  edit: deny',
    '  bash: deny',
    '---',
    '',
    contenidoPrompt,
  ].join('\n');

  const esperadoSkillMd = [
    '---',
    'name: registro-contratos',
    'description: Base de conocimiento normativa, roles y ciclo de vida del proceso de Registro de Contratos Vigentes.',
    '---',
    '',
    contenidoConocimiento,
  ].join('\n');

  const esperadoToolsTs = 'export * from "../../src/tools/contratos";\n';

  const rutaAgentMd = path.join(baseDir, 'modulo', 'agent.md');
  const rutaSkillMd = path.join(
    baseDir,
    'modulo',
    'skill',
    'registro-contratos',
    'SKILL.md'
  );
  const rutaToolsTs = path.join(baseDir, 'modulo', 'tools', 'contratos.ts');

  if (esCheck) {
    let coincide = true;

    const verificarArchivo = (ruta: string, esperado: string): boolean => {
      if (!fs.existsSync(ruta)) {
        console.error(`❌ Archivo faltante en módulo: ${ruta}`);
        return false;
      }
      const actual = fs.readFileSync(ruta, 'utf-8');
      if (actual !== esperado) {
        console.error(`❌ El contenido de ${ruta} difiere de la fuente original.`);
        return false;
      }
      return true;
    };

    coincide = verificarArchivo(rutaAgentMd, esperadoAgentMd) && coincide;
    coincide = verificarArchivo(rutaSkillMd, esperadoSkillMd) && coincide;
    coincide = verificarArchivo(rutaToolsTs, esperadoToolsTs) && coincide;

    if (!coincide) {
      console.error('💥 Falló la verificación del módulo reutilizable.');
      process.exit(1);
    } else {
      console.log('✅ Verificación exitosa: modulo/ coincide perfectamente con sus fuentes.');
      process.exit(0);
    }
  } else {
    // Generar/escribir archivos en modulo/
    fs.mkdirSync(path.dirname(rutaAgentMd), { recursive: true });
    fs.mkdirSync(path.dirname(rutaSkillMd), { recursive: true });
    fs.mkdirSync(path.dirname(rutaToolsTs), { recursive: true });

    fs.writeFileSync(rutaAgentMd, esperadoAgentMd, 'utf-8');
    fs.writeFileSync(rutaSkillMd, esperadoSkillMd, 'utf-8');
    fs.writeFileSync(rutaToolsTs, esperadoToolsTs, 'utf-8');

    console.log('📦 Módulo reutilizable empaquetado exitosamente en modulo/:');
    console.log(` • ${rutaAgentMd}`);
    console.log(` • ${rutaSkillMd}`);
    console.log(` • ${rutaToolsTs}`);
    process.exit(0);
  }
}

empaquetarModulo();
