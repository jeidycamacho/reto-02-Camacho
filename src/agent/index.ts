import type { LlmAdapter, ChatMessage } from '../llm/adapter.ts';
import * as contratosTools from '../tools/contratos.ts';

export interface AgentContext {
  directory: string;
  sessionId: string;
}

export interface ToolExecutionRecord {
  tool: string;
  output: string;
}

export interface AgentCycleResult {
  step: number;
  finished: boolean;
  message: string;
  toolInvocations: readonly ToolExecutionRecord[];
}

export interface Agent {
  readonly llm: LlmAdapter;
  runCycle(userInput: string, ctx: AgentContext): Promise<AgentCycleResult>;
}

export class ContractAgent implements Agent {
  public readonly availableTools = contratosTools;

  public constructor(public readonly llm: LlmAdapter) {}

  public async runCycle(userInput: string, _ctx: AgentContext): Promise<AgentCycleResult> {
    const _messages: readonly ChatMessage[] = [
      { role: 'user', content: userInput },
    ];

    return {
      step: 1,
      finished: true,
      message: `[Esqueleto del Agente] Entrada procesada: "${userInput}". Herramientas de contratos preparadas.`,
      toolInvocations: [],
    };
  }
}

export function createAgent(llm: LlmAdapter): Agent {
  return new ContractAgent(llm);
}
