// Full-screen moment at the end of a pomodoro: the ring closes, a check draws, then it hands over to a slow
// breathing guide (4 s in, 4 s out) until the user dismisses it.
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { todoT, type TodoI18nKey } from '@/lib/todo-focus/i18n'
import type { FocusCelebration } from '@/lib/todo-focus/types'
import './focus-overlay.css'

const DONE_STAGE_MS = 3400
const BREATH_MS = 4000
const RING_RADIUS = 76
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/** Two soft sine "bell" tones; synthesised so no audio asset is needed. */
const playChime = () => {
  try {
    const context = new AudioContext()
    const now = context.currentTime
    ;[
      { frequency: 784, at: 0 },
      { frequency: 1175, at: 0.18 },
    ].forEach(({ frequency, at }) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0, now + at)
      gain.gain.linearRampToValueAtTime(0.12, now + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 1.8)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(now + at)
      oscillator.stop(now + at + 1.9)
    })
    window.setTimeout(() => void context.close(), 2500)
  } catch {
    // Audio is a nicety; ignore failures.
  }
}

const formatClock = (ms: number) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export function FocusOverlay() {
  const todo = window.conveyor.todo
  const [payload, setPayload] = useState<FocusCelebration | null>(null)
  const [sequence, setSequence] = useState(0)
  const [stage, setStage] = useState<'done' | 'breathe'>('done')
  const [breathIn, setBreathIn] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [breakStarted, setBreakStarted] = useState(false)

  useEffect(
    () =>
      todo.onCelebrate((next) => {
        setPayload(next)
        setSequence((value) => value + 1)
        setStage('done')
        setBreathIn(true)
        setBreakStarted(Boolean(next.breakEndsAt))
        if (next.sound) playChime()
      }),
    [todo]
  )

  // done -> breathe, then alternate the breath label in step with the orb animation.
  useEffect(() => {
    if (!sequence) return
    const toBreathe = window.setTimeout(() => setStage('breathe'), DONE_STAGE_MS)
    return () => window.clearTimeout(toBreathe)
  }, [sequence])

  useEffect(() => {
    if (stage !== 'breathe') return
    setBreathIn(true)
    const timer = window.setInterval(() => setBreathIn((value) => !value), BREATH_MS)
    return () => window.clearInterval(timer)
  }, [stage, sequence])

  useEffect(() => {
    if (!payload?.breakEndsAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [payload])

  const close = useCallback(
    (action: 'rest' | 'skipBreak') => void todo.closeOverlay(payload?.preview ? 'rest' : action),
    [todo, payload]
  )

  const startBreak = useCallback(async () => {
    const state = await todo.startBreak()
    setBreakStarted(true)
    setPayload((current) => (current ? { ...current, breakEndsAt: state.endsAt } : current))
    close('rest')
  }, [todo, close])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault()
        if (event.key === 'Enter' && !breakStarted) void startBreak()
        else close('rest')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [breakStarted, close, startBreak])

  if (!payload) return null

  const t = (key: TodoI18nKey, params?: Record<string, string | number>) => todoT(payload.language, key, params)
  const restLine = t(payload.longBreak ? 'overlay.longRest' : 'overlay.rest', { minutes: payload.breakMinutes })

  return (
    <div className={`fo-root is-${stage}`} key={sequence}>
      <div className="fo-center">
        <div className="fo-stage" aria-hidden>
          <span className="fo-ripple" />
          <span className="fo-ripple" />
          <span className="fo-ripple" />
          <div className="fo-orb" />
          <svg className="fo-done" viewBox="0 0 168 168" width="168" height="168">
            <circle className="fo-ring-track" cx="84" cy="84" r={RING_RADIUS} />
            <circle
              className="fo-ring"
              cx="84"
              cy="84"
              r={RING_RADIUS}
              strokeDasharray={RING_LENGTH}
              style={{ '--fo-ring-length': RING_LENGTH } as CSSProperties}
            />
            <path className="fo-check" d="M60 86 L77 103 L110 68" />
          </svg>
        </div>

        {stage === 'done' ? (
          <div className="fo-text" key="done">
            <h1 className="fo-title">{t('overlay.title')}</h1>
            {payload.taskTitle ? <p className="fo-sub">「{payload.taskTitle}」</p> : null}
            <p className="fo-meta">
              {t('overlay.today', { count: payload.todayPomodoros, minutes: payload.todayFocusMinutes })}
            </p>
          </div>
        ) : (
          <div className="fo-text" key="breathe">
            <h1 className="fo-title fo-breath" key={breathIn ? 'in' : 'out'}>
              {t(breathIn ? 'overlay.breathIn' : 'overlay.breathOut')}
            </h1>
            <p className="fo-sub">{restLine}</p>
            {payload.breakEndsAt ? (
              <p className="fo-meta fo-clock">
                {t('overlay.restLeft', { time: formatClock(payload.breakEndsAt - now) })}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="fo-actions">
        {breakStarted ? (
          <button type="button" className="fo-primary" onClick={() => close('rest')}>
            {t('overlay.ok')}
          </button>
        ) : (
          <button type="button" className="fo-primary" onClick={() => void startBreak()}>
            {t('overlay.startBreak')}
          </button>
        )}
        <button type="button" className="fo-secondary" onClick={() => close(breakStarted ? 'skipBreak' : 'rest')}>
          {t('overlay.skip')}
        </button>
        <span className="fo-hint">{t('overlay.escHint')}</span>
      </div>
    </div>
  )
}
