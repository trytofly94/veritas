// Placeholder — implemented in Plan 01-02 Task 1 GREEN step.
// RED commit: throws so the failing tests prove they exercise this path.
export interface VerifyTsrArgs {
  tsr: Buffer;
  dataPath: string;
  caCertPath: string;
}

export async function verifyTsr(_args: VerifyTsrArgs): Promise<void> {
  throw new Error("verifyTsr: not yet implemented (Plan 01-02 RED)");
}
