const gitSha = process.env.PTAH_LOCAL_PRODUCTION_GIT_SHA;

if (!/^[0-9a-f]{40}$/.test(gitSha ?? '')) {
  throw new Error('PTAH_LOCAL_PRODUCTION_GIT_SHA must be a full Git SHA');
}

module.exports = {
  extends: './electron-builder.yml',
  // Keep the production app identity and package identity. This intentionally
  // installs over/alongside the normal Ptah profile instead of creating a fork.
  appId: 'com.ptah.desktop',
  productName: 'Ptah',
  directories: {
    output: '../../release/local-production',
  },
  artifactName: `Ptah-Local-${gitSha.slice(0, 12)}-\${version}.\${ext}`,
  extraMetadata: {
    ptahBuildIdentity: {
      kind: 'local-production',
      gitSha,
    },
  },
  forceCodeSigning: false,
  mac: { identity: null },
  win: { sign: null },
  publish: null,
};
