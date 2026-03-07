import '@/app/styles/text-picker-bubble.css'
import type { PickedInfo, SelectionSkill } from '@/lib/text-picker/shared'

const skillsContainer = document.querySelector<HTMLDivElement>('#skills')
const sourceNode = document.querySelector<HTMLDivElement>('#source')
const toolbarNode = document.querySelector<HTMLDivElement>('#toolbar')

let currentPickedInfo: PickedInfo | null = null
let busy = false

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
    button.textContent = skill.label
    button.dataset.commandId = skill.commandId
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

toolbarNode?.addEventListener('click', async (event) => {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }

  if (target.closest('.skill-btn')) {
    return
  }

  await window.textPicker.hideBubble()
})
