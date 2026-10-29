import {
  isReadOnlyCommand as classify,
  readOnlyCommandNames as commandNames,
} from './codex-read-only-command';

const isReadOnlyCommand = (command: unknown, cwd: unknown, platform: string) =>
  classify(command, cwd, cwd, platform);
const readOnlyCommandNames = (command: unknown, cwd: unknown, platform: string) =>
  commandNames(command, cwd, cwd, platform);

const win = 'C:\\repo\\work';
const posix = '/repo/work';
const systemRoot = { systemRoot: 'C:\\Windows' };
const liveExecutable = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const liveBody = 'Get-Content -LiteralPath README.md';

describe('read-only Codex command classifier', () => {
  it.each([
    'Get-Content README.md',
    'Get-ChildItem .',
    'Select-String -Pattern TODO -Path README.md',
    'Test-Path README.md',
    'rg TODO .',
    'ls .',
    'cat README.md',
  ])('accepts reviewed Windows command %s', (command) => {
    expect(isReadOnlyCommand(command, win, 'win32')).toBe(true);
  });

  it.each(['rg TODO .', 'rg --files .', 'ls .', 'cat README.md'])(
    'accepts reviewed POSIX command %s', (command) => {
      expect(isReadOnlyCommand(command, posix, 'linux')).toBe(true);
    },
  );

  it.each([
    ['Get-Content "notes with spaces.txt"', win, 'win32'],
    ['cat "notes with spaces.txt"', posix, 'linux'],
    ['rg TODO . | Select-String -Pattern TODO -Path README.md', win, 'win32'],
    ['cat README.md | rg TODO', posix, 'linux'],
    ['powershell.exe -NoProfile -Command "Get-Content README.md"', win, 'win32'],
    ["pwsh -NoProfile -NoLogo -c 'rg TODO .'", win, 'win32'],
    ["powershell -Command 'Get-Content README.md'", win, 'win32'],
    ["rg 'a|b' .", posix, 'linux'],
  ])('accepts quoted, piped or supported wrapper form %s', (command, cwd, platform) => {
    expect(isReadOnlyCommand(command, cwd, platform)).toBe(true);
  });

  it('returns only command names for safe logging', () => {
    expect(readOnlyCommandNames('cat secret.txt | rg password', posix, 'linux'))
      .toEqual(['cat', 'rg']);
  });

  it.each([
    `"${liveExecutable}" -Command '${liveBody}'`,
    `'${liveExecutable}' -Command '${liveBody}'`,
    `${liveExecutable} -Command '${liveBody}'`,
    `"${liveExecutable.replace(/\\/g, '\\\\')}" -Command '${liveBody}'`,
    `"${liveExecutable.toLowerCase()}" -command '${liveBody}'`,
    `"${liveExecutable.toUpperCase()}" -COMMAND '${liveBody}'`,
    `"${liveExecutable}" -NoProfile -Command '${liveBody}'`,
    `"${liveExecutable}" -NoProfile -NoLogo -c "${liveBody}"`,
    `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\..\\v1.0\\powershell.exe" -Command '${liveBody}'`,
  ])('accepts trusted Windows PowerShell wrapper %s', (command) => {
    expect(classify(command, win, win, 'win32', systemRoot)).toBe(true);
    expect(commandNames(command, win, win, 'win32', systemRoot)).toEqual(['Get-Content']);
  });

  it.each([
    `"${liveExecutable}" -Command 'Get-Item -LiteralPath README.md | Select-Object FullName,Length; Get-Content -LiteralPath README.md -Raw'`,
    `"${liveExecutable}" -Command 'if (Test-Path README.md) {Get-Content README.md}'`,
    `"D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command '${liveBody}'`,
    `"C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe" -Command '${liveBody}'`,
    `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershel1.exe" -Command '${liveBody}'`,
    `"C:\\Windows\\System32\\WINDOW~1\\v1.0\\powershell.exe" -Command '${liveBody}'`,
    `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command '${liveBody}'`,
    `"${liveExecutable}" -EncodedCommand abc`,
    `"${liveExecutable}" -ExecutionPolicy Bypass -Command '${liveBody}'`,
    `"${liveExecutable}" -File read.ps1`,
    `"${liveExecutable}" -NonInteractive -Command '${liveBody}'`,
    `"${liveExecutable}" -NoLogo -Command '${liveBody}'`,
    `"${liveExecutable}" -Command`,
    `"${liveExecutable}" -Command ${liveBody}`,
    `"${liveExecutable}" -Command '${liveBody}' 'Get-Content other.txt'`,
    `"${liveExecutable}" -Command 'Get-Content C:\\private\\secret.txt'`,
  ])('rejects unsafe Windows PowerShell wrapper %s', (command) => {
    expect(classify(command, win, win, 'win32', systemRoot)).toBe(false);
  });

  it('rejects a full PowerShell path without a validated system root', () => {
    expect(classify(`"${liveExecutable}" -Command '${liveBody}'`, win, win, 'win32')).toBe(false);
    expect(classify(`"${liveExecutable}" -Command '${liveBody}'`, win, win, 'win32', { systemRoot: '' })).toBe(false);
    expect(classify(`"${liveExecutable}" -Command '${liveBody}'`, win, win, 'win32', { systemRoot: 'Windows' })).toBe(false);
    expect(classify(`"${liveExecutable}" -Command '${liveBody}'`, win, win, 'win32', { systemRoot: 'C:\\Windows\\' })).toBe(true);
  });

  it.each([
    ['a nested folder', 'C:\\repo\\work\\fake', 'C:\\repo\\work\\fake\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
    ['a drive root', 'C:\\', 'C:\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
    ['a parent segment', 'C:\\..', 'C:\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
    ['a dot segment', 'C:\\.\\', 'C:\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
    ['a relative folder', '.\\Windows', 'Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
  ])('rejects a SystemRoot that is %s', (_label, root, executable) => {
    expect(classify(`"${executable}" -Command '${liveBody}'`, win, win, 'win32', { systemRoot: root })).toBe(false);
  });

  it('rejects a trusted-looking PowerShell inside the thread folder', () => {
    const thread = 'C:\\work';
    const inside = 'C:\\work\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    expect(classify(`"${inside}" -Command '${liveBody}'`, thread, thread, 'win32', { systemRoot: 'C:\\work' })).toBe(false);
    expect(classify(`powershell -Command '${liveBody}'`, win, win, 'win32')).toBe(true);
  });

  it.each([
    ['redirection', 'cat README.md > output.txt', posix, 'linux'],
    ['append redirection', 'rg TODO . >> output.txt', posix, 'linux'],
    ['input redirection', 'cat < README.md', posix, 'linux'],
    ['stderr redirection', 'rg TODO . 2> errors.txt', posix, 'linux'],
    ['stderr merge redirection', 'cat README.md 2>&1', posix, 'linux'],
    ['clobber redirection', 'cat README.md >| output.txt', posix, 'linux'],
    ['PowerShell all-stream redirection', 'Get-Content README.md *> output.txt', win, 'win32'],
    ['semicolon', 'cat README.md; whoami', posix, 'linux'],
    ['ampersand', 'cat README.md & whoami', posix, 'linux'],
    ['and operator', 'cat README.md && whoami', posix, 'linux'],
    ['or operator', 'cat README.md || whoami', posix, 'linux'],
    ['subexpression', 'Get-Content $(whoami)', win, 'win32'],
    ['backtick', 'Get-Content `README.md', win, 'win32'],
    ['array expression', 'Get-Content @(README.md)', win, 'win32'],
    ['script block', 'Get-Content {README.md}', win, 'win32'],
    ['variable', 'Get-Content $file', win, 'win32'],
    ['environment variable', 'cat $HOME/file', posix, 'linux'],
    ['cmd environment variable', 'cat %USERPROFILE%\\file', win, 'win32'],
    ['cmd percent variable', 'cat %X%', win, 'win32'],
    ['PowerShell environment variable', 'Get-Content $env:X', win, 'win32'],
    ['unknown pipeline stage', 'cat README.md | tee output.txt', posix, 'linux'],
    ['empty pipeline stage', 'cat README.md | | rg TODO', posix, 'linux'],
    ['rg preprocessor', 'rg --pre sh TODO .', posix, 'linux'],
    ['rg pre-glob', 'rg --pre-glob *.txt TODO .', posix, 'linux'],
    ['rg follow link', 'rg -L TODO .', posix, 'linux'],
    ['rg follow long', 'rg --follow TODO .', posix, 'linux'],
    ['rg zip', 'rg -z TODO .', posix, 'linux'],
    ['rg search zip', 'rg --search-zip TODO .', posix, 'linux'],
    ['rg ignore file', 'rg --ignore-file ignore TODO .', posix, 'linux'],
    ['rg pattern file', 'rg -f patterns .', posix, 'linux'],
    ['rg option after pattern', 'rg TODO --pre sh', posix, 'linux'],
    ['POSIX unquoted pattern glob', 'rg *.txt .', posix, 'linux'],
    ['POSIX unquoted path glob', 'rg TODO *.txt', posix, 'linux'],
    ['unreviewed Get-Content option', 'Get-Content -ReadCount 2 README.md', win, 'win32'],
    ['unreviewed Select-String option', 'Select-String -Pattern x -Path README.md -Context 1', win, 'win32'],
    ['unreviewed command', 'find .', posix, 'linux'],
    ['malformed quote', 'cat "README.md', posix, 'linux'],
    ['shell escape', 'cat README\\.md', posix, 'linux'],
    ['Windows comma array', 'Get-Content README.md,..\\outside.txt', win, 'win32'],
    ['Windows delayed expansion', 'cat !FILE!', win, 'win32'],
    ['NUL character', 'cat a\0b', posix, 'linux'],
    ['CR character', 'cat a\rb', posix, 'linux'],
    ['LF character', 'cat a\nb', posix, 'linux'],
    ['Unicode dash', 'Get-Content \u2013LiteralPath README.md', win, 'win32'],
    ['Unicode quote', 'Get-Content \u2018README.md\u2019', win, 'win32'],
    ['PowerShell stop parsing', 'rg --% TODO .', win, 'win32'],
    ['adjacent quote segments', "Get-Content 'a''b'", win, 'win32'],
  ])('rejects %s', (_rule, command, cwd, platform) => {
    expect(isReadOnlyCommand(command, cwd, platform)).toBe(false);
  });

  it.each([
    ['POSIX parent escape', 'cat ../../outside.txt', posix, 'linux'],
    ['POSIX absolute outside', 'cat /etc/passwd', posix, 'linux'],
    ['POSIX home', 'cat ~/secret', posix, 'linux'],
    ['Windows parent escape', 'Get-Content ..\\..\\outside.txt', win, 'win32'],
    ['Windows absolute outside', 'Get-Content C:\\other\\secret.txt', win, 'win32'],
    ['Windows UNC', 'Get-Content \\\\server\\share\\secret.txt', win, 'win32'],
    ['Windows extended path', 'Get-Content \\\\?\\C:\\repo\\file.txt', win, 'win32'],
    ['Windows device path', 'Get-Content \\\\.\\CON', win, 'win32'],
    ['Windows ADS', 'Get-Content file:stream', win, 'win32'],
    ['Windows wildcard traversal', 'Get-Content ..\\*', win, 'win32'],
    ['POSIX wildcard traversal', 'cat ../*', posix, 'linux'],
    ['POSIX double slash', 'cat //server/secret', posix, 'linux'],
    ['Windows reserved CON', 'cat CON', win, 'win32'],
    ['Windows reserved NUL extension', 'Get-Content NUL.txt', win, 'win32'],
    ['Windows reserved lowercase with extension', 'cat con.log', win, 'win32'],
    ['Windows reserved COM9', 'Get-Content sub\\COM9', win, 'win32'],
    ['Windows reserved LPT1', 'Test-Path LPT1', win, 'win32'],
    ['Windows trailing dot', 'Get-Content file.', win, 'win32'],
    ['Windows drive relative', 'Get-Content C:secret.txt', win, 'win32'],
    ['PowerShell provider path', 'Get-Content env:PATH', win, 'win32'],
    ['Windows home', 'Get-Content ~\\secret.txt', win, 'win32'],
    ['Windows rooted path', 'Get-Content \\secret.txt', win, 'win32'],
  ])('rejects path outside cwd: %s', (_rule, command, cwd, platform) => {
    expect(isReadOnlyCommand(command, cwd, platform)).toBe(false);
  });

  it('rejects missing cwd, unknown platform and argv arrays', () => {
    expect(isReadOnlyCommand('cat README.md', undefined, 'linux')).toBe(false);
    expect(isReadOnlyCommand('cat README.md', 'relative', 'linux')).toBe(false);
    expect(isReadOnlyCommand('cat README.md', posix, 'aix')).toBe(false);
    expect(isReadOnlyCommand(['cat', 'README.md'], posix, 'linux')).toBe(false);
    expect(classify('cat README.md', posix, undefined, 'linux')).toBe(false);
  });

  it('rejects a command cwd outside the thread cwd and paths escaping from a subdirectory', () => {
    expect(classify('cat secret.txt', '/private', posix, 'linux')).toBe(false);
    expect(classify('cat ../../private', '/repo/work/sub', posix, 'linux')).toBe(false);
    expect(classify('Get-Content secret.txt', 'C:\\private', win, 'win32')).toBe(false);
    expect(classify('Get-Content ..\\..\\private', 'C:\\repo\\work\\sub', win, 'win32')).toBe(false);
    expect(classify('cat README.md', '/repo/work/sub', posix, 'linux')).toBe(true);
  });

  it.each([
    'powershell.exe -EncodedCommand abc',
    'powershell.exe -File read.ps1',
    'cmd.exe /c cat README.md',
    'powershell.exe -NoProfile -Command "Get-Content \\"README.md\\""',
  ])('rejects unsupported wrapper %s', (command) => {
    expect(isReadOnlyCommand(command, win, 'win32')).toBe(false);
  });
});
