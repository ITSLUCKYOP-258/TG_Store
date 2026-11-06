/**
 * TGStore - Vault session management (useVault.ts)
 *
 * E2EE has been removed. This is now a no-op compatibility layer:
 * the vault is always "unlocked" and getKey() returns null.
 * All crypto functions have been removed from the codebase.
 */
import { createContext, createElement, useContext, useState, type ReactNode } from 'react';

export type VaultStatus = 'locked' | 'unlocking' | 'unlocked' | 'error';

/* - public API ---------------------------------------------------------- */
export interface VaultApi {
  /** Current vault state. */
  status: VaultStatus;
  /** Human-readable error when status === 'error', else null. */
  error: string | null;
  /**
   * Unlock (or create+unlock) the vault.
   * Returns true on success, false + status 'error' on wrong passphrase.
   */
  unlock: (passphrase: string) => Promise<boolean>;
  /** Lock the vault - drops the in-memory key reference. */
  lock: () => void;
  /** The live AES key, or null while locked. */
  getKey: () => CryptoKey | null;
  /** True when a vault (salt + self-check) already exists in storage. */
  hasStoredVault: () => boolean;
}

const DEFAULT_API: VaultApi = {
  status: 'unlocked',
  error: null,
  unlock: async () => true,
  lock: () => {},
  getKey: () => null,
  hasStoredVault: () => false,
};

const VaultContext = createContext<VaultApi>(DEFAULT_API);

/** Access the vault from any component under <VaultProvider>. */
export function useVault(): VaultApi {
  return useContext(VaultContext);
}

/* - provider ------------------------------------------------------------ */

/** No-op provider - vault is always unlocked. */
export function VaultProvider({ children }: { children: ReactNode }) {
  return createElement(VaultContext.Provider, { value: DEFAULT_API }, children);
}
