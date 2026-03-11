import { createAskPlugin } from '@/app/plugins/main-search/ask-plugin-factory'
import googleLogo from '@/app/assets/icon/google-color.png'
import grokLogo from '@/app/assets/icon/grok.png'
import openaiLogo from '@/app/assets/icon/openai.png'
import perplexityLogo from '@/app/assets/icon/perplexity-color.png'

const withQuery = (url: string, key: string, query: string) => {
  const nextUrl = new URL(url)
  nextUrl.searchParams.set(key, query)
  return nextUrl.toString()
}

export const officialAskPlugins = [
  createAskPlugin({
    id: 'ask.google',
    title: 'Google Search',
    handle: '@google_search',
    slashAliases: ['/google'],
    order: 1,
    description: '复制输入内容并打开 Google 搜索',
    keywords: ['google', 'search', 'web', 'query'],
    homepageUrl: 'https://www.google.com/search',
    buildLaunchUrl: (query) => withQuery('https://www.google.com/search', 'q', query),
    logo: {
      src: googleLogo,
      alt: 'Google',
      background: 'rgba(255, 255, 255, 0.96)',
    },
  }),
  createAskPlugin({
    id: 'ask.chatgpt',
    title: 'ChatGPT Ask',
    handle: '@chatgpt_ask',
    slashAliases: ['/chatgpt'],
    order: 1,
    description: '复制输入内容并打开 ChatGPT',
    keywords: ['chatgpt', 'openai', 'ask', 'gpt'],
    homepageUrl: 'https://chatgpt.com',
    buildLaunchUrl: (query) => withQuery('https://chatgpt.com', 'q', query),
    logo: {
      src: openaiLogo,
      alt: 'ChatGPT',
      background: 'rgba(245, 255, 253, 0.98)',
    },
  }),
  // Gemini 暂时下线，当前网页参数流转不可用。
  // createAskPlugin({
  //   id: 'ask.gemini',
  //   title: 'Gemini Ask',
  //   handle: '@gemini_ask',
  //   slashAliases: ['/gemini'],
  //   order: 1,
  //   description: '复制输入内容并打开 Gemini',
  //   keywords: ['gemini', 'google', 'ask'],
  //   homepageUrl: 'https://gemini.google.com/app',
  //   buildLaunchUrl: (query) => withQuery('https://gemini.google.com/app', 'q', query),
  //   logo: {
  //     src: geminiLogo,
  //     alt: 'Gemini',
  //     background: 'rgba(243, 244, 255, 0.98)',
  //   },
  // }),
  createAskPlugin({
    id: 'ask.grok',
    title: 'Grok Ask',
    handle: '@grok_ask',
    slashAliases: ['/grok'],
    order: 1,
    description: '复制输入内容并打开 Grok',
    keywords: ['grok', 'xai', 'ask'],
    homepageUrl: 'https://grok.com',
    buildLaunchUrl: (query) => withQuery('https://grok.com', 'q', query),
    logo: {
      src: grokLogo,
      alt: 'Grok',
      background: 'rgba(255, 255, 255, 0.96)',
    },
  }),
  // DeepSeek 暂时下线，当前网页参数流转不可用。
  // createAskPlugin({
  //   id: 'ask.deepseek',
  //   title: 'DeepSeek Ask',
  //   handle: '@deepseek_ask',
  //   slashAliases: ['/deepseek'],
  //   order: 1,
  //   description: '复制输入内容并打开 DeepSeek',
  //   keywords: ['deepseek', 'ask', 'deep seek'],
  //   homepageUrl: 'https://chat.deepseek.com',
  //   buildLaunchUrl: (query) => withQuery('https://chat.deepseek.com', 'q', query),
  //   logo: {
  //     src: deepseekLogo,
  //     alt: 'DeepSeek',
  //     background: 'rgba(239, 246, 255, 0.98)',
  //   },
  // }),
  createAskPlugin({
    id: 'ask.perplexity',
    title: 'Perplexity Ask',
    handle: '@perplexity_ask',
    slashAliases: ['/perplexity'],
    order: 1,
    description: '复制输入内容并打开 Perplexity',
    keywords: ['perplexity', 'search', 'answer', 'ask'],
    homepageUrl: 'https://www.perplexity.ai/search/new',
    buildLaunchUrl: (query) => withQuery('https://www.perplexity.ai/search/new', 'q', query),
    logo: {
      src: perplexityLogo,
      alt: 'Perplexity',
      background: 'rgba(236, 253, 250, 0.98)',
    },
  }),
  // Claude 暂时下线，当前网页参数流转不可用。
  // createAskPlugin({
  //   id: 'ask.claude',
  //   title: 'Claude Ask',
  //   handle: '@claude_ask',
  //   slashAliases: ['/claude'],
  //   order: 1,
  //   description: '复制输入内容并打开 Claude',
  //   keywords: ['claude', 'anthropic', 'ask'],
  //   homepageUrl: 'https://claude.ai/new',
  //   buildLaunchUrl: (query) => withQuery('https://claude.ai/new', 'q', query),
  //   logo: {
  //     src: claudeLogo,
  //     alt: 'Claude',
  //     background: 'rgba(255, 247, 237, 0.98)',
  //   },
  // }),
]
