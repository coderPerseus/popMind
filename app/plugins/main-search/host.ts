import { officialAskPlugins } from '@/app/plugins/main-search/official-ask-plugins'
import type { MainSearchPluginExecutionContext } from '@/app/plugins/main-search/types'

const byOrderAndTitle = <T extends { manifest: { order: number; title: string } }>(a: T, b: T) => {
  return a.manifest.order - b.manifest.order || a.manifest.title.localeCompare(b.manifest.title)
}

const mainSearchPlugins = [...officialAskPlugins].sort(byOrderAndTitle)

export const getMainSearchResultsCatalog = () => {
  return mainSearchPlugins.map((plugin) => plugin.toResult(''))
}

export const getMainSearchPluginResult = (pluginId: string, query = '') => {
  return mainSearchPlugins.find((plugin) => plugin.manifest.id === pluginId)?.toResult(query) ?? null
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
