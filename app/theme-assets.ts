import lightLogoUrl from '@/app/assets/logo.png'
import darkLogoUrl from '@/app/assets/logo-dark.png'

export const getThemeLogoUrl = () => {
  return document.documentElement.classList.contains('dark') ? darkLogoUrl : lightLogoUrl
}
