import { type ReactNode, useMemo } from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Escapa caracteres HTML para prevenir inyección de código.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renderiza texto inline con soporte para:
 * - Código inline (`code`)
 * - Negrita (**text** o __text__)
 * - Cursiva (*text* o _text_)
 * - Enlaces [texto](url)
 */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let keyIndex = 0;

  while (remaining.length > 0) {
    // 1. Código inline: `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch && codeMatch[1]) {
      nodes.push(
        <code
          key={`code-${keyIndex++}`}
          className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-mono text-xs border border-slate-700/60"
        >
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // 2. Negrita: **bold** o __bold__
    const boldMatch = remaining.match(/^(\*\*|__)(.*?)\1/);
    if (boldMatch && boldMatch[2]) {
      nodes.push(
        <strong key={`bold-${keyIndex++}`} className="font-semibold text-slate-100">
          {renderInline(boldMatch[2])}
        </strong>
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // 3. Cursiva: *italic* o _italic_
    const italicMatch = remaining.match(/^(\*|_)(.*?)\1/);
    if (italicMatch && italicMatch[2]) {
      nodes.push(
        <em key={`italic-${keyIndex++}`} className="italic text-slate-300">
          {renderInline(italicMatch[2])}
        </em>
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // 4. Enlace: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch && linkMatch[1] && linkMatch[2]) {
      nodes.push(
        <a
          key={`link-${keyIndex++}`}
          href={escapeHtml(linkMatch[2])}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors"
        >
          {linkMatch[1]}
        </a>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Texto regular hasta el próximo carácter especial
    const nextSpecial = remaining.search(/[`*_\[]/);
    if (nextSpecial === -1) {
      nodes.push(remaining);
      break;
    } else if (nextSpecial === 0) {
      // Carácter especial suelto que no coincidió con formato
      nodes.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      nodes.push(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return nodes;
}

interface TableRowData {
  cells: string[];
  isHeader?: boolean;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const blocks = useMemo(() => {
    const rawLines = content.split(/\r?\n/);
    const parsedBlocks: ReactNode[] = [];
    let i = 0;
    let blockKey = 0;

    while (i < rawLines.length) {
      const line = rawLines[i] ?? '';

      // 1. Bloque de código con ```
      if (line.trim().startsWith('```')) {
        const lang = line.trim().slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < rawLines.length && !(rawLines[i] ?? '').trim().startsWith('```')) {
          codeLines.push(rawLines[i] ?? '');
          i++;
        }
        if (i < rawLines.length) i++; // saltar cierre ```

        parsedBlocks.push(
          <div
            key={`code-block-${blockKey++}`}
            className="my-3 rounded-lg border border-slate-800 bg-slate-950/80 overflow-hidden text-xs"
          >
            {lang && (
              <div className="px-3 py-1 bg-slate-900 border-b border-slate-800 text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                {lang}
              </div>
            )}
            <pre className="p-3 overflow-x-auto text-slate-200 font-mono leading-relaxed selection:bg-sky-900">
              <code>{codeLines.join('\n')}</code>
            </pre>
          </div>
        );
        continue;
      }

      // 2. Tablas Markdown: | celda | celda |
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const tableLines: string[] = [];
        while (
          i < rawLines.length &&
          (rawLines[i] ?? '').trim().startsWith('|') &&
          (rawLines[i] ?? '').trim().endsWith('|')
        ) {
          tableLines.push((rawLines[i] ?? '').trim());
          i++;
        }

        // Validar si tiene fila divisoria (|---|---|)
        if (tableLines.length >= 2) {
          const headerLine = tableLines[0] ?? '';
          const dividerLine = tableLines[1] ?? '';
          const isTable = dividerLine.replace(/[\s|:-]/g, '').length === 0;

          if (isTable) {
            const parseRow = (rowStr: string): string[] => {
              const stripped = rowStr.replace(/^\||\|$/g, '');
              return stripped.split('|').map((c) => c.trim());
            };

            const headers = parseRow(headerLine);
            const bodyRows: TableRowData[] = tableLines.slice(2).map((r) => ({
              cells: parseRow(r),
            }));

            parsedBlocks.push(
              <div
                key={`table-${blockKey++}`}
                className="my-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/50 shadow-sm"
              >
                <table className="w-full text-left text-xs text-slate-300 divide-y divide-slate-800">
                  <thead className="bg-slate-900/90 text-slate-200 font-semibold uppercase text-[11px] tracking-wider">
                    <tr>
                      {headers.map((h, colIdx) => (
                        <th key={`th-${colIdx}`} className="px-3 py-2.5 border-r border-slate-800 last:border-r-0 whitespace-nowrap">
                          {renderInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-normal">
                    {bodyRows.map((row, rowIdx) => (
                      <tr
                        key={`tr-${rowIdx}`}
                        className={`hover:bg-slate-800/40 transition-colors ${
                          rowIdx % 2 === 0 ? 'bg-slate-900/30' : 'bg-transparent'
                        }`}
                      >
                        {headers.map((_, colIdx) => {
                          const cellVal = row.cells[colIdx] ?? '';
                          return (
                            <td
                              key={`td-${rowIdx}-${colIdx}`}
                              className="px-3 py-2 border-r border-slate-800/50 last:border-r-0 align-top"
                            >
                              {renderInline(cellVal)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
            continue;
          }
        }
      }

      // 3. Encabezados: # H1, ## H2, ### H3, #### H4
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch && headingMatch[1] && headingMatch[2]) {
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        const headingStyles = [
          'text-lg font-bold text-slate-100 mt-4 mb-2 border-b border-slate-800 pb-1.5',
          'text-base font-semibold text-slate-100 mt-3.5 mb-2',
          'text-sm font-semibold text-sky-300 mt-3 mb-1.5',
          'text-xs font-semibold text-slate-200 uppercase tracking-wide mt-2.5 mb-1',
          'text-xs font-medium text-slate-300 mt-2 mb-1',
          'text-xs font-medium text-slate-400 mt-2 mb-1',
        ];
        const style = headingStyles[level - 1] ?? headingStyles[0];

        parsedBlocks.push(
          <div key={`heading-${blockKey++}`} className={style}>
            {renderInline(text)}
          </div>
        );
        i++;
        continue;
      }

      // 4. Separador horizontal: --- o ***
      if (line.trim().match(/^(-{3,}|\*{3,}|_{3,})$/)) {
        parsedBlocks.push(
          <hr key={`hr-${blockKey++}`} className="my-3 border-t border-slate-800" />
        );
        i++;
        continue;
      }

      // 5. Citas en bloque: > cita
      if (line.trim().startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < rawLines.length && (rawLines[i] ?? '').trim().startsWith('>')) {
          quoteLines.push((rawLines[i] ?? '').replace(/^>\s?/, ''));
          i++;
        }
        parsedBlocks.push(
          <blockquote
            key={`quote-${blockKey++}`}
            className="my-2 pl-3.5 py-1 border-l-2 border-sky-500/70 bg-slate-900/40 text-xs text-slate-300 italic rounded-r"
          >
            {quoteLines.map((ql, qIdx) => (
              <p key={`qp-${qIdx}`} className="my-0.5">
                {renderInline(ql)}
              </p>
            ))}
          </blockquote>
        );
        continue;
      }

      // 6. Listas con viñetas o numeradas
      const isBullet = line.trim().match(/^[-*]\s+(.*)$/);
      const isNumbered = line.trim().match(/^(\d+)\.\s+(.*)$/);

      if (isBullet || isNumbered) {
        const listItems: Array<{ isNum: boolean; num?: string; text: string }> = [];
        const isCurrentNumbered = Boolean(isNumbered);

        while (i < rawLines.length) {
          const curr = (rawLines[i] ?? '').trim();
          const bMatch = curr.match(/^[-*]\s+(.*)$/);
          const nMatch = curr.match(/^(\d+)\.\s+(.*)$/);

          if (isCurrentNumbered && nMatch && nMatch[1] && nMatch[2]) {
            listItems.push({ isNum: true, num: nMatch[1], text: nMatch[2] });
            i++;
          } else if (!isCurrentNumbered && bMatch && bMatch[1]) {
            listItems.push({ isNum: false, text: bMatch[1] });
            i++;
          } else if (curr === '') {
            // Línea vacía en lista: ver si siguiente es item
            if (i + 1 < rawLines.length) {
              const next = (rawLines[i + 1] ?? '').trim();
              if (
                (isCurrentNumbered && next.match(/^\d+\.\s+/)) ||
                (!isCurrentNumbered && next.match(/^[-*]\s+/))
              ) {
                i++;
                continue;
              }
            }
            break;
          } else {
            break;
          }
        }

        if (isCurrentNumbered) {
          parsedBlocks.push(
            <ol key={`ol-${blockKey++}`} className="my-2 space-y-1 pl-5 list-decimal text-xs text-slate-300">
              {listItems.map((item, lIdx) => (
                <li key={`li-${lIdx}`} className="leading-relaxed">
                  {renderInline(item.text)}
                </li>
              ))}
            </ol>
          );
        } else {
          parsedBlocks.push(
            <ul key={`ul-${blockKey++}`} className="my-2 space-y-1 pl-4 list-disc text-xs text-slate-300">
              {listItems.map((item, lIdx) => (
                <li key={`li-${lIdx}`} className="leading-relaxed marker:text-sky-500">
                  {renderInline(item.text)}
                </li>
              ))}
            </ul>
          );
        }
        continue;
      }

      // 7. Párrafo normal o salto de línea
      if (line.trim().length === 0) {
        // Línea en blanco: espacio sutil
        i++;
        continue;
      }

      // Agrupar líneas continuas en un solo párrafo
      const paraLines: string[] = [line];
      i++;
      while (
        i < rawLines.length &&
        (rawLines[i] ?? '').trim().length > 0 &&
        !(rawLines[i] ?? '').trim().startsWith('#') &&
        !(rawLines[i] ?? '').trim().startsWith('```') &&
        !(rawLines[i] ?? '').trim().startsWith('|') &&
        !(rawLines[i] ?? '').trim().startsWith('>') &&
        !(rawLines[i] ?? '').trim().match(/^[-*]\s+/) &&
        !(rawLines[i] ?? '').trim().match(/^\d+\.\s+/) &&
        !(rawLines[i] ?? '').trim().match(/^(-{3,}|\*{3,}|_{3,})$/)
      ) {
        paraLines.push(rawLines[i] ?? '');
        i++;
      }

      parsedBlocks.push(
        <p key={`para-${blockKey++}`} className="my-1.5 text-xs text-slate-200 leading-relaxed">
          {renderInline(paraLines.join(' '))}
        </p>
      );
    }

    return parsedBlocks;
  }, [content]);

  return <div className={`markdown-content space-y-1 ${className}`}>{blocks}</div>;
}
