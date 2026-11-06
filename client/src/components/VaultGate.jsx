/**
 * Vault passphrase gate — bypassed.
 * Renders children directly without passphrase prompts.
 */
export default function VaultGate({ children }) {
  return children;
}
