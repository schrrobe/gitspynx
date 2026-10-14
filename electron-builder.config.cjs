// electron-builder configuration. Signing follows the environment:
// - macOS: with a Developer ID certificate (CSC_LINK + CSC_KEY_PASSWORD) the app is signed, and with
//   APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID also notarized (no warning at all).
//   Without a certificate it is signed ad-hoc: macOS then says "unidentified developer" (open via
//   System Settings → Privacy & Security) instead of calling a downloaded app "damaged".
// - Windows: signed with CSC_LINK/WIN_CSC_LINK (+ password), or with Azure Trusted Signing when
//   AZURE_TRUSTED_SIGNING_ENDPOINT, _ACCOUNT, _PROFILE and _PUBLISHER are set (plus the
//   AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET credentials). Otherwise unsigned
//   (SmartScreen: "More info" → "Run anyway").
const env = process.env
// CI passes every signing variable, empty when its secret does not exist; electron-builder would
// read an empty CSC_LINK as a path. Empty ones are removed (this file runs in the builder process).
for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'])
  if (env[key] === '') delete env[key]
const macCertificate = !!(env.CSC_LINK || env.CSC_NAME)
const azure = env.AZURE_TRUSTED_SIGNING_ENDPOINT && env.AZURE_TRUSTED_SIGNING_ACCOUNT && env.AZURE_TRUSTED_SIGNING_PROFILE && env.AZURE_TRUSTED_SIGNING_PUBLISHER

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.schrrobe.gitspynx',
  productName: 'gitspynx',
  copyright: 'Copyright © Robert',
  directories: { output: 'dist', buildResources: 'build' }, // icon: build/icon.png (from build/icon.svg)
  // node-pty/bin holds leftovers of earlier local rebuilds; node-pty loads build/ or prebuilds/
  files: ['out/**', 'package.json', '!**/*.map', '!node_modules/node-pty/bin/**'],
  // native module: pty.node and the macOS spawn-helper must be real files
  asarUnpack: ['node_modules/node-pty/**'],
  npmRebuild: false, // node-pty ships N-API prebuilds (built from source on Linux by npm ci)
  publish: { provider: 'github', owner: 'schrrobe', repo: 'gitspynx', releaseType: 'draft' }, // a tag push creates a draft release
  mac: {
    category: 'public.app-category.developer-tools',
    // one download for Intel and Apple Silicon
    target: [
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['universal'] }
    ],
    // node-pty's per-arch binaries sit in separate folders, so both halves of the universal app
    // contain all of them unchanged; that is allowed here instead of being merged with lipo
    x64ArchFiles: 'Contents/Resources/app.asar.unpacked/node_modules/node-pty/**',
    identity: macCertificate ? undefined : '-',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist'
  },
  dmg: { artifactName: '${productName}-${version}-${arch}.${ext}' },
  win: {
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
    ...(azure
      ? {
          azureSignOptions: {
            endpoint: env.AZURE_TRUSTED_SIGNING_ENDPOINT,
            codeSigningAccountName: env.AZURE_TRUSTED_SIGNING_ACCOUNT,
            certificateProfileName: env.AZURE_TRUSTED_SIGNING_PROFILE,
            publisherName: env.AZURE_TRUSTED_SIGNING_PUBLISHER
          }
        }
      : {})
  },
  nsis: { artifactName: '${productName}-${version}-setup-${arch}.${ext}', oneClick: false, allowToChangeInstallationDirectory: true },
  linux: { category: 'Development', target: ['AppImage', 'deb'], maintainer: 'Robert <robsch@stagedates.com>' },
  appImage: { artifactName: '${productName}-${version}-${arch}.${ext}' }
}
