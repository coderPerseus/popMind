// Custom macOS signing hook for electron-builder.
//
// macOS remembers Accessibility / Screen Recording grants by the app's
// "designated requirement". Ad-hoc builds use the binary hash there, so every
// new release looks like a different app and the user has to authorize again.
// Signing with a fixed certificate (Developer ID or a self-signed one) keeps
// the requirement stable across releases, so permissions survive updates.
//
// Identity resolution:
//   1. identity found by electron-builder (Developer ID via CSC_LINK)
//   2. POPMIND_MAC_SIGN_IDENTITY (SHA-1 hash or name of a self-signed cert in the keychain search list)
//   3. ad-hoc ("-") as the last resort
const path = require('node:path')

// @electron/osx-sign is a dependency of electron-builder, not of this project.
const builderLibDir = path.dirname(
  require.resolve('app-builder-lib/package.json', {
    paths: [path.dirname(require.resolve('electron-builder/package.json'))],
  })
)
const { signAsync } = require(require.resolve('@electron/osx-sign', { paths: [builderLibDir] }))

module.exports = async function sign(opts) {
  const selfSignIdentity = process.env.POPMIND_MAC_SIGN_IDENTITY?.trim()
  const identity = opts.identity || selfSignIdentity || '-'
  const mode = opts.identity ? 'electron-builder' : selfSignIdentity ? 'self-signed' : 'adhoc'

  console.log(`[mac-sign] signing ${opts.app} with ${mode} identity`)
  if (mode === 'adhoc') {
    console.warn(
      '[mac-sign] ad-hoc signature: users will need to re-authorize Accessibility / Screen Recording after updating'
    )
  }

  await signAsync({
    ...opts,
    identity,
    identityValidation: false,
    keychain: opts.keychain || process.env.POPMIND_MAC_SIGN_KEYCHAIN || undefined,
  })
}
