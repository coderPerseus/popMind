import { useState } from 'react'
import { Streamdown } from 'streamdown'
import { ArrowUpRight, Check, ChevronDown, Copy, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import type { ExplainCardState } from '@/app/components/home/use-explain-command'
import type { MainSearchCommand } from '@/app/components/home/query-command'
import { useI18n } from '@/app/i18n'

type ExplainCardProps = {
  command: MainSearchCommand & { kind: 'explain' }
  cardState: ExplainCardState
  copied: boolean
  onCopy: () => void
  onReexplain: () => void
}

export function ExplainCard({ command, cardState, copied, onCopy, onReexplain }: ExplainCardProps) {
  const { language } = useI18n()
  const [sourcesExpanded, setSourcesExpanded] = useState(false)
  const isLoading = cardState.status === 'loading'
  const explanationText = cardState.status === 'success' ? cardState.text : ''
  const showSources = cardState.status === 'success' && cardState.sources.length > 0
  const content =
    !command.text && cardState.status === 'idle'
      ? language === 'en'
        ? 'Explanation will appear here after you enter text.'
        : '输入内容后，这里会显示解释结果。'
      : cardState.status === 'loading'
        ? language === 'en'
          ? 'Generating explanation…'
          : '正在生成解释，请稍候…'
        : cardState.status === 'error'
          ? cardState.error
          : cardState.status === 'success'
            ? cardState.text
            : language === 'en'
              ? 'Keep typing text to explain'
              : '继续输入要解释的内容'

  return (
    <div className="ms-command-stack">
      <section className={`ms-explain-command-card ${cardState.status === 'error' ? 'is-error' : ''}`}>
        <div className="ms-explain-command-head">
          <div className="ms-explain-command-head-copy">
            <div className="ms-explain-command-eyebrow">{language === 'en' ? 'Explanation' : '解释卡片'}</div>
            <div className="ms-explain-command-query">
              {command.text || (language === 'en' ? 'Enter text to explain' : '输入要解释的文本')}
            </div>
          </div>

          {isLoading ? (
            <div className="ms-explain-command-status">
              <LoaderCircle size={13} className="ms-translate-command-spin" />
              <span>{language === 'en' ? 'Explaining' : '解释中'}</span>
            </div>
          ) : cardState.status === 'success' ? (
            <div className="ms-explain-command-meta">
              <span>{cardState.aiProvider}</span>
              <span>{cardState.modelId}</span>
              {cardState.webSearchProvider ? <span>{cardState.webSearchProvider}</span> : null}
            </div>
          ) : null}
        </div>

        <div
          className={`ms-explain-command-body ${
            !command.text && cardState.status === 'idle'
              ? 'is-placeholder'
              : cardState.status === 'error'
                ? 'is-error'
                : ''
          }`}
        >
          {cardState.status === 'success' ? (
            <Streamdown className="ms-explain-command-markdown" mode="static" isAnimating={false}>
              {content}
            </Streamdown>
          ) : (
            <div className="ms-explain-command-plain">{content}</div>
          )}
        </div>

        {showSources ? (
          <div className={`ms-explain-command-sources-wrap ${sourcesExpanded ? 'is-expanded' : ''}`}>
            <button
              type="button"
              className="ms-explain-command-sources-toggle"
              onClick={() => setSourcesExpanded((current) => !current)}
              aria-expanded={sourcesExpanded}
            >
              <span className="ms-explain-command-sources-copy">
                <strong>
                  {language === 'en' ? 'Sources' : '参考来源'} · {cardState.sources.length}
                </strong>
                <span>
                  {sourcesExpanded
                    ? language === 'en'
                      ? 'Hide sources'
                      : '收起来源'
                    : language === 'en'
                      ? 'Show sources'
                      : '展开来源'}
                </span>
              </span>
              <ChevronDown
                size={14}
                className={`ms-explain-command-sources-icon ${sourcesExpanded ? 'is-expanded' : ''}`}
              />
            </button>

            {sourcesExpanded ? (
              <div className="ms-explain-command-sources">
                {cardState.sources.map((source) => (
                  <a key={`${source.url}-${source.provider}`} href={source.url} target="_blank" rel="noreferrer">
                    <div className="ms-explain-command-source-head">
                      <strong>{source.title}</strong>
                      <ArrowUpRight size={12} />
                    </div>
                    <span>{source.provider}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="ms-explain-command-footer">
          <div className="ms-explain-command-footer-meta">
            {cardState.status === 'success' ? (
              <span>{cardState.language === 'en' ? 'English output' : '中文输出'}</span>
            ) : (
              <span>{language === 'en' ? 'Context-aware explanation' : '带上下文解释'}</span>
            )}
          </div>

          <div className="ms-translate-command-footer-actions">
            <Button
              className="ms-translate-command-action-btn"
              variant="ghost"
              size="sm"
              onClick={onCopy}
              disabled={!explanationText || isLoading}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? (language === 'en' ? 'Copied' : '已复制') : language === 'en' ? 'Copy' : '复制'}</span>
            </Button>

            <Button
              className="ms-translate-command-action-btn is-primary"
              variant="ghost"
              size="sm"
              onClick={onReexplain}
              disabled={isLoading || !command.text}
            >
              <RefreshCw size={13} className={isLoading ? 'ms-translate-command-spin' : ''} />
              <span>{language === 'en' ? 'Explain Again' : '重新解释'}</span>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
