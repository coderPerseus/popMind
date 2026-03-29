import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const packageJsonPath = path.join(rootDir, 'package.json')
const packageLockPath = path.join(rootDir, 'package-lock.json')

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const releaseType = args.has('--major') ? 'major' : args.has('--minor') ? 'minor' : 'patch'

const runGit = (args, options = {}) => {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
}

const runGitInherited = (args) => {
  execFileSync('git', args, {
    cwd: rootDir,
    stdio: 'inherit',
  })
}

const isGitDiffClean = (args) => {
  try {
    execFileSync('git', args, {
      cwd: rootDir,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

const ensureCleanWorktree = () => {
  if (!isGitDiffClean(['diff', '--quiet']) || !isGitDiffClean(['diff', '--cached', '--quiet'])) {
    throw new Error('工作区有未提交改动，先提交或清理后再执行发版脚本。')
  }
}

const ensureMainBranch = () => {
  const branch = runGit(['branch', '--show-current'])

  if (branch !== 'main') {
    throw new Error(`发版脚本只能在 main 分支执行，当前分支是 ${branch || '(detached)'}`)
  }
}

const ensureNotBehindOriginMain = () => {
  const behindCount = Number.parseInt(runGit(['rev-list', '--count', 'HEAD..origin/main']) || '0', 10)

  if (Number.isFinite(behindCount) && behindCount > 0) {
    throw new Error(`当前 main 落后 origin/main 共 ${behindCount} 个提交，请先同步后再发版。`)
  }
}

const parseVersion = (input) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(input.trim())

  if (!match) {
    return null
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  }
}

const compareVersions = (left, right) => {
  if (left.major !== right.major) {
    return left.major - right.major
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor
  }

  return left.patch - right.patch
}

const formatVersion = (value) => `${value.major}.${value.minor}.${value.patch}`

const bumpVersion = (value, type) => {
  if (type === 'major') {
    return { major: value.major + 1, minor: 0, patch: 0 }
  }

  if (type === 'minor') {
    return { major: value.major, minor: value.minor + 1, patch: 0 }
  }

  return { major: value.major, minor: value.minor, patch: value.patch + 1 }
}

const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'))

const writeJson = (filePath, value) => {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

const findLatestReleaseTag = () => {
  const tagsOutput = runGit(['ls-remote', '--tags', '--refs', 'origin', 'v*'])

  const versions = tagsOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('\t')[1] ?? '')
    .map((ref) => ref.replace('refs/tags/', ''))
    .map((tag) => ({ tag, parsed: parseVersion(tag) }))
    .filter((entry) => entry.parsed)

  if (versions.length === 0) {
    return {
      tag: 'v0.0.0',
      parsed: { major: 0, minor: 0, patch: 0 },
    }
  }

  versions.sort((left, right) => compareVersions(right.parsed, left.parsed))
  return versions[0]
}

const syncVersionFiles = (version) => {
  const packageJson = readJson(packageJsonPath)
  packageJson.version = version
  writeJson(packageJsonPath, packageJson)

  const packageLock = readJson(packageLockPath)
  packageLock.version = version

  if (packageLock.packages && packageLock.packages['']) {
    packageLock.packages[''].version = version
  }

  writeJson(packageLockPath, packageLock)
}

const main = () => {
  if (!dryRun) {
    ensureCleanWorktree()
  }

  ensureMainBranch()

  runGitInherited(['fetch', 'origin', 'main', '--tags'])
  ensureNotBehindOriginMain()

  const latestRelease = findLatestReleaseTag()
  const nextVersion = formatVersion(bumpVersion(latestRelease.parsed, releaseType))
  const nextTag = `v${nextVersion}`

  console.log(`[release] latest tag: ${latestRelease.tag}`)
  console.log(`[release] release type: ${releaseType}`)
  console.log(`[release] next version: ${nextVersion}`)

  if (dryRun) {
    return
  }

  syncVersionFiles(nextVersion)

  runGitInherited(['add', 'package.json', 'package-lock.json'])
  runGitInherited(['commit', '-m', `chore(release): ${nextTag}`])
  runGitInherited(['push', 'origin', 'main'])
  runGitInherited(['tag', '-a', nextTag, '-m', `Release ${nextTag}`])
  runGitInherited(['push', 'origin', nextTag])
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[release] ${message}`)
  process.exitCode = 1
}
