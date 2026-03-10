import { officialAskPlugins } from '@/app/plugins/main-search/official-ask-plugins'
import type { MainSearchPluginExecutionContext } from '@/app/plugins/main-search/types'

const mainSearchPlugins = [...officialAskPlugins]

export const getMainSearchResultsCatalog = () => {
  return mainSearchPlugins.map((plugin) => plugin.toResult(''))
}

export const resolveMainSearchResults = (query: string) => {
  return mainSearchPlugins.filter((plugin) => plugin.shouldDisplay(query)).map((plugin) => plugin.toResult(query))
}

export const executeMainSearchPlugin = async (pluginId: string, context: MainSearchPluginExecutionContext) => {
  const plugin = mainSearchPlugins.find((item) => item.manifest.id === pluginId)

  if (!plugin) {
    throw new Error(`Unknown main search plugin: ${pluginId}`)
  }

  await plugin.run(context)
}
