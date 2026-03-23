# Repository Guidelines

## Project Structure & Module Organization

`app/` contains the renderer UI built with React, including `components/`, `hooks/`, `styles/`, and static assets in `app/assets/`. Electron runtime code lives under `lib/`: use `lib/main/` for the main process, `lib/preload/` for context-bridge entry points, and `lib/conveyor/` for typed IPC schemas, APIs, and handlers. Text selection and bubble behavior are grouped in `lib/text-picker/`, with the native macOS bridge in `native/selection_bridge.mm`. Documentation lives in `docs/`. Generated output such as `out/`, `build/`, and packaged artifacts should not be edited manually.

## Build, Test, and Development Commands

no need test

## Coding Style & Naming Conventions

This repository uses TypeScript throughout. Prettier enforces 2-space indentation, single quotes, no semicolons, `printWidth: 120`, and trailing commas where valid in ES5. Follow existing naming patterns: PascalCase for React components (`WelcomeKit.tsx`), camelCase for utilities and APIs, and kebab-case for shared module filenames such as `use-conveyor.ts`. Prefer path aliases like `@/app/...` and `@/lib/...` over long relative imports. Keep IPC contracts centralized in `lib/conveyor/schemas/` and update the matching API and handler together.

## Testing Guidelines

no need test

## Commit & Pull Request Guidelines

- ban auto use git modify code status

# 页面开发

尽可能使用 shadcn/ui. 组如果没有安装的，直接安装对应的件开发

# 仓库操作约束

- 不要直接运行会把编译产物输出到源码目录的 TypeScript 命令，例如 `pnpm exec tsc -b`
- 如果只是做类型检查，先确认 `tsconfig` 的输出行为，避免在 `app/`、`lib/` 下生成 `*.js`、`*.jsx`、`*.d.ts`、`*.tsbuildinfo`
- 对开启了 `composite` / `incremental` 的 `tsconfig`，不要直接运行 `pnpm exec tsc -p <config> --noEmit`，这仍然可能在仓库根目录生成 `tsconfig.*.tsbuildinfo`
- 需要做纯类型检查时，优先使用 `pnpm exec tsc -p <config> --noEmit --incremental false`
- 一旦误生成上述文件，先清理这些编译副产物，再继续开发，不能把它们当成源码改动提交

## 重要

工作模式，遇到任何 GUI 相关的测试逻辑都停下来告诉我开发者要做什么，然后你自己启动服务，打好需要的日志，然后等待开发者完成 GUI 操作，你进行log 分析，然后继续下一步

When communicating your results back to me, explain what you did and what happened in plain, clear English. Avoid jargon, technical implementation details, and code-speak in your final responses. Write as if you're explaining to a smart person who isn't looking at the code. Your actual work (how you think, plan, write code, debug, and solve problems) should stay fully technical and rigorous. This only applies to how you talk to me about it.

Before reporting back to me, if at all possible, verify your own work. Don't just write code and assume it's done. Actually test it using the tools available to you. If possible, run it, check the output, and confirm it does what was asked. If you're building something visual like a web app, view the pages, click through the flows, and check that things render and behave correctly. If you're writing a script, run it against real or representative input and inspect the results. If there are edge cases you can simulate, try them.

Define finishing criteria for yourself before you start: what does "done" look like for this task? Use that as your checklist before you come back to me. If something fails or looks off, fix it and re-test. Don't just flag it and hand it back. The goal is to keep me out of the loop on iteration. I want to receive finished, working results, not a first draft that needs me to spot-check it. Only come back to me when you've confirmed things work, or when you've genuinely hit a wall that requires my input.

use simple Chinese reply
