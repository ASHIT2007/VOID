import { evaluate } from 'mathjs';
import { registerTool, ToolHandler, ToolResult } from '../tool-registry.js';

export function registerCalculatorTools(): void {
  const handler: ToolHandler = async (args) => {
    const { expression } = args;
    if (typeof expression !== 'string') {
      return { content: '', error: 'Expression must be a string' };
    }
    try {
      const result = evaluate(expression);
      return { content: `Result: ${result}` };
    } catch (error: any) {
      return { content: '', error: `Failed to evaluate expression: ${error.message}` };
    }
  };

  registerTool(
    'calculator',
    {
      type: 'function',
      function: {
        name: 'calculator',
        description: 'Evaluate mathematical expressions',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'The math expression to evaluate' }
          },
          required: ['expression']
        }
      }
    },
    handler,
    { requiresConfirmation: false, readOnly: true, category: 'code' }
  );
}
