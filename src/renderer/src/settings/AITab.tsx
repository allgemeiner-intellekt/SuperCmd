/** LLM provider, credentials and model configuration. */
import React, { useState, useEffect } from 'react';
import { Brain, Eye, EyeOff } from 'lucide-react';
import { OPENAI_MODELS, DEFAULT_OPENAI_MODEL } from '../../../shared/ai-models';
import type { AppSettings, AISettings } from '../../types/electron';
import { useI18n } from '../i18n';
const getProviderOptions = (t: (key: string) => string) => [
  { id: 'openai' as const, label: t('settings.ai.llm.provider.openai'), description: t('settings.ai.llm.providerDescriptions.openai') },
  { id: 'openai-compatible' as const, label: t('settings.ai.llm.provider.openaiCompatible'), description: t('settings.ai.llm.providerDescriptions.openaiCompatible') },
];

const AITab: React.FC = () => {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showOpenAICompatibleKey, setShowOpenAICompatibleKey] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  useEffect(() => { window.electron.getSettings().then(setSettings); }, []);
  const updateAI = async (patch: Partial<AISettings>) => {
    if (!settings) return;
    const newAI = { ...settings.ai, ...patch };
    setSettings(prev => prev ? { ...prev, ai: newAI } : prev);
    const updated = await window.electron.saveSettings({ ai: newAI });
    setSettings(updated);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1600);
  };
  if (!settings) return <div className="p-5">{t('settings.ai.loading')}</div>;
  const ai = settings.ai;
  const genericModels = ai.provider === 'openai-compatible'
    ? (ai.openaiCompatibleModel ? [{ id: `openai-compatible-${ai.openaiCompatibleModel}`, label: ai.openaiCompatibleModel }] : [])
    : [...OPENAI_MODELS, ...(!OPENAI_MODELS.some(m => m.id === ai.defaultModel) ? [{ id: ai.defaultModel, label: ai.defaultModel.replace(/^openai-/, '') }] : [])];
  const AIRow: React.FC<{
    icon: React.ReactNode;
    title: string;
    description: string;
    withBorder?: boolean;
    children: React.ReactNode;
  }> = ({ icon, title, description, withBorder = true, children }) => (
    <div
      className={`grid gap-3 px-4 py-3.5 md:px-5 md:grid-cols-[220px_minmax(0,1fr)] ${
        withBorder ? 'border-b border-[var(--ui-divider)]' : ''
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 text-[var(--text-muted)] shrink-0">{icon}</div>
        <div className="min-w-0">
          <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="mt-0.5 text-[0.75rem] text-[var(--text-muted)] leading-snug">{description}</p>
        </div>
      </div>
      <div className="flex items-center min-h-[32px]">{children}</div>
    </div>
  );

  const SectionToggle = ({
    enabled,
    onToggle,
    label,
  }: {
    enabled: boolean;
    onToggle: () => void;
    label: string;
  }) => (
    <button
      onClick={onToggle}
      className={`relative w-10 h-6 rounded-full border transition-colors ${
        enabled
          ? 'bg-[var(--accent)] border-[var(--accent-hover)]'
          : 'bg-[var(--ui-segment-bg)] border-[var(--ui-segment-border)]'
      }`}
      aria-label={label}
    >
      <span
        className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border shadow-sm transition-all ${
          enabled
            ? 'right-0.5 left-auto bg-[var(--bg-overlay-strong)] border-[var(--ui-segment-border)]'
            : 'left-0.5 right-auto bg-[var(--bg-overlay-strong)] border-[var(--ui-segment-border)]'
        }`}
      />
    </button>
  );

  return (
    <div className="w-full max-w-[980px] mx-auto">
      <div className="overflow-hidden rounded-xl border border-[var(--ui-panel-border)] bg-[var(--settings-panel-bg)]">
      <AIRow
        icon={<Brain className="w-4 h-4" />}
        title={t('settings.ai.enableAI.title')}
        description={t('settings.ai.enableAI.description')}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => updateAI({ enabled: !ai.enabled })}
            className={`relative w-10 h-6 rounded-full border transition-colors ${
              ai.enabled
                ? 'bg-[var(--accent)] border-[var(--accent-hover)]'
                : 'bg-[var(--ui-segment-bg)] border-[var(--ui-segment-border)]'
            }`}
          >
            <span
              className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border shadow-sm transition-all ${
                ai.enabled
                  ? 'right-0.5 left-auto bg-[var(--bg-overlay-strong)] border-[var(--ui-segment-border)]'
                  : 'left-0.5 right-auto bg-[var(--bg-overlay-strong)] border-[var(--ui-segment-border)]'
              }`}
            />
          </button>
          {saveStatus === 'saved' && <span className="text-[0.75rem] text-green-400">{t('settings.ai.saved')}</span>}
        </div>
      </AIRow>

      <div className={`${!ai.enabled ? 'opacity-65 pointer-events-none select-none' : ''}`}>
        {(
          <div className="grid grid-cols-1">
            <div className={`px-4 py-3.5 md:px-5 space-y-3 self-start `}>
              <div className="flex items-center justify-between gap-3 pb-1">
                <div>
                  <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.llm.enableLLM.title')}</h3>
                  <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">{t('settings.ai.llm.enableLLM.description')}</p>
                </div>
                <SectionToggle
                  enabled={ai.llmEnabled !== false}
                  onToggle={() => updateAI({ llmEnabled: ai.llmEnabled === false })}
                  label={t('settings.ai.llm.enableLLM.title')}
                />
              </div>

              <div className={`${ai.llmEnabled === false ? 'opacity-65 pointer-events-none select-none' : ''}`}>
              <div>
                <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.llm.modelSelection.title')}</h3>
                <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">{t('settings.ai.llm.modelSelection.description')}</p>
              </div>

{ai.provider === 'openai' && (<>
                <div>
                  <label className="text-[0.75rem] text-[var(--text-secondary)] mb-1 block">{t('settings.ai.apiKeys.openai.label')}</label>
                  <div className="relative">
                    <input
                      type={showOpenAIKey ? 'text' : 'password'}
                      value={ai.openaiApiKey}
                      onChange={(e) => updateAI({ openaiApiKey: e.target.value.trim() })}
                      placeholder={t('settings.ai.apiKeys.openai.placeholder')}
                      className="sc-input pr-9"
                    />
                    <button
                      onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    >
                      {showOpenAIKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

              </>)}
              <div>
                  <label className="text-[0.75rem] text-[var(--text-secondary)] mb-1 block">{t('settings.ai.llm.provider.label')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {getProviderOptions(t).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          updateAI({ provider: p.id, defaultModel: p.id === 'openai' ? DEFAULT_OPENAI_MODEL : (ai.openaiCompatibleModel ? `openai-compatible-${ai.openaiCompatibleModel}` : '') });
                        }}
                        className={`rounded-md border px-2 py-2 text-left transition-colors ${
                          ai.provider === p.id
                            ? 'bg-[var(--launcher-card-selected-bg)] border-[var(--launcher-card-selected-border)] text-[var(--text-primary)]'
                            : 'bg-[var(--ui-segment-bg)] border-[var(--ui-divider)] text-[var(--text-muted)] hover:bg-[var(--ui-segment-bg)]'
                        }`}
                      >
                        <div className="text-xs font-medium leading-tight">{p.label}</div>
                        <div className="text-[0.625rem] text-[var(--text-subtle)] mt-0.5 leading-tight">{p.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {ai.provider === 'openai-compatible' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.llm.openaiCompatible.baseUrl.label')}</label>
                      <input
                        type="text"
                        value={ai.openaiCompatibleBaseUrl}
                        onChange={(e) => updateAI({ openaiCompatibleBaseUrl: e.target.value.trim() })}
                        placeholder="https://api.openrouter.ai/v1"
                        className="sc-input"
                      />
                      <p className="text-[0.625rem] text-[var(--text-subtle)] mt-1">{t('settings.ai.llm.openaiCompatible.baseUrl.hint')}</p>
                      <label className="inline-flex items-center gap-2 text-[0.6875rem] text-[var(--text-muted)] mt-1.5">
                        <input
                          type="checkbox"
                          checked={ai.openaiCompatibleAppendV1 !== false}
                          onChange={(e) => updateAI({ openaiCompatibleAppendV1: e.target.checked })}
                          className="settings-checkbox"
                        />
                        <span>{t('settings.ai.llm.openaiCompatible.baseUrl.appendV1')}</span>
                      </label>
                    </div>

                    <div>
                      <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.llm.openaiCompatible.apiKey.label')}</label>
                      <div className="relative">
                        <input
                          type={showOpenAICompatibleKey ? 'text' : 'password'}
                          value={ai.openaiCompatibleApiKey}
                          onChange={(e) => updateAI({ openaiCompatibleApiKey: e.target.value.trim() })}
                          placeholder="sk-..."
                          className="sc-input pr-9"
                        />
                        <button
                          onClick={() => setShowOpenAICompatibleKey(!showOpenAICompatibleKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-subtle)] hover:text-[var(--text-muted)]"
                        >
                          {showOpenAICompatibleKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.llm.openaiCompatible.modelName.label')}</label>
                      <input
                        type="text"
                        value={ai.openaiCompatibleModel}
                        onChange={(e) => {
                          const modelName = e.target.value.trim();
                          updateAI({
                            openaiCompatibleModel: modelName,
                            defaultModel: modelName ? `openai-compatible-${modelName}` : ''
                          });
                        }}
                        placeholder="anthropic/claude-3.5-sonnet"
                        className="sc-input"
                      />
                      <p className="text-[0.625rem] text-[var(--text-subtle)] mt-1">{t('settings.ai.llm.openaiCompatible.modelName.hint')}</p>
                    </div>
                  </div>
                )}

                <div className="mt-2">
                  <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.llm.defaultModel.label')}</label>
                  <select
                    value={ai.defaultModel}
                    onChange={(e) => updateAI({ defaultModel: e.target.value })}
                    className="sc-select"
                  >
                    {ai.provider !== 'openai' && <option value="">{t('settings.ai.llm.defaultModel.auto')}</option>}
                    {genericModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

              </div>
            </div>
          </div>
        )}

      </div>
      </div>
    </div>
  );
};

export default AITab;
