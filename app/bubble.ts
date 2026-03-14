import '@/app/styles/text-picker-bubble.css'
import { getThemeLogoUrl } from '@/app/theme-assets'
import type { PickedInfo, SelectionSkill } from '@/lib/text-picker/shared'
import { SystemCommand } from '@/lib/text-picker/shared'

const SKILL_ICONS: Record<string, string> = {
  [SystemCommand.Translate]: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`,
  [SystemCommand.Explain]: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>`,
  [SystemCommand.Copy]: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  [SystemCommand.Search]: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
}

const skillsContainer = document.querySelector<HTMLDivElement>('#skills')
const toolbarNode = document.querySelector<HTMLDivElement>('#toolbar')
const dragHandle = document.querySelector<HTMLButtonElement>('#drag-handle')
const leadLogoButton = document.querySelector<HTMLButtonElement>('#lead-logo')
const leadLogoImage = document.querySelector<HTMLImageElement>('#lead-logo-image')
const SYNTHETIC_CLICK_GUARD_MS = 320
const BUBBLE_WIDTH_PADDING = 2
const bubbleLog = (...args: unknown[]) => {
  console.info('[bubble]', new Date().toISOString(), ...args)
}

const syncLeadLogo = () => {
  if (leadLogoImage) {
    leadLogoImage.src = getThemeLogoUrl()
  }
}

syncLeadLogo()

const themeObserver = new MutationObserver(syncLeadLogo)
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
window.addEventListener('beforeunload', () => themeObserver.disconnect())

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return
  }

  event.preventDefault()
  void window.textPicker.dismissTopmost()
})

let currentPickedInfo: PickedInfo | null = null
let busy = false
let activePointerId: number | null = null
let lastDragPoint: { x: number; y: number } | null = null
let suppressPointerActivationsUntil = 0
let widthMeasureFrame = 0

const noteBubbleInteraction = () => {
  bubbleLog('notifyBubbleInteraction')
  window.textPicker.notifyBubbleInteraction()
}

const setBusy = (state: boolean) => {
  busy = state
  bubbleLog('setBusy', { state })

  if (!skillsContainer) {
    return
  }

  const buttons = skillsContainer.querySelectorAll<HTMLButtonElement>('.skill-btn')
  for (const button of buttons) {
    button.disabled = state
    button.style.opacity = state ? '0.5' : '1'
  }

  queueBubbleWidthMeasurement()
}

const queueBubbleWidthMeasurement = () => {
  if (widthMeasureFrame) {
    cancelAnimationFrame(widthMeasureFrame)
  }

  widthMeasureFrame = requestAnimationFrame(() => {
    widthMeasureFrame = 0

    if (!toolbarNode) {
      return
    }

    const nextWidth = Math.ceil(toolbarNode.scrollWidth + BUBBLE_WIDTH_PADDING)
    bubbleLog('resizeBubble', { nextWidth, scrollWidth: toolbarNode.scrollWidth })
    window.textPicker.resizeBubble(nextWidth)
  })
}

const invokeSkillCommand = async (skill: SelectionSkill, origin: 'pointerdown' | 'keyboard') => {
  suppressPointerActivationsUntil = Date.now() + SYNTHETIC_CLICK_GUARD_MS
  noteBubbleInteraction()

  if (!currentPickedInfo || busy) {
    bubbleLog('skill:invoke:ignored', {
      commandId: skill.commandId,
      origin,
      hasPickedInfo: Boolean(currentPickedInfo),
      busy,
    })
    return
  }

  setBusy(true)
  try {
    bubbleLog('skill:invoke', {
      commandId: skill.commandId,
      origin,
      selectionId: currentPickedInfo.selectionId,
      textPreview: currentPickedInfo.text.slice(0, 40),
    })
    const result = await window.textPicker.triggerCommand(skill.commandId, currentPickedInfo.selectionId)
    bubbleLog('skill:invoke:result', {
      commandId: skill.commandId,
      origin,
      selectionId: currentPickedInfo.selectionId,
      result,
    })
  } finally {
    setBusy(false)
  }
}

const invokeLeadLogo = async (origin: 'pointerdown' | 'keyboard') => {
  bubbleLog('leadLogo:invoke', { origin })
  suppressPointerActivationsUntil = Date.now() + SYNTHETIC_CLICK_GUARD_MS
  noteBubbleInteraction()
  await window.textPicker.openMainWindow(currentPickedInfo?.text ?? '')
}

const renderSkills = (skills: SelectionSkill[] | undefined) => {
  if (!skillsContainer) {
    return
  }

  skillsContainer.replaceChildren()

  if (!skills?.length) {
    return
  }

  skills.forEach((skill, index) => {
    if (index > 0) {
      const separator = document.createElement('div')
      separator.className = 'separator'
      skillsContainer.appendChild(separator)
    }

    const button = document.createElement('button')
    button.className = 'skill-btn'
    button.dataset.commandId = skill.commandId

    const iconSvg = SKILL_ICONS[skill.commandId]
    if (iconSvg) {
      const iconSpan = document.createElement('span')
      iconSpan.className = 'skill-icon'
      iconSpan.innerHTML = iconSvg
      button.appendChild(iconSpan)
    }

    const labelSpan = document.createElement('span')
    labelSpan.textContent = skill.label
    button.appendChild(labelSpan)

    button.disabled = busy
    button.style.opacity = busy ? '0.5' : '1'

    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      bubbleLog('skill:pointerdown', {
        commandId: skill.commandId,
        selectionId: currentPickedInfo?.selectionId ?? null,
        textLength: currentPickedInfo?.text.length ?? 0,
      })
      void invokeSkillCommand(skill, 'pointerdown')
    })

    button.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.detail !== 0) {
        bubbleLog('skill:click:suppressed', {
          commandId: skill.commandId,
        })
        return
      }

      void invokeSkillCommand(skill, 'keyboard')
    })

    skillsContainer.appendChild(button)
  })
}

const applyState = (pickedInfo: PickedInfo | null, skills?: SelectionSkill[]) => {
  currentPickedInfo = pickedInfo
  bubbleLog('applyState', {
    hasPickedInfo: Boolean(pickedInfo),
    selectionId: pickedInfo?.selectionId ?? null,
    textLength: pickedInfo?.text.length ?? 0,
    skills: (skills || []).map((skill) => skill.commandId),
  })
  renderSkills(pickedInfo?.text ? skills : [])
  queueBubbleWidthMeasurement()
}

window.textPicker.onUpdate((payload) => {
  bubbleLog('onUpdate', payload)
  applyState(
    {
      text: payload.selectionText || '',
      appName: payload.sourceApp || '',
      appId: payload.sourceBundleId || '',
      scene: payload.scene || '',
      selectionId: payload.selectionId || '',
      strategy: 'none',
      hasRect: false,
      rect: null,
    },
    payload.skills
  )
})

const hydrateBubble = async () => {
  try {
    bubbleLog('hydrate:start')
    const [pickedInfo, skillsResult] = await Promise.all([
      window.textPicker.getPickedInfo(),
      window.textPicker.getSkills(),
    ])
    bubbleLog('hydrate:resolved', {
      pickedInfo,
      skills: skillsResult.skills.map((skill) => skill.commandId),
    })
    applyState(pickedInfo, skillsResult.skills)
  } catch (error) {
    console.error('[bubble] failed to hydrate state', error)
  }
}

void hydrateBubble()

// ---------------------------------------------------------------------------
// Drag handle — JS pointer-capture drag (no -webkit-app-region: drag, which
// activates the Electron app and breaks the non-activating panel behaviour).
// ---------------------------------------------------------------------------

const stopBubbleDrag = () => {
  if (activePointerId == null) {
    return
  }

  bubbleLog('drag:stop', { activePointerId })
  suppressPointerActivationsUntil = Date.now() + SYNTHETIC_CLICK_GUARD_MS
  dragHandle?.classList.remove('is-dragging')

  if (dragHandle?.hasPointerCapture(activePointerId)) {
    dragHandle.releasePointerCapture(activePointerId)
  }

  activePointerId = null
  lastDragPoint = null
  window.textPicker.setBubbleDragging(false)
}

leadLogoButton?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  bubbleLog('leadLogo:pointerdown')
  leadLogoButton.classList.add('is-pressed')
  void invokeLeadLogo('pointerdown')
})

leadLogoButton?.addEventListener('pointerup', () => {
  leadLogoButton.classList.remove('is-pressed')
})

leadLogoButton?.addEventListener('pointercancel', () => {
  leadLogoButton.classList.remove('is-pressed')
})

leadLogoButton?.addEventListener('click', async (event) => {
  event.preventDefault()
  event.stopPropagation()

  if (event.detail !== 0) {
    bubbleLog('leadLogo:click:suppressed')
    return
  }

  await invokeLeadLogo('keyboard')
})

dragHandle?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  bubbleLog('drag:pointerdown', {
    pointerId: event.pointerId,
    x: event.screenX,
    y: event.screenY,
  })
  activePointerId = event.pointerId
  lastDragPoint = { x: event.screenX, y: event.screenY }
  suppressPointerActivationsUntil = Date.now() + SYNTHETIC_CLICK_GUARD_MS
  noteBubbleInteraction()

  dragHandle.classList.add('is-dragging')
  dragHandle.setPointerCapture(event.pointerId)
  window.textPicker.setBubbleDragging(true)
})

dragHandle?.addEventListener('pointermove', (event) => {
  if (event.pointerId !== activePointerId || !lastDragPoint) {
    return
  }

  const deltaX = event.screenX - lastDragPoint.x
  const deltaY = event.screenY - lastDragPoint.y
  if (deltaX === 0 && deltaY === 0) {
    return
  }

  lastDragPoint = { x: event.screenX, y: event.screenY }
  bubbleLog('drag:pointermove', { deltaX, deltaY })
  window.textPicker.moveBubble(deltaX, deltaY)
})

dragHandle?.addEventListener('pointerup', stopBubbleDrag)
dragHandle?.addEventListener('pointercancel', stopBubbleDrag)
dragHandle?.addEventListener('lostpointercapture', stopBubbleDrag)

// Absorb click so it never reaches the toolbar fallback handler.
dragHandle?.addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
})

// ---------------------------------------------------------------------------
// Toolbar-level event handlers
// ---------------------------------------------------------------------------

// Capture-phase pointerdown: note interaction & set the synthetic-click guard
// for everything except the drag handle (which manages its own guard).
toolbarNode?.addEventListener(
  'pointerdown',
  (event) => {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }

    // Drag handle manages its own pointer lifecycle.
    if (target.closest('.drag-handle')) {
      return
    }

    bubbleLog('toolbar:pointerdown', {
      targetClassName: target instanceof HTMLElement ? target.className : target.tagName,
    })
    noteBubbleInteraction()

    // Skill buttons set the guard themselves; the lead-logo is purely visual,
    // so we only need to guard "empty area" clicks here.
    if (!target.closest('.lead-logo') && !target.closest('.skill-btn')) {
      suppressPointerActivationsUntil = Date.now() + SYNTHETIC_CLICK_GUARD_MS
    }
  },
  true
)

// Bubble-phase click on toolbar: dismiss the bubble when clicking empty space.
toolbarNode?.addEventListener('click', async (event) => {
  if (Date.now() < suppressPointerActivationsUntil) {
    bubbleLog('toolbar:click:guarded')
    event.preventDefault()
    event.stopPropagation()
    return
  }

  const target = event.target
  if (!(target instanceof Element)) {
    return
  }

  if (target.closest('.skill-btn') || target.closest('.drag-handle') || target.closest('.lead-logo')) {
    bubbleLog('toolbar:click:delegated', {
      targetClassName: target instanceof HTMLElement ? target.className : target.tagName,
    })
    return
  }

  event.preventDefault()
  event.stopPropagation()
  bubbleLog('toolbar:click:hide')
  noteBubbleInteraction()
  await window.textPicker.hideBubble()
})
