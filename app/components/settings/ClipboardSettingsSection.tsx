import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/app/components/ui/alert-dialog'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/app/components/ui/radio-group'
import { Select } from '@/app/components/ui/select'
import { Switch } from '@/app/components/ui/switch'
import { useConveyor } from '@/app/hooks/use-conveyor'
import {
  InlineMessage,
  SegmentedControl,
  SettingsBlock,
  SettingsGroup,
  SettingsRow,
  StatusText,
} from '@/app/components/settings/settings-kit'
import type { AppLanguage } from '@/lib/capability/types'
import { clipT } from '@/lib/clipboard/i18n'
import {
  clipRetentionOptions,
  type ClipAiTrigger,
  type ClipRetention,
  type ClipSourceApp,
  type ClipStats,
  type ClipboardSettings,
  type ClipboardSettingsPatch,
} from '@/lib/clipboard/types'
import { ArrowUpRight, Eye, EyeOff, Plus, RefreshCw, Trash2, X } from 'lucide-react'

type ClipboardTab = 'general' | 'privacy' | 'search' | 'data'

type Props = {
  settings: ClipboardSettings
  language: AppLanguage
  /** Applies the patch locally at once and persists it; `debounce` delays saving (text inputs). */
  onPatch: (patch: ClipboardSettingsPatch, debounce?: boolean) => void
  openUrl: (url: string) => void
}

const JEV_DOCS_URL = 'https://docs.typesafe.ai/introduction'
/** USD per one billion input tokens. */
const JEV_PRICE_PER_BILLION_TOKENS = 42
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9-]+(\.[A-Za-z0-9_-]+)+$/

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

const getCurrentMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const formatCost = (inputTokens: number) => {
  const cost = (inputTokens * JEV_PRICE_PER_BILLION_TOKENS) / 1_000_000_000
  if (cost <= 0) return '$0.00'
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`
}

const getErrorMessage = (error: unknown) => (error instanceof Error && error.message ? error.message : String(error))

const getRegexError = (source: string) => {
  try {
    new RegExp(source)
    return null
  } catch (error) {
    return error instanceof Error
      ? error.message.replace(/^Invalid regular expression:\s*(\/.*?\/[a-z]*:\s*)?/i, '')
      : String(error)
  }
}

/**
 * Text or number input that keeps its own draft while typing, so settings pushed from the main process
 * never overwrite what is being typed. `number` inputs commit on blur / Enter, text inputs on every change.
 */
function DraftInput({
  value,
  onCommit,
  kind = 'text',
  min = 0,
  ...inputProps
}: {
  value: string | number
  onCommit: (value: string | number) => void
  kind?: 'text' | 'number'
  min?: number
} & Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'onBlur' | 'min'>) {
  const [draft, setDraft] = useState(String(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(String(value))
  }, [value, focused])

  const commitNumber = () => {
    const parsed = Math.round(Number(draft))
    if (draft.trim() === '' || !Number.isFinite(parsed) || parsed < min) {
      setDraft(String(value))
      return
    }
    setDraft(String(parsed))
    if (parsed !== value) onCommit(parsed)
  }

  return (
    <Input
      {...inputProps}
      type={kind === 'number' ? 'text' : inputProps.type}
      inputMode={kind === 'number' ? 'numeric' : inputProps.inputMode}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(event) => {
        setDraft(event.target.value)
        if (kind === 'text') onCommit(event.target.value)
      }}
      onBlur={() => {
        setFocused(false)
        if (kind === 'number') commitNumber()
      }}
      onKeyDown={(event) => {
        if (kind === 'number' && event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

function AppIcon({ app, size = 16 }: { app?: ClipSourceApp; size?: number }) {
  const [failed, setFailed] = useState(false)

  if (app?.iconUrl && !failed) {
    return (
      <img
        src={app.iconUrl}
        alt=""
        width={size}
        height={size}
        className="st-app-icon"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <span className="st-app-icon is-fallback" style={{ width: size, height: size, fontSize: size * 0.6 }}>
      {(app?.name || app?.bundleId || '?').charAt(0).toUpperCase()}
    </span>
  )
}

export function ClipboardSettingsSection({ settings, language, onPatch, openUrl }: Props) {
  const clipboard = useConveyor('clipboard')
  const [tab, setTab] = useState<ClipboardTab>('general')
  const c = useCallback(
    (key: string, params?: Record<string, string | number>) => clipT(language, `clip.settings.${key}`, params),
    [language]
  )

  return (
    <>
      <div className="st-toolbar-row">
        <SegmentedControl
          ariaLabel={c('nav')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'general', label: c('tab.general') },
            { value: 'privacy', label: c('tab.privacy') },
            { value: 'search', label: c('tab.search') },
            { value: 'data', label: c('tab.data') },
          ]}
        />
      </div>

      {tab === 'general' ? <GeneralTab settings={settings} c={c} onPatch={onPatch} /> : null}
      {tab === 'privacy' ? (
        <PrivacyTab settings={settings} language={language} c={c} onPatch={onPatch} listApps={clipboard.listApps} />
      ) : null}
      {tab === 'search' ? (
        <SearchTab settings={settings} c={c} onPatch={onPatch} openUrl={openUrl} aiTest={clipboard.aiTest} />
      ) : null}
      {tab === 'data' ? <DataTab c={c} stats={clipboard.stats} clearHistory={clipboard.clearHistory} /> : null}
    </>
  )
}

type Translate = (key: string, params?: Record<string, string | number>) => string

// ---------------------------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------------------------

function GeneralTab({
  settings,
  c,
  onPatch,
}: {
  settings: ClipboardSettings
  c: Translate
  onPatch: Props['onPatch']
}) {
  return (
    <>
      <SettingsGroup title={c('group.record')}>
        <SettingsRow label={c('capture.title')} description={c('capture.desc')}>
          <Switch checked={settings.enabled} onCheckedChange={(enabled) => onPatch({ enabled })} />
        </SettingsRow>
        <SettingsRow label={c('retention.title')} description={c('retention.desc')}>
          <Select
            className="st-select"
            value={settings.retention}
            onChange={(event) => onPatch({ retention: event.target.value as ClipRetention })}
          >
            {clipRetentionOptions.map((option) => (
              <option key={option} value={option}>
                {c(`retention.${option}`)}
              </option>
            ))}
          </Select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={c('group.storage')}>
        <SettingsRow label={c('storage.max.title')} description={c('storage.max.desc')}>
          <DraftInput
            kind="number"
            className="st-input is-number"
            aria-label={c('storage.max.title')}
            value={settings.maxStorageMb}
            min={0}
            onCommit={(value) => onPatch({ maxStorageMb: Number(value) })}
          />
          <span className="st-value">{c('unit.mb')}</span>
        </SettingsRow>
        <SettingsRow label={c('storage.item.title')} description={c('storage.item.desc')}>
          <DraftInput
            kind="number"
            className="st-input is-number"
            aria-label={c('storage.item.title')}
            value={settings.maxItemMb}
            min={1}
            onCommit={(value) => onPatch({ maxItemMb: Number(value) })}
          />
          <span className="st-value">{c('unit.mb')}</span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={c('group.paste')}>
        <SettingsRow label={c('enter.title')} description={c('enter.desc')}>
          <RadioGroup
            className="st-radio-group"
            value={settings.directPaste ? 'paste' : 'copy'}
            onValueChange={(value) => onPatch({ directPaste: value === 'paste' })}
            aria-label={c('enter.title')}
          >
            <Label htmlFor="clip-enter-paste" className="st-radio-option">
              <RadioGroupItem id="clip-enter-paste" value="paste" className="st-radio" />
              {c('enter.paste')}
            </Label>
            <Label htmlFor="clip-enter-copy" className="st-radio-option">
              <RadioGroupItem id="clip-enter-copy" value="copy" className="st-radio" />
              {c('enter.copy')}
            </Label>
          </RadioGroup>
        </SettingsRow>
        <SettingsRow label={c('plain.title')} description={c('plain.desc')}>
          <Switch
            checked={settings.alwaysPlainText}
            onCheckedChange={(alwaysPlainText) => onPatch({ alwaysPlainText })}
          />
        </SettingsRow>
        <SettingsRow label={c('link.title')} description={c('link.desc')}>
          <Switch
            checked={settings.fetchLinkPreviews}
            onCheckedChange={(fetchLinkPreviews) => onPatch({ fetchLinkPreviews })}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------------------------

function PrivacyTab({
  settings,
  language,
  c,
  onPatch,
  listApps,
}: {
  settings: ClipboardSettings
  language: AppLanguage
  c: Translate
  onPatch: Props['onPatch']
  listApps: () => Promise<ClipSourceApp[]>
}) {
  const { privacy } = settings
  const [now, setNow] = useState(() => Date.now())
  const [knownApps, setKnownApps] = useState<ClipSourceApp[]>([])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    void listApps()
      .then((apps) => {
        if (!cancelled) setKnownApps(apps)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [listApps])

  const pausedUntil = settings.pausedUntil
  const isPaused = pausedUntil === -1 || pausedUntil > now
  const pauseLabel = useMemo(() => {
    if (!settings.enabled) return c('pause.disabled')
    if (pausedUntil === -1) return c('pause.indefinite')
    if (pausedUntil > now) {
      const sameDay = new Date(pausedUntil).toDateString() === new Date(now).toDateString()
      const time = new Intl.DateTimeFormat(language, {
        hour: '2-digit',
        minute: '2-digit',
        ...(sameDay ? {} : { month: '2-digit', day: '2-digit' }),
      }).format(pausedUntil)
      return c('pause.until', { time })
    }
    return c('pause.active')
  }, [c, language, now, pausedUntil, settings.enabled])

  const pauseFor = (minutes: number) => {
    const until = Date.now() + minutes * 60_000
    setNow(Date.now())
    onPatch({ pausedUntil: until })
  }

  return (
    <>
      <SettingsGroup title={c('group.pause')}>
        <SettingsRow label={c('pause.status')}>
          <StatusText tone={!settings.enabled ? 'neutral' : isPaused ? 'warning' : 'success'}>{pauseLabel}</StatusText>
        </SettingsRow>
        <SettingsRow label={c('pause.action')}>
          {isPaused ? (
            <Button size="sm" onClick={() => onPatch({ pausedUntil: 0 })}>
              {c('pause.resume')}
            </Button>
          ) : null}
          <div className="st-button-row is-end">
            <Button size="sm" variant="outline" disabled={!settings.enabled} onClick={() => pauseFor(15)}>
              {c('pause.15m')}
            </Button>
            <Button size="sm" variant="outline" disabled={!settings.enabled} onClick={() => pauseFor(60)}>
              {c('pause.1h')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!settings.enabled}
              onClick={() => onPatch({ pausedUntil: -1 })}
            >
              {c('pause.forever')}
            </Button>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <IgnoredApps
        c={c}
        bundleIds={privacy.ignoredBundleIds}
        knownApps={knownApps}
        onChange={(ignoredBundleIds) => onPatch({ privacy: { ignoredBundleIds } })}
      />

      <SettingsGroup title={c('group.filters')}>
        <SettingsRow label={c('confidential.title')} description={c('confidential.desc')}>
          <Switch
            checked={privacy.ignoreConfidential}
            onCheckedChange={(ignoreConfidential) => onPatch({ privacy: { ignoreConfidential } })}
          />
        </SettingsRow>
        <SettingsRow label={c('transient.title')} description={c('transient.desc')}>
          <Switch
            checked={privacy.ignoreTransient}
            onCheckedChange={(ignoreTransient) => onPatch({ privacy: { ignoreTransient } })}
          />
        </SettingsRow>
        <SettingsRow label={c('secrets.title')} description={c('secrets.desc')}>
          <Switch
            checked={privacy.detectSecrets}
            onCheckedChange={(detectSecrets) => onPatch({ privacy: { detectSecrets } })}
          />
        </SettingsRow>
      </SettingsGroup>

      <IgnoreRegexps
        c={c}
        rules={privacy.ignoreRegexps}
        onChange={(ignoreRegexps) => onPatch({ privacy: { ignoreRegexps } })}
      />
    </>
  )
}

function IgnoredApps({
  c,
  bundleIds,
  knownApps,
  onChange,
}: {
  c: Translate
  bundleIds: string[]
  knownApps: ClipSourceApp[]
  onChange: (bundleIds: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const [manualError, setManualError] = useState(false)

  const appById = useMemo(() => new Map(knownApps.map((app) => [app.bundleId, app])), [knownApps])
  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return knownApps
      .filter((app) => !bundleIds.includes(app.bundleId))
      .filter(
        (app) => !needle || app.name.toLowerCase().includes(needle) || app.bundleId.toLowerCase().includes(needle)
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [bundleIds, knownApps, query])

  const add = (bundleId: string) => {
    if (bundleIds.includes(bundleId)) return
    onChange([...bundleIds, bundleId])
  }

  const addManual = () => {
    const value = manual.trim()
    if (!BUNDLE_ID_PATTERN.test(value)) {
      setManualError(true)
      return
    }
    add(value)
    setManual('')
    setManualError(false)
  }

  return (
    <SettingsGroup
      title={c('group.ignoredApps')}
      description={c('ignoredApps.desc')}
      accessory={
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) {
              setQuery('')
              setManual('')
              setManualError(false)
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus />
              {c('ignoredApps.add')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="st-popover">
            <Input
              className="st-popover-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={c('ignoredApps.search')}
              aria-label={c('ignoredApps.search')}
            />
            <div className="st-popover-caption">{c('ignoredApps.pick')}</div>
            <div className="st-app-list">
              {candidates.length ? (
                candidates.map((app) => (
                  <button key={app.bundleId} type="button" className="st-app-option" onClick={() => add(app.bundleId)}>
                    <AppIcon app={app} size={22} />
                    <span className="st-app-option-text">
                      <span className="st-app-option-name">{app.name}</span>
                      <span className="st-app-option-id st-mono">{app.bundleId}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="st-empty">{c('ignoredApps.noneFound')}</div>
              )}
            </div>
            <div className="st-popover-caption">{c('ignoredApps.manual')}</div>
            <div className="st-inline-form">
              <Input
                className="st-mono"
                value={manual}
                aria-invalid={manualError || undefined}
                placeholder="com.example.app"
                onChange={(event) => {
                  setManual(event.target.value)
                  setManualError(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addManual()
                }}
              />
              <Button size="sm" variant="outline" disabled={!manual.trim()} onClick={addManual}>
                {c('ignoredApps.manualAdd')}
              </Button>
            </div>
            {manualError ? <div className="st-field-error">{c('ignoredApps.invalid')}</div> : null}
          </PopoverContent>
        </Popover>
      }
    >
      <SettingsBlock>
        {bundleIds.length ? (
          <div className="st-chips">
            {bundleIds.map((bundleId) => {
              const app = appById.get(bundleId)
              const name = app?.name ?? bundleId
              return (
                <span key={bundleId} className="st-chip" title={bundleId}>
                  <AppIcon app={app ?? { bundleId, name: bundleId }} size={14} />
                  <span className={app ? undefined : 'st-mono'}>{name}</span>
                  <button
                    type="button"
                    className="st-chip-remove"
                    aria-label={c('ignoredApps.remove', { name })}
                    onClick={() => onChange(bundleIds.filter((id) => id !== bundleId))}
                  >
                    <X size={11} />
                  </button>
                </span>
              )
            })}
          </div>
        ) : (
          <div className="st-empty is-inline">{c('ignoredApps.empty')}</div>
        )}
      </SettingsBlock>
    </SettingsGroup>
  )
}

function IgnoreRegexps({ c, rules, onChange }: { c: Translate; rules: string[]; onChange: (rules: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const trimmed = draft.trim()
  const regexError = trimmed ? getRegexError(trimmed) : null
  const duplicate = Boolean(trimmed) && rules.includes(trimmed)
  const error = regexError ? c('regex.invalid', { message: regexError }) : duplicate ? c('regex.duplicate') : null
  // Invalid patterns are flagged while typing; the duplicate hint only after an attempt to add.
  const visibleError = regexError ? error : submitted ? error : null

  const add = () => {
    setSubmitted(true)
    if (!trimmed || error) return
    onChange([...rules, trimmed])
    setDraft('')
    setSubmitted(false)
  }

  return (
    <SettingsGroup title={c('group.regex')} description={c('regex.desc')}>
      {rules.length ? (
        rules.map((rule) => (
          <SettingsRow key={rule} label={<span className="st-mono">{rule}</span>}>
            <button
              type="button"
              className="st-icon-button"
              aria-label={c('regex.remove')}
              title={c('regex.remove')}
              onClick={() => onChange(rules.filter((item) => item !== rule))}
            >
              <X size={13} />
            </button>
          </SettingsRow>
        ))
      ) : (
        <SettingsBlock className="st-empty">{c('regex.empty')}</SettingsBlock>
      )}
      <SettingsBlock>
        <div className="st-inline-form">
          <Input
            className="st-mono"
            value={draft}
            aria-invalid={Boolean(visibleError) || undefined}
            placeholder={c('regex.placeholder')}
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value)
              setSubmitted(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add()
            }}
          />
          <Button size="sm" variant="outline" disabled={!trimmed} onClick={add}>
            <Plus />
            {c('regex.add')}
          </Button>
        </div>
        {visibleError ? <div className="st-field-error">{visibleError}</div> : null}
      </SettingsBlock>
    </SettingsGroup>
  )
}

// ---------------------------------------------------------------------------------------------
// Smart search
// ---------------------------------------------------------------------------------------------

function SearchTab({
  settings,
  c,
  onPatch,
  openUrl,
  aiTest,
}: {
  settings: ClipboardSettings
  c: Translate
  onPatch: Props['onPatch']
  openUrl: Props['openUrl']
  aiTest: (ai: ClipboardSettings['ai']) => Promise<{ ok: boolean; model?: string; errorMessage?: string }>
}) {
  const { ai } = settings
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const inputTokens = ai.usage?.month === getCurrentMonth() ? (ai.usage.inputTokens ?? 0) : 0

  const patchAi = (patch: Partial<Omit<ClipboardSettings['ai'], 'usage'>>, debounce = false) => {
    if ('apiKey' in patch || 'model' in patch) setTestResult(null)
    onPatch({ ai: patch }, debounce)
  }

  const runTest = async () => {
    setTestResult(null)
    if (!ai.apiKey.trim()) {
      setTestResult({ tone: 'error', message: c('ai.testNoKey') })
      return
    }

    setTesting(true)
    try {
      const result = await aiTest(ai)
      setTestResult(
        result.ok
          ? {
              tone: 'success',
              message: result.model ? c('ai.testOk', { model: result.model }) : c('ai.testOkPlain'),
            }
          : { tone: 'error', message: c('ai.testFailed', { message: result.errorMessage ?? '—' }) }
      )
    } catch (error) {
      setTestResult({ tone: 'error', message: c('ai.testFailed', { message: getErrorMessage(error) }) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <SettingsGroup title={c('group.ocr')}>
        <SettingsRow label={c('ocr.title')} description={c('ocr.desc')}>
          <Switch checked={settings.ocr.enabled} onCheckedChange={(enabled) => onPatch({ ocr: { enabled } })} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title={c('group.ai')}
        description={c('ai.desc')}
        footer={
          <>
            {testResult ? <InlineMessage tone={testResult.tone}>{testResult.message}</InlineMessage> : null}
            <InlineMessage tone="info">{c('ai.privacy')}</InlineMessage>
          </>
        }
      >
        <SettingsRow label={c('ai.enable')}>
          <Switch checked={ai.enabled} onCheckedChange={(enabled) => patchAi({ enabled })} />
        </SettingsRow>
        <SettingsRow label={c('ai.provider')}>
          <span className="st-value">{c('ai.providerName')}</span>
          <Button size="sm" variant="link" onClick={() => openUrl(JEV_DOCS_URL)}>
            {c('ai.docs')}
            <ArrowUpRight />
          </Button>
        </SettingsRow>
        <SettingsRow label={c('ai.apiKey')}>
          <DraftInput
            className="st-input"
            type={showKey ? 'text' : 'password'}
            value={ai.apiKey}
            autoComplete="off"
            spellCheck={false}
            placeholder={c('ai.apiKeyPlaceholder')}
            aria-label={c('ai.apiKey')}
            onCommit={(apiKey) => patchAi({ apiKey: String(apiKey) }, true)}
          />
          <button
            type="button"
            className="st-icon-button"
            aria-label={showKey ? c('ai.hide') : c('ai.show')}
            title={showKey ? c('ai.hide') : c('ai.show')}
            onClick={() => setShowKey((current) => !current)}
          >
            {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </SettingsRow>
        <SettingsRow label={c('ai.model')}>
          <DraftInput
            className="st-input"
            value={ai.model}
            spellCheck={false}
            placeholder="jev-latest"
            aria-label={c('ai.model')}
            onCommit={(model) => patchAi({ model: String(model) }, true)}
          />
        </SettingsRow>
        <SettingsRow label={c('ai.trigger')}>
          <RadioGroup
            className="st-radio-group"
            value={ai.trigger}
            onValueChange={(trigger) => patchAi({ trigger: trigger as ClipAiTrigger })}
            aria-label={c('ai.trigger')}
          >
            <Label htmlFor="clip-ai-trigger-manual" className="st-radio-option">
              <RadioGroupItem id="clip-ai-trigger-manual" value="manual" className="st-radio" />
              {c('ai.trigger.manual')}
            </Label>
            <Label htmlFor="clip-ai-trigger-auto" className="st-radio-option">
              <RadioGroupItem id="clip-ai-trigger-auto" value="auto" className="st-radio" />
              {c('ai.trigger.auto')}
            </Label>
          </RadioGroup>
        </SettingsRow>
        <SettingsRow label={c('ai.test')}>
          <Button size="sm" variant="outline" disabled={testing} onClick={() => void runTest()}>
            {testing ? c('ai.testing') : c('ai.test')}
          </Button>
        </SettingsRow>
        <SettingsRow label={c('ai.usage.title')} description={c('ai.usage.desc')}>
          <span className="st-value">
            {c('ai.usage.value', { tokens: inputTokens.toLocaleString(), cost: formatCost(inputTokens) })}
          </span>
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------

function DataTab({
  c,
  stats: loadStats,
  clearHistory,
}: {
  c: Translate
  stats: () => Promise<ClipStats>
  clearHistory: () => Promise<{ ok: boolean; deletedCount: number }>
}) {
  const [stats, setStats] = useState<ClipStats | null>(null)
  const [statsFailed, setStatsFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearMessage, setClearMessage] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setStats(await loadStats())
      setStatsFailed(false)
    } catch {
      setStatsFailed(true)
    } finally {
      setLoading(false)
    }
  }, [loadStats])

  useEffect(() => {
    void refresh()

    const handleVisibility = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [refresh])

  const confirmClear = async () => {
    setClearMessage(null)
    setClearing(true)
    try {
      const result = await clearHistory()
      setClearMessage(
        result.ok
          ? { tone: 'success', message: c('clear.done', { count: result.deletedCount }) }
          : { tone: 'error', message: c('clear.failed') }
      )
    } catch {
      setClearMessage({ tone: 'error', message: c('clear.failed') })
    } finally {
      setClearing(false)
      await refresh()
    }
  }

  const rows: Array<{ key: string; value: string }> = [
    { key: 'usage.items', value: stats ? stats.itemCount.toLocaleString() : '—' },
    { key: 'usage.pinned', value: stats ? stats.pinnedItemCount.toLocaleString() : '—' },
    { key: 'usage.db', value: stats ? formatBytes(stats.databaseBytes) : '—' },
    { key: 'usage.files', value: stats ? formatBytes(stats.blobBytes) : '—' },
    { key: 'usage.ocr', value: stats ? stats.ocrPending.toLocaleString() : '—' },
  ]

  return (
    <>
      <SettingsGroup
        title={c('group.usage')}
        footer={
          <>
            {statsFailed ? <InlineMessage tone="error">{c('usage.failed')}</InlineMessage> : null}
            <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refresh()}>
              <RefreshCw className={loading ? 'st-spin' : undefined} />
              {c('usage.refresh')}
            </Button>
          </>
        }
      >
        {rows.map((row) => (
          <SettingsRow key={row.key} label={c(row.key)}>
            <span className="st-value">{row.value}</span>
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup
        title={c('group.clear')}
        footer={
          clearMessage ? <InlineMessage tone={clearMessage.tone}>{clearMessage.message}</InlineMessage> : undefined
        }
      >
        <SettingsRow label={c('clear.title')} description={c('clear.desc')}>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={clearing}>
                <Trash2 />
                {clearing ? c('clear.clearing') : c('clear.button')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>{c('clear.confirmTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{c('clear.confirmDesc')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{c('clear.cancel')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void confirmClear()}>
                  {c('clear.confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}
