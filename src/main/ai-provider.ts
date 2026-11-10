/**
 * AI Provider — streaming LLM completions via OpenAI or Custom.
 *
 * Uses Node.js built-in https/http modules — no npm dependencies.
 */

import { DEFAULT_OPENAI_MODEL, isRemovedAIModel } from '../shared/ai-models';
import * as https from 'https';
import * as http from 'http';
import type { AISettings } from './settings-store';

export interface AIRequestOptions {
  prompt: string;
  model?: string;
  creativity?: number; // 0-2 temperature
  systemPrompt?: string;
  signal?: AbortSignal;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIChatRequestOptions {
  messages: ChatMessage[];
  model?: string;
  creativity?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
}

// ─── Model routing ────────────────────────────────────────────────────

interface ModelRoute {
  provider: 'openai' | 'openai-compatible';
  modelId: string;
}

function resolveModel(model: string | undefined, config: AISettings): ModelRoute {
  const selected = model || config.defaultModel;
  if (selected && isRemovedAIModel(selected)) throw new Error('This AI provider has been removed. Choose OpenAI or Custom in Settings → AI → LLM.');
  if (selected?.startsWith('openai-compatible-')) return { provider: 'openai-compatible', modelId: selected.slice(18) };
  if (selected?.startsWith('openai-')) return { provider: 'openai', modelId: selected.slice(7) };
  return { provider: config.provider === 'openai-compatible' ? 'openai-compatible' : 'openai', modelId: selected || (config.provider === 'openai-compatible' ? config.openaiCompatibleModel?.trim() || 'gpt-4o' : DEFAULT_OPENAI_MODEL) };
}

// ─── Model capability helpers ────────────────────────────────────────

// OpenAI reasoning models (o1, o1-mini, o1-preview, o3, o3-mini, o4-mini, …)
// reject the `temperature` parameter — they only support the default.
function isOpenAIReasoningModel(model: string): boolean {
  return /^(o\d|gpt-[56])/i.test(model.trim());
}

// ─── Availability check ──────────────────────────────────────────────

function hasProviderCredentials(provider: ModelRoute['provider'], config: AISettings): boolean {
  switch (provider) {
    case 'openai':
      return !!config.openaiApiKey;
    case 'openai-compatible':
      return !!(config.openaiCompatibleBaseUrl && config.openaiCompatibleApiKey);
  }
}

export function isAIAvailable(config: AISettings): boolean {
  // Treat missing/legacy "enabled" as enabled by default.
  if (config.enabled === false) return false;
  if (config.llmEnabled === false) return false;

  // Availability should follow the effective model route (defaultModel can
  // point to a different provider than config.provider).
  const route = resolveModel(undefined, config);
  if (hasProviderCredentials(route.provider, config)) return true;

  // Fallback to configured provider in case defaultModel is invalid.
  return false;
}

// ─── Streaming implementation ────────────────────────────────────────

export async function* streamAI(
  config: AISettings,
  options: AIRequestOptions
): AsyncGenerator<string> {
  const route = resolveModel(options.model, config);
  const temperature = options.creativity ?? 0.7;

  switch (route.provider) {
    case 'openai':
      yield* streamOpenAI(config.openaiApiKey, route.modelId, options.prompt, temperature, options.systemPrompt, options.signal);
      break;
    case 'openai-compatible':
      yield* streamOpenAICompatible(
        config.openaiCompatibleBaseUrl,
        config.openaiCompatibleApiKey,
        route.modelId,
        options.prompt,
        temperature,
        options.systemPrompt,
        options.signal,
        config.openaiCompatibleAppendV1
      );
      break;
  }
}

// ─── Chat (multi-turn) ───────────────────────────────────────────────

export async function* streamAIChat(
  config: AISettings,
  options: AIChatRequestOptions
): AsyncGenerator<string> {
  const route = resolveModel(options.model, config);
  const temperature = options.creativity ?? 0.7;

  switch (route.provider) {
    case 'openai':
      yield* streamOpenAIChat(config.openaiApiKey, route.modelId, options.messages, temperature, options.systemPrompt, options.signal);
      break;
    case 'openai-compatible':
      yield* streamOpenAICompatibleChat(
        config.openaiCompatibleBaseUrl,
        config.openaiCompatibleApiKey,
        route.modelId,
        options.messages,
        temperature,
        options.systemPrompt,
        options.signal,
        config.openaiCompatibleAppendV1
      );
      break;
  }
}

async function* streamOpenAIChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  systemPrompt?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  if (!apiKey) throw new Error('Set an OpenAI API key in Settings → AI → LLM.');
  const payload: any = { model, input: messages, stream: true, store: false };
  if (systemPrompt) payload.instructions = systemPrompt;
  if (!isOpenAIReasoningModel(model)) payload.temperature = temperature;
  const response = await httpRequest({
    hostname: 'api.openai.com', path: '/v1/responses', method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload), signal, useHttps: true,
  });
  let completed = false;
  yield* parseSSE(response, (data) => {
    const event = JSON.parse(data);
    if (event.type === 'error' || event.type === 'response.failed') {
      throw new Error(event.error?.message || event.response?.error?.message || event.message || 'OpenAI response failed');
    }
    if (event.type === 'response.incomplete') throw new Error(`OpenAI response incomplete: ${event.response?.incomplete_details?.reason || 'unknown reason'}`);
    if (event.type === 'response.completed') completed = true;
    if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') return event.delta || null;
    return null;
  });
  if (!completed) throw new Error('OpenAI stream ended before the response completed');
}

async function* streamOpenAICompatibleChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  systemPrompt?: string,
  signal?: AbortSignal,
  appendV1?: boolean
): AsyncGenerator<string> {
  const full: any[] = [];
  if (systemPrompt) full.push({ role: 'system', content: systemPrompt });
  for (const m of messages) full.push({ role: m.role, content: m.content });

  const payload: any = { model, messages: full, stream: true };
  if (!/^o\d/i.test(model.trim())) payload.temperature = temperature;
  const body = JSON.stringify(payload);

  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const chatUrl = (appendV1 !== false && !normalizedBaseUrl.endsWith('/v1'))
    ? `${normalizedBaseUrl}/v1/chat/completions`
    : `${normalizedBaseUrl}/chat/completions`;
  const url = new URL(chatUrl);
  const useHttps = url.protocol === 'https:';

  const response = await httpRequest({
    hostname: url.hostname,
    port: url.port ? parseInt(url.port) : undefined,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body,
    signal,
    useHttps,
  });

  yield* parseSSE(response, (data) => {
    if (data === '[DONE]') return null;
    try {
      const parsed = JSON.parse(data);
      return parsed.choices?.[0]?.delta?.content || null;
    } catch {
      return null;
    }
  });
}

// ─── OpenAI ──────────────────────────────────────────────────────────

async function* streamOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
  temperature: number,
  systemPrompt?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  yield* streamOpenAIChat(apiKey, model, [{ role: 'user', content: prompt }], temperature, systemPrompt, signal);
}

// ─── OpenAI-Compatible (Generic) ──────────────────────────────────────

async function* streamOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  temperature: number,
  systemPrompt?: string,
  signal?: AbortSignal,
  appendV1?: boolean
): AsyncGenerator<string> {
  const messages: any[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const payload: any = { model, messages, stream: true };
  if (!/^o\d/i.test(model.trim())) payload.temperature = temperature;
  const body = JSON.stringify(payload);

  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const chatUrl = (appendV1 !== false && !normalizedBaseUrl.endsWith('/v1'))
    ? `${normalizedBaseUrl}/v1/chat/completions`
    : `${normalizedBaseUrl}/chat/completions`;

  const url = new URL(chatUrl);
  const useHttps = url.protocol === 'https:';

  const response = await httpRequest({
    hostname: url.hostname,
    port: url.port ? parseInt(url.port) : undefined,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
    signal,
    useHttps,
  });

  yield* parseSSE(response, (data) => {
    if (data === '[DONE]') return null;
    try {
      const parsed = JSON.parse(data);
      return parsed.choices?.[0]?.delta?.content || null;
    } catch {
      return null;
    }
  });
}

// ─── HTTP helpers ────────────────────────────────────────────────────

interface HttpRequestOptions {
  hostname: string;
  port?: number;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  useHttps: boolean;
}

function httpRequest(opts: HttpRequestOptions): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const mod = opts.useHttps ? https : http;

    const reqOpts: https.RequestOptions = {
      hostname: opts.hostname,
      port: opts.port,
      path: opts.path,
      method: opts.method,
      headers: opts.headers,
      signal: opts.signal,
    };

    const req = mod.request(reqOpts, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
        });
        return;
      }
      resolve(res);
    });

    req.on('error', reject);

    req.write(opts.body);
    req.end();
  });
}

async function readResponseBody(response: http.IncomingMessage): Promise<string> {
  let body = '';
  for await (const rawChunk of response) {
    body += rawChunk.toString();
  }
  return body;
}

async function* parseSSE(
  response: http.IncomingMessage,
  extractChunk: (data: string) => string | null
): AsyncGenerator<string> {
  let buffer = '';
  response.setEncoding('utf8');

  for await (const rawChunk of response) {
    buffer += rawChunk.toString();

    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      const text = extractChunk(data);
      if (text) yield text;
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith('data: ')) {
      const data = trimmed.slice(6);
      const text = extractChunk(data);
      if (text) yield text;
    }
  }
}

async function* parseNDJSON(
  response: http.IncomingMessage,
  extractChunk: (obj: any) => string | null
): AsyncGenerator<string> {
  let buffer = '';
  response.setEncoding('utf8');

  for await (const rawChunk of response) {
    buffer += rawChunk.toString();

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        const text = extractChunk(obj);
        if (text) yield text;
      } catch {
        // skip malformed lines
      }
    }
  }

  if (buffer.trim()) {
    try {
      const obj = JSON.parse(buffer.trim());
      const text = extractChunk(obj);
      if (text) yield text;
    } catch {}
  }
}
