import { Check, Copy, LoaderCircle, RefreshCw } from 'lucide-react'
import { Streamdown } from 'streamdown'
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
  const isWordMode = cardState.status === 'success' && cardState.queryMode === 'word' && Boolean(cardState.wordEntry)
  const isLoading = cardState.status === 'loading'
  const translatedText = cardState.status === 'success' ? cardState.translatedText : ''
  const wordEntry = cardState.status === 'success' ? cardState.wordEntry : undefined
  const translatedPreview =
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
  const shouldRenderMarkdown = !isWordMode && cardState.status === 'success'

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
              <span className="ms-translate-command-panel-label">
                {isWordMode ? (language === 'en' ? 'Dictionary' : '词典') : language === 'en' ? 'Translation' : '译文'}
              </span>
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
              {isWordMode && wordEntry ? (
                <div className="ms-translate-word-card">
                  <div className="ms-translate-word-head">
                    <div className="ms-translate-word-title">{wordEntry.headword}</div>
                    {wordEntry.phonetics.length > 0 ? (
                      <div className="ms-translate-word-phonetics">
                        {wordEntry.phonetics.map((item) => (
                          <span key={`${item.label}-${item.value}`} className="ms-translate-word-phonetic">
                            <span className="ms-translate-word-phonetic-label">{item.label}</span>
                            <span>{item.value}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {wordEntry.definitions.length > 0 ? (
                    <div className="ms-translate-word-section">
                      {wordEntry.definitions.map((item, index) => (
                        <div key={`${item.part ?? 'def'}-${index}`} className="ms-translate-word-definition">
                          {item.part ? <span className="ms-translate-word-part">{item.part}</span> : null}
                          <span>{item.meaning}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {wordEntry.forms.length > 0 ? (
                    <div className="ms-translate-word-section">
                      <div className="ms-translate-word-section-title">
                        {language === 'en' ? 'Word Forms' : '词形变化'}
                      </div>
                      <div className="ms-translate-word-tags">
                        {wordEntry.forms.map((item) => (
                          <span key={`${item.label}-${item.value}`} className="ms-translate-word-tag">
                            {item.label} · {item.value}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {wordEntry.phrases.length > 0 ? (
                    <div className="ms-translate-word-section">
                      <div className="ms-translate-word-section-title">
                        {language === 'en' ? 'Common Phrases' : '常见短语'}
                      </div>
                      <div className="ms-translate-word-list">
                        {wordEntry.phrases.map((item) => (
                          <div key={`${item.text}-${item.meaning}`} className="ms-translate-word-list-item">
                            <div className="ms-translate-word-list-title">{item.text}</div>
                            <div className="ms-translate-word-list-desc">{item.meaning}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {wordEntry.examples.length > 0 ? (
                    <div className="ms-translate-word-section">
                      <div className="ms-translate-word-section-title">
                        {language === 'en' ? 'Examples' : '双语例句'}
                      </div>
                      <div className="ms-translate-word-list">
                        {wordEntry.examples.map((item, index) => (
                          <div key={`${item.source}-${index}`} className="ms-translate-word-list-item">
                            <div className="ms-translate-word-example-source">{item.source}</div>
                            <div className="ms-translate-word-example-target">{item.translated}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : shouldRenderMarkdown ? (
                <Streamdown className="ms-translate-command-markdown" mode="static" isAnimating={false}>
                  {translatedText}
                </Streamdown>
              ) : (
                translatedPreview
              )}
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
