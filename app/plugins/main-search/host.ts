import { createCalculatorPlugin } from '@/app/plugins/main-search/calculator-plugin'
import { createOfficialAskPlugins } from '@/app/plugins/main-search/official-ask-plugins'
import { createTodoFocusPlugin } from '@/app/plugins/main-search/todo-focus-plugin'
import type { AppLanguage } from '@/lib/capability/types'
import type { MainSearchPluginExecutionContext, MainSearchPluginPanelContext } from '@/app/plugins/main-search/types'

const byOrderAndTitle = (language: AppLanguage) => <T extends { manifest: { order: number; title: string } }>(a: T, b: T) => {
  return a.manifest.order - b.manifest.order || a.manifest.title.localeCompare(b.manifest.title, language)
}

const getMainSearchPlugins = (language: AppLanguage) =>
  [createCalculatorPlugin(language), createTodoFocusPlugin(language), ...createOfficialAskPlugins(language)].sort(
    byOrderAndTitle(language)
  )

export const getMainSearchResultsCatalog = (language: AppLanguage) => {
  return getMainSearchPlugins(language).map((plugin) => plugin.toResult(''))
}

export const getMainSearchPluginResult = (language: AppLanguage, pluginId: string, query = '') => {
  return getMainSearchPlugins(language).find((plugin) => plugin.manifest.id === pluginId)?.toResult(query) ?? null
}

export const resolveMainSearchResults = (language: AppLanguage, query: string) => {
  return getMainSearchPlugins(language)
    .filter((plugin) => plugin.shouldDisplay(query))
    .map((plugin) => plugin.toResult(query))
}

export const executeMainSearchPlugin = async (
  language: AppLanguage,
  pluginId: string,
  context: MainSearchPluginExecutionContext
) => {
  const plugin = getMainSearchPlugins(language).find((item) => item.manifest.id === pluginId)

  if (!plugin) {
    throw new Error(`Unknown main search plugin: ${pluginId}`)
  }

  await plugin.run(context)
}

export const renderMainSearchPluginPanel = (
  language: AppLanguage,
  pluginId: string,
  context: MainSearchPluginPanelContext
) => {
  const plugin = getMainSearchPlugins(language).find((item) => item.manifest.id === pluginId)
  return plugin?.renderPanel?.(context) ?? null
}
