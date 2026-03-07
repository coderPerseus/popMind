import '@/app/styles/text-picker-bubble.css'
import logoUrl from '@/app/assets/logo.png'
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
const leadLogo = document.querySelector<HTMLButtonElement>('#lead-logo')
const leadLogoImage = document.querySelector<HTMLImageElement>('#lead-logo-image')
const LOGO_ACTIVATION_MAX_DISTANCE = 6
const SYNTHETIC_CLICK_GUARD_MS = 320
const BUBBLE_WIDTH_PADDING = 2

if (leadLogoImage) {
  leadLogoImage.src = logoUrl
}

let currentPickedInfo: PickedInfo | null = null
let busy = false
let activePointerId: number | null = null
let lastDragPoint: { x: number; y: number } | null = null
let suppressPointerActivationsUntil = 0
let logoPressState: { pointerId: number; x: number; y: number } | null = null
let widthMeasureFrame = 0

const setBusy = (state: boolean) => {
  busy = state

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
    window.textPicker.resizeBubble(nextWidth)
  })
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

    button.addEventListener('click', async () => {
      if (!currentPickedInfo || busy || skill.commandId !== SystemCommand.Copy) {
        return
      }

      setBusy(true)
      try {
        await window.textPicker.triggerCommand(skill.commandId, currentPickedInfo.selectionId)
      } finally {
        setBusy(false)
      }
    })

    skillsContainer.appendChild(button)
  })
}

const applyState = (pickedInfo: PickedInfo | null, skills?: SelectionSkill[]) => {
  currentPickedInfo = pickedInfo
  renderSkills(pickedInfo?.text ? skills : [])
  queueBubbleWidthMeasurement()
}

window.textPicker.onUpdate((payload) => {
  applyState({
    text: payload.selectionText || '',
    appName: payload.sourceApp || '',
    appId: payload.sourceBundleId || '',
    scene: payload.scene || '',
    selectionId: payload.selectionId || '',
    strategy: 'none',
    hasRect: false,
    rect: null,
  }, payload.skills)
})

const hydrateBubble = async () => {
  try {
    const [pickedInfo, skillsResult] = await Promise.all([
      window.textPicker.getPickedInfo(),
      window.textPicker.getSkills(),
    ])
    applyState(pickedInfo, skillsResult.skills)
  } catch (error) {
    console.error('[bubble] failed to hydrate state', error)
  }
}

void hydrateBubble()

const stopBubbleDrag = () => {
  if (activePointerId == null) {
    return
  }

  suppressPointerActivationsUntil = Date.now() + SYNTHETIC_CLICK_GUARD_MS
  dragHandle?.classList.remove('is-dragging')
  toolbarNode?.classList.remove('is-dragging')

  if (dragHandle?.hasPointerCapture(activePointerId)) {
    dragHandle.releasePointerCapture(activePointerId)
  }

  activePointerId = null
  lastDragPoint = null
  window.textPicker.setBubbleDragging(false)
}

dragHandle?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  activePointerId = event.pointerId
  lastDragPoint = { x: event.screenX, y: event.screenY }
  suppressPointerActivationsUntil = Date.now() + SYNTHETIC_CLICK_GUARD_MS
  dragHandle.classList.add('is-dragging')
  toolbarNode?.classList.add('is-dragging')
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
  window.textPicker.moveBubble(deltaX, deltaY)
})

dragHandle?.addEventListener('pointerup', stopBubbleDrag)
dragHandle?.addEventListener('pointercancel', stopBubbleDrag)
dragHandle?.addEventListener('lostpointercapture', stopBubbleDrag)
dragHandle?.addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
})

const resetLogoPressState = () => {
  logoPressState = null
  leadLogo?.classList.remove('is-pressed')
}

leadLogo?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || activePointerId != null || Date.now() < suppressPointerActivationsUntil) {
    return
  }

  logoPressState = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  }
  leadLogo.classList.add('is-pressed')
})

leadLogo?.addEventListener('pointermove', (event) => {
  if (!logoPressState || event.pointerId !== logoPressState.pointerId) {
    return
  }

  const distance = Math.hypot(event.clientX - logoPressState.x, event.clientY - logoPressState.y)
  if (distance > LOGO_ACTIVATION_MAX_DISTANCE) {
    resetLogoPressState()
  }
})

leadLogo?.addEventListener('pointerup', async (event) => {
  if (!logoPressState || event.pointerId !== logoPressState.pointerId) {
    return
  }

  const distance = Math.hypot(event.clientX - logoPressState.x, event.clientY - logoPressState.y)
  const rect = leadLogo.getBoundingClientRect()
  const isInsideLogo =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom

  resetLogoPressState()

  if (
    distance > LOGO_ACTIVATION_MAX_DISTANCE ||
    !isInsideLogo ||
    activePointerId != null ||
    Date.now() < suppressPointerActivationsUntil
  ) {
    event.preventDefault()
    event.stopPropagation()
    return
  }

  event.stopPropagation()
  await window.textPicker.openMainWindow()
})

leadLogo?.addEventListener('pointercancel', resetLogoPressState)
leadLogo?.addEventListener('lostpointercapture', resetLogoPressState)
leadLogo?.addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
})

toolbarNode?.addEventListener('click', async (event) => {
  if (Date.now() < suppressPointerActivationsUntil) {
    event.preventDefault()
    event.stopPropagation()
    return
  }

  const target = event.target
  if (!(target instanceof Element)) {
    return
  }

  if (target.closest('.skill-btn') || target.closest('.drag-handle') || target.closest('.lead-logo')) {
    return
  }

  await window.textPicker.hideBubble()
})
