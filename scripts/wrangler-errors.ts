// Riconoscimento degli errori di wrangler usati da scripts/deploy.ts.

/**
 * true solo se l'errore dice che il Worker non esiste ancora (primo deploy). Ogni altro errore
 * (token, account, rete) deve fermare il deploy: meglio fermarsi che rigenerare un segreto valido.
 */
export function isWorkerMissing(output: string): boolean {
  return (
    /Worker "[^"]+"(?: \(env: [^)]*\))? not found/.test(output) ||
    /\[code: 10007\]/.test(output) ||
    /This Worker does not exist on your account/.test(output)
  );
}
