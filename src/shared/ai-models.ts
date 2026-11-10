/** Fixed release menu shared by settings and request routing. */
export const OPENAI_MODELS = [
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
];
export const DEFAULT_OPENAI_MODEL = OPENAI_MODELS[0].id;
export function isRemovedAIModel(model: string): boolean {
  return /^(anthropic-|claude-|gemini-|ollama-|lm-studio-)/i.test(model);
}
export function normalizeAIModelSettings<T extends { provider: string; defaultModel: string; speechCorrectionModel: string }>(ai: T): T {
  const next = { ...ai };
  if (next.provider !== 'openai' && next.provider !== 'openai-compatible') {
    next.provider = 'openai';
    next.defaultModel = DEFAULT_OPENAI_MODEL;
  }
  if (next.provider === 'openai' && (!next.defaultModel || next.defaultModel === 'auto' || isRemovedAIModel(next.defaultModel))) {
    next.defaultModel = DEFAULT_OPENAI_MODEL;
  }
  if (isRemovedAIModel(next.speechCorrectionModel)) next.speechCorrectionModel = '';
  return next;
}
