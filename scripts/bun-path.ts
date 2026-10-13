// The bun to write into a command that must outlive a Bun upgrade: the one on PATH, as found. A
// Homebrew /opt/homebrew/bin/bun survives `brew upgrade bun`; the versioned keg it points into, which
// process.execPath resolves to, is removed by the upgrade's cleanup (#112).

export function stableBun(which: (cmd: string) => string | null = (cmd) => Bun.which(cmd), execPath = process.execPath): string {
  return which("bun") ?? execPath;
}
