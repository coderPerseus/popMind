import '@/app/styles/text-picker-bubble.css'

const skillsContainer = document.querySelector<HTMLDivElement>('#skills')
const sourceNode = document.querySelector<HTMLDivElement>('#source')
const toolbarNode = document.querySelector<HTMLDivElement>('#toolbar')

let currentPickedInfo: {
  text: string
  sourceApp: string
  sourceBundleId: string
  scene: string
  selectionId: string
} | null = null
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

const renderSkills = (
  skills:
    | {
        commandId: string
        label: string
        enabled: boolean
      }[]
    | undefined,
) => {
  if (!skillsContainer) {
    return
  }

  skillsContainer.innerHTML = ''

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
        await window.textPicker.triggerCommand(skill.commandId)
      } finally {
        setBusy(false)
      }
    })

    skillsContainer.appendChild(button)
  })
}

window.textPicker.onUpdate((payload) => {
  currentPickedInfo = {
    text: payload.selectionText || '',
    sourceApp: payload.sourceApp || '',
    sourceBundleId: payload.sourceBundleId || '',
    scene: payload.scene || '',
    selectionId: payload.selectionId || '',
  }

  if (payload.skills) {
    renderSkills(payload.skills)
  }

  if (!sourceNode) {
    return
  }

  if (payload.sourceApp) {
    sourceNode.textContent = payload.sourceApp
    sourceNode.title = payload.sourceApp
  } else {
    sourceNode.textContent = ''
    sourceNode.title = ''
  }
})

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
