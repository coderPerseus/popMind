import { Command, Languages, LoaderCircle } from 'lucide-react'
import type { TranslateCardState } from '@/app/components/home/use-translate-command'
import type { MainSearchCommand } from '@/app/components/home/query-command'

type TranslateCardProps = {
  command: MainSearchCommand & { kind: 'translate' }
  cardState: TranslateCardState
}

export function TranslateCard({ command, cardState }: TranslateCardProps) {
  return (
    <div className="ms-command-stack">
      <div className="ms-command-chip">
        <Command size={12} />
        <span>{command.trigger}</span>
        <span className="ms-command-chip-muted">内部翻译命令</span>
      </div>

      {!command.text ? (
        <section className="ms-translate-card is-placeholder">
          <div className="ms-translate-card-header">
            <span className="ms-translate-card-icon">
              <Languages size={16} />
            </span>
            <div>
              <div className="ms-translate-card-title">输入要翻译的文本</div>
              <div className="ms-translate-card-subtitle">示例：`/tr hello world` 或 `/翻译 今天的天气`</div>
            </div>
          </div>
        </section>
      ) : cardState.status === 'loading' ? (
        <section className="ms-translate-card">
          <div className="ms-translate-card-header">
            <span className="ms-translate-card-icon is-loading">
              <LoaderCircle size={16} />
            </span>
            <div>
              <div className="ms-translate-card-title">正在翻译</div>
              <div className="ms-translate-card-subtitle">{cardState.query}</div>
            </div>
          </div>
        </section>
      ) : cardState.status === 'error' ? (
        <section className="ms-translate-card is-error">
          <div className="ms-translate-card-header">
            <span className="ms-translate-card-icon">
              <Languages size={16} />
            </span>
            <div>
              <div className="ms-translate-card-title">翻译失败</div>
              <div className="ms-translate-card-subtitle">{cardState.error}</div>
            </div>
          </div>
        </section>
      ) : cardState.status === 'success' ? (
        <section className="ms-translate-card">
          <div className="ms-translate-card-header">
            <span className="ms-translate-card-icon">
              <Languages size={16} />
            </span>
            <div>
              <div className="ms-translate-card-title">翻译结果</div>
              <div className="ms-translate-card-subtitle">
                {cardState.engineId} · {cardState.sourceLanguage} → {cardState.targetLanguage}
              </div>
            </div>
          </div>

          <div className="ms-translate-source">{cardState.query}</div>
          <div className="ms-translate-output">{cardState.translatedText}</div>

          {cardState.detectedSourceLanguage && (
            <div className="ms-translate-meta">检测语言：{cardState.detectedSourceLanguage}</div>
          )}
        </section>
      ) : null}
    </div>
  )
}
