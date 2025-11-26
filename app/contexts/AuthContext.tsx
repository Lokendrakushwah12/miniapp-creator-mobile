'use client';

import { createContext, useContext, ReactNode } from 'react';
import { useFarcasterAuth } from '../hooks/useFarcasterAuth';
import type { Context } from '@farcaster/miniapp-core';

interface AuthContextType {
  isAuthenticated: boolean;
  sessionToken: string | null;
  user: {
    id: string;
    farcasterFid: number;
    username?: string;
    displayName?: string;
    pfpUrl?: string;
  } | null;
  isLoading: boolean;
  isInMiniApp: boolean;
  context: Context.MiniAppContext | null;
  walletAddress: string | null;
  handleSessionExpired: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const authState = useFarcasterAuth();

  return (
    <AuthContext.Provider value={authState}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}
