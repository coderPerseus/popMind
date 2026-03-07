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
