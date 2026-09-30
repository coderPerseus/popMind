import { Check, Pause, Play, SkipForward, Square } from 'lucide-react'
import type { AppLanguage } from '@/lib/capability/types'
import { todoT } from '@/lib/todo-focus/i18n'
import type { FocusState } from '@/lib/todo-focus/types'
import { formatClock, useFocusRemaining } from '@/app/components/todo-focus/use-todo-focus'
import { cn } from '@/lib/utils'

type FocusCardProps = {
  focus: FocusState
  language: AppLanguage
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onSkipBreak: () => void
  onCompleteTask: () => void
}

const RING_SIZE = 44
const RING_STROKE = 3.5
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

export function FocusCard({ focus, language, onPause, onResume, onStop, onSkipBreak, onCompleteTask }: FocusCardProps) {
  const remaining = useFocusRemaining(focus)
  const isBreak = focus.phase !== 'focus'
  const progress = focus.durationMs ? 1 - remaining / focus.durationMs : 0
  const phaseLabel = focus.paused
    ? todoT(language, 'focus.paused')
    : todoT(
        language,
        focus.phase === 'focus'
          ? 'focus.focusing'
          : focus.phase === 'longBreak'
            ? 'focus.longBreak'
            : 'focus.shortBreak'
      )

  return (
    <div className={cn('tf-focus', isBreak && 'is-break', focus.paused && 'is-paused')}>
      <svg className="tf-focus-ring" width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
        <circle className="tf-focus-ring-track" cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} />
        <circle
          className="tf-focus-ring-value"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - Math.min(1, Math.max(0, progress)))}
        />
      </svg>

      <div className="tf-focus-clock">{formatClock(remaining)}</div>

      <div className="tf-focus-body">
        <div className="tf-focus-title">{focus.taskTitle ?? todoT(language, 'focus.noTask')}</div>
        <div className="tf-focus-meta">
          <span>{phaseLabel}</span>
          {focus.phase === 'focus' ? (
            <span>· {todoT(language, 'focus.round', { count: focus.cycleCount + 1 })}</span>
          ) : null}
        </div>
      </div>

      <div className="tf-focus-actions">
        {focus.paused ? (
          <button type="button" className="tf-button" onClick={onResume}>
            <Play size={14} />
            {todoT(language, 'focus.resume')}
          </button>
        ) : (
          <button type="button" className="tf-button" onClick={onPause}>
            <Pause size={14} />
            {todoT(language, 'focus.pause')}
          </button>
        )}
        {focus.taskId && focus.phase === 'focus' ? (
          <button type="button" className="tf-button" onClick={onCompleteTask}>
            <Check size={14} />
            {todoT(language, 'focus.completeTask')}
          </button>
        ) : null}
        {isBreak ? (
          <button type="button" className="tf-button" onClick={onSkipBreak}>
            <SkipForward size={14} />
            {todoT(language, 'focus.skipBreak')}
          </button>
        ) : (
          <button
            type="button"
            className="tf-button is-quiet"
            onClick={onStop}
            aria-label={todoT(language, 'focus.stop')}
          >
            <Square size={12} />
            {todoT(language, 'focus.stop')}
          </button>
        )}
      </div>
    </div>
  )
}
