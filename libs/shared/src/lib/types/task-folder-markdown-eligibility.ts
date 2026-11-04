export function isReadableTaskFolderMarkdownName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*\.md$/.test(name) && !name.includes('..');
}
