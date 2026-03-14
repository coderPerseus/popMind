import { Check, Copy, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Select } from '@/app/components/ui/select'
import type { TranslateCardState } from '@/app/components/home/use-translate-command'
import type { MainSearchCommand } from '@/app/components/home/query-command'
import { useI18n } from '@/app/i18n'
import { getLanguageLabel, translationEngineLabels } from '@/lib/translation/shared'
import type { TranslationEngineId, TranslationLanguageOption } from '@/lib/translation/types'

type TranslateCardProps = {
  command: MainSearchCommand & { kind: 'translate' }
  cardState: TranslateCardState
  sourceLanguage: string
  targetLanguage: string
  engineId: TranslationEngineId
  enabledEngineIds: TranslationEngineId[]
  copied: boolean
  languages: TranslationLanguageOption[]
  onSourceLanguageChange: (value: string) => void
  onTargetLanguageChange: (value: string) => void
  onEngineChange: (value: TranslationEngineId) => void
  onCopy: () => void
  onRetranslate: () => void
}

export function TranslateCard({
  command,
  cardState,
  sourceLanguage,
  targetLanguage,
  engineId,
  enabledEngineIds,
  copied,
  languages,
  onSourceLanguageChange,
  onTargetLanguageChange,
  onEngineChange,
  onCopy,
  onRetranslate,
}: TranslateCardProps) {
  const { language } = useI18n()
  const isWordMode = cardState.status === 'success' && cardState.queryMode === 'word'
  const isLoading = cardState.status === 'loading'
  const translatedText = cardState.status === 'success' ? cardState.translatedText : ''
  const translatedContent =
    !command.text && cardState.status === 'idle'
      ? language === 'en'
        ? 'Translation output will appear here after you enter content.'
        : '输入内容后，这里会显示翻译结果。'
      : cardState.status === 'loading'
        ? language === 'en'
          ? 'Translating…'
          : '正在翻译，请稍候…'
        : cardState.status === 'error'
          ? cardState.error
          : cardState.status === 'success'
            ? cardState.translatedText
            : language === 'en'
              ? 'Keep typing text to translate'
              : '继续输入要翻译的内容'

  return (
    <div className="ms-command-stack">
      <section className={`ms-translate-command-card ${cardState.status === 'error' ? 'is-error' : ''}`}>
        <div className="ms-translate-command-toolbar">
          <div className="ms-translate-command-select-wrap">
            <Select
              value={sourceLanguage}
              onChange={(event) => onSourceLanguageChange(event.target.value)}
              disabled={isWordMode}
            >
              {languages.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="ms-translate-command-arrow" aria-hidden="true">
            →
          </div>

          <div className="ms-translate-command-select-wrap">
            <Select
              value={targetLanguage}
              onChange={(event) => onTargetLanguageChange(event.target.value)}
              disabled={isWordMode}
            >
              {languages
                .filter((item) => item.code !== 'auto')
                .map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
            </Select>
          </div>
        </div>

        <div className="ms-translate-command-panels">
          <section className="ms-translate-command-panel">
            <div className="ms-translate-command-panel-head">
              <span className="ms-translate-command-panel-label">{language === 'en' ? 'Translation' : '译文'}</span>
              {isLoading ? (
                <span className="ms-translate-command-status">
                  <LoaderCircle size={13} className="ms-translate-command-spin" />
                  {language === 'en' ? 'Translating' : '翻译中'}
                </span>
              ) : cardState.status === 'success' && cardState.detectedSourceLanguage ? (
                <span className="ms-translate-command-status">
                  {language === 'en' ? 'Detected' : '检测为'} {getLanguageLabel(cardState.detectedSourceLanguage)}
                </span>
              ) : null}
            </div>

            <div
              className={`ms-translate-command-panel-body ${
                !command.text && cardState.status === 'idle'
                  ? 'is-placeholder'
                  : cardState.status === 'error'
                    ? 'is-error'
                    : ''
              }`}
            >
              {translatedContent}
            </div>
          </section>
        </div>

        <div className="ms-translate-command-footer">
          <div className="ms-translate-command-engine-select-wrap">
            <Select
              value={engineId}
              onChange={(event) => onEngineChange(event.target.value as TranslationEngineId)}
              disabled={isWordMode}
            >
              {enabledEngineIds.map((item) => (
                <option key={item} value={item}>
                  {translationEngineLabels[item]}
                </option>
              ))}
            </Select>
          </div>

          <div className="ms-translate-command-footer-actions">
            <Button
              className="ms-translate-command-action-btn"
              variant="ghost"
              size="sm"
              onClick={onCopy}
              disabled={!translatedText || isLoading}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? (language === 'en' ? 'Copied' : '已复制') : language === 'en' ? 'Copy' : '复制'}</span>
            </Button>

            <Button
              className="ms-translate-command-action-btn is-primary"
              variant="ghost"
              size="sm"
              onClick={onRetranslate}
              disabled={isLoading || !command.text}
            >
              <RefreshCw size={13} className={isLoading ? 'ms-translate-command-spin' : ''} />
              <span>{language === 'en' ? 'Translate Again' : '重新翻译'}</span>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
