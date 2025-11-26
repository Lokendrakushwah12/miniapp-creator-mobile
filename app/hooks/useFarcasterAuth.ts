'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';
import type { Context } from '@farcaster/miniapp-core';

export interface FarcasterUser {
  fid: number;
  username?: string;
  displayName?: string;
  pfpUrl?: string;
}

interface AuthState {
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
}

export function useFarcasterAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    sessionToken: null,
    user: null,
    isLoading: true,
    isInMiniApp: false,
    context: null,
  });
  
  const hasInitialized = useRef(false);
  const initializationPromise = useRef<Promise<void> | null>(null);

  // Function to handle session expiration / logout
  const handleSessionExpired = useCallback(async () => {
    console.log('🔄 Session expired, clearing state');
    setAuthState({
      isAuthenticated: false,
      sessionToken: null,
      user: null,
      isLoading: false,
      isInMiniApp: authState.isInMiniApp,
      context: authState.context,
    });
    hasInitialized.current = false;
    initializationPromise.current = null;
  }, [authState.isInMiniApp, authState.context]);

  // Authenticate with backend
  const authenticateWithBackend = useCallback(async (farcasterUser: FarcasterUser) => {
    console.log('🔐 [useFarcasterAuth] Authenticating with backend:', farcasterUser);
    
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          farcasterFid: farcasterUser.fid,
          username: farcasterUser.username,
          displayName: farcasterUser.displayName,
          pfpUrl: farcasterUser.pfpUrl,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ [useFarcasterAuth] Backend auth successful:', data);
        return data;
      } else {
        const errorText = await response.text();
        console.error('❌ [useFarcasterAuth] Backend auth failed:', errorText);
        return null;
      }
    } catch (error) {
      console.error('❌ [useFarcasterAuth] Backend auth error:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    const initializeAuth = async () => {
      // Prevent multiple initializations
      if (initializationPromise.current) {
        await initializationPromise.current;
        return;
      }

      initializationPromise.current = (async () => {
        try {
          console.log('🚀 [useFarcasterAuth] Initializing...');
          
          // Check if we're in a MiniApp environment
          const inMiniApp = await sdk.isInMiniApp();
          console.log('📱 [useFarcasterAuth] Is in MiniApp:', inMiniApp);

          if (!inMiniApp) {
            console.log('⚠️ [useFarcasterAuth] Not in MiniApp environment');
            setAuthState({
              isAuthenticated: false,
              sessionToken: null,
              user: null,
              isLoading: false,
              isInMiniApp: false,
              context: null,
            });
            return;
          }

          // Get context from Farcaster
          const context = await sdk.context;
          console.log('📋 [useFarcasterAuth] Got context:', context);

          if (!context?.user?.fid) {
            console.log('⚠️ [useFarcasterAuth] No user FID in context');
            setAuthState({
              isAuthenticated: false,
              sessionToken: null,
              user: null,
              isLoading: false,
              isInMiniApp: true,
              context,
            });
            return;
          }

          const farcasterUser: FarcasterUser = {
            fid: context.user.fid,
            username: context.user.username,
            displayName: context.user.displayName,
            pfpUrl: context.user.pfpUrl,
          };

          console.log('👤 [useFarcasterAuth] Farcaster user:', farcasterUser);

          // Authenticate with backend
          const authResult = await authenticateWithBackend(farcasterUser);

          if (authResult?.success) {
            setAuthState({
              isAuthenticated: true,
              sessionToken: authResult.sessionToken,
              user: authResult.user,
              isLoading: false,
              isInMiniApp: true,
              context,
            });
            hasInitialized.current = true;
            console.log('✅ [useFarcasterAuth] Authentication complete');
          } else {
            setAuthState({
              isAuthenticated: false,
              sessionToken: null,
              user: null,
              isLoading: false,
              isInMiniApp: true,
              context,
            });
          }
        } catch (error) {
          console.error('❌ [useFarcasterAuth] Initialization error:', error);
          setAuthState({
            isAuthenticated: false,
            sessionToken: null,
            user: null,
            isLoading: false,
            isInMiniApp: false,
            context: null,
          });
        } finally {
          initializationPromise.current = null;
        }
      })();

      await initializationPromise.current;
    };

    initializeAuth();
  }, [authenticateWithBackend]);

  return {
    ...authState,
    handleSessionExpired,
  };
}

