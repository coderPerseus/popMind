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
const sourceNode = document.querySelector<HTMLDivElement>('#source')
const toolbarNode = document.querySelector<HTMLDivElement>('#toolbar')
const dragHandle = document.querySelector<HTMLButtonElement>('#drag-handle')
const leadLogo = document.querySelector<HTMLButtonElement>('#lead-logo')
const leadLogoImage = document.querySelector<HTMLImageElement>('#lead-logo-image')

if (leadLogoImage) {
  leadLogoImage.src = logoUrl
}

let currentPickedInfo: PickedInfo | null = null
let busy = false
let activePointerId: number | null = null
let lastDragPoint: { x: number; y: number } | null = null

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
      if (!currentPickedInfo || busy) {
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

const renderSource = (sourceApp: string | undefined) => {
  if (!sourceNode) {
    return
  }

  if (sourceApp) {
    sourceNode.textContent = sourceApp
    sourceNode.title = sourceApp
    return
  }

  sourceNode.textContent = ''
  sourceNode.title = ''
}

const applyState = (pickedInfo: PickedInfo | null, skills?: SelectionSkill[]) => {
  currentPickedInfo = pickedInfo
  renderSkills(pickedInfo?.text ? skills : [])
  renderSource(pickedInfo?.appName)
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

  dragHandle?.classList.remove('is-dragging')

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
  window.textPicker.moveBubble(deltaX, deltaY)
})

dragHandle?.addEventListener('pointerup', stopBubbleDrag)
dragHandle?.addEventListener('pointercancel', stopBubbleDrag)
dragHandle?.addEventListener('lostpointercapture', stopBubbleDrag)

leadLogo?.addEventListener('click', async (event) => {
  event.stopPropagation()
  await window.textPicker.openMainWindow()
})

toolbarNode?.addEventListener('click', async (event) => {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }

  if (target.closest('.skill-btn') || target.closest('.drag-handle') || target.closest('.lead-logo')) {
    return
  }

  await window.textPicker.hideBubble()
})
