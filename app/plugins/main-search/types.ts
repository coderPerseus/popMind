export type MainSearchPluginLogo = {
  src: string
  alt: string
  background?: string
}

export type MainSearchPluginManifest = {
  id: string
  title: string
  handle: string
  slashAliases: string[]
  order: number
  typeLabel: string
  mode: 'link'
  keywords: string[]
  logo: MainSearchPluginLogo
  description: string
}

export type MainSearchPluginResult = MainSearchPluginManifest

export type MainSearchPluginExecutionContext = {
  query: string
  openUrl: (url: string) => Promise<void>
  copyText: (text: string) => Promise<boolean>
}

export interface MainSearchPlugin {
  manifest: MainSearchPluginManifest
  shouldDisplay(query: string): boolean
  toResult(query: string): MainSearchPluginResult
  run(context: MainSearchPluginExecutionContext): Promise<void>
}
