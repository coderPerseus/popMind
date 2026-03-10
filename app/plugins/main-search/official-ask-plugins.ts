import { createAskPlugin } from '@/app/plugins/main-search/ask-plugin-factory'

export const officialAskPlugins = [
  createAskPlugin({
    id: 'ask.text',
    title: 'Text Ask',
    handle: '@text_ask',
    description: '复制输入内容并打开通用文本搜索',
    keywords: ['text', 'ask', 'search', 'query'],
    homepageUrl: 'https://www.google.com/search',
    buildLaunchUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    logo: {
      monogram: 'Tx',
      background: 'linear-gradient(135deg, #0f172a 0%, #334155 100%)',
      color: '#f8fafc',
    },
  }),
  createAskPlugin({
    id: 'ask.chatgpt',
    title: 'ChatGPT Ask',
    handle: '@chatgpt_ask',
    description: '复制输入内容并打开 ChatGPT',
    keywords: ['chatgpt', 'openai', 'ask', 'gpt'],
    homepageUrl: 'https://chatgpt.com',
    logo: {
      monogram: 'CG',
      background: 'linear-gradient(135deg, #10a37f 0%, #0f766e 100%)',
      color: '#f4fffd',
    },
  }),
  createAskPlugin({
    id: 'ask.gemini',
    title: 'Gemini Ask',
    handle: '@gemini_ask',
    description: '复制输入内容并打开 Gemini',
    keywords: ['gemini', 'google', 'ask'],
    homepageUrl: 'https://gemini.google.com/app',
    logo: {
      monogram: 'GM',
      background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
      color: '#eef2ff',
    },
  }),
  createAskPlugin({
    id: 'ask.grok',
    title: 'Grok Ask',
    handle: '@grok_ask',
    description: '复制输入内容并打开 Grok',
    keywords: ['grok', 'xai', 'ask'],
    homepageUrl: 'https://grok.com',
    logo: {
      monogram: 'GK',
      background: 'linear-gradient(135deg, #111827 0%, #4b5563 100%)',
      color: '#f9fafb',
    },
  }),
  createAskPlugin({
    id: 'ask.deepseek',
    title: 'DeepSeek Ask',
    handle: '@deepseek_ask',
    description: '复制输入内容并打开 DeepSeek',
    keywords: ['deepseek', 'ask', 'deep seek'],
    homepageUrl: 'https://chat.deepseek.com',
    logo: {
      monogram: 'DS',
      background: 'linear-gradient(135deg, #2563eb 0%, #0f172a 100%)',
      color: '#eff6ff',
    },
  }),
]
