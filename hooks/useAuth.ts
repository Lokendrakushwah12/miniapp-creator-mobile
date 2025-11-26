'use client';
import { logger } from "@/lib/logger";

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useFarcaster } from '@/app/providers';
import { quickAuth } from '@farcaster/miniapp-sdk';

interface AuthState {
  isAuthenticated: boolean;
  sessionToken: string | null;
  user: {
    id: string;
    farcasterFid: string;
    username?: string;
    displayName?: string;
    pfpUrl?: string;
  } | null;
  isLoading: boolean;
}

export function useAuth() {
  const { context, isSDKLoaded, isInMiniApp } = useFarcaster();
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    sessionToken: null,
    user: null,
    isLoading: true,
  });
  const hasInitialized = useRef(false);
  const initializationPromise = useRef<Promise<void> | null>(null);

  // Function to handle session expiration
  const handleSessionExpired = useCallback(async () => {
    logger.log('🔄 Session expired, clearing session');
    setAuthState({
      isAuthenticated: false,
      sessionToken: null,
      user: null,
      isLoading: false,
    });
    hasInitialized.current = false;
    initializationPromise.current = null;
    
    // Redirect to home page
    router.push('/');
  }, [router]);

  // Logout function
  const logout = useCallback(async () => {
    logger.log('🚪 Logging out...');
    setAuthState({
      isAuthenticated: false,
      sessionToken: null,
      user: null,
      isLoading: false,
    });
    hasInitialized.current = false;
    initializationPromise.current = null;
    router.push('/');
  }, [router]);

  useEffect(() => {
    const initializeAuth = async () => {
      // Wait for SDK to load
      if (!isSDKLoaded) {
        setAuthState(prev => ({ ...prev, isLoading: true }));
        return;
      }

      // If not in miniapp, can't authenticate via Farcaster
      if (!isInMiniApp || !context?.user) {
        console.log('⚠️ Not in Farcaster miniapp or no user context');
        setAuthState({
          isAuthenticated: false,
          sessionToken: null,
          user: null,
          isLoading: false,
        });
        return;
      }

      // Extract user info from Farcaster context
      const farcasterUser = context.user;
      const fid = farcasterUser.fid.toString();

      console.log('🔄 [useAuth] Farcaster user context:', {
        fid,
        username: farcasterUser.username,
        displayName: farcasterUser.displayName,
        pfpUrl: farcasterUser.pfpUrl,
      });

      // If we already have a valid session for this user, skip re-auth
      if (authState.isAuthenticated && authState.sessionToken && authState.user?.farcasterFid === fid) {
        // Check if user data changed
        const dataChanged = 
          authState.user?.displayName !== farcasterUser.displayName ||
          authState.user?.pfpUrl !== farcasterUser.pfpUrl ||
          authState.user?.username !== farcasterUser.username;
        
        if (!dataChanged) {
          logger.log('✅ Already authenticated with valid session, skipping re-authentication');
          return;
        }
        console.log('🔄 [useAuth] User data changed, re-authenticating...');
        hasInitialized.current = false;
      }

      // If already initializing, wait for the existing promise
      if (initializationPromise.current) {
        await initializationPromise.current;
        return;
      }

      // Create a new initialization promise
      initializationPromise.current = (async () => {
        try {
          // Get Quick Auth token for authenticated API calls
          let authToken: string | undefined;
          try {
            const tokenResult = await quickAuth.getToken();
            authToken = tokenResult.token;
            console.log('🔑 [useAuth] Got Quick Auth token');
          } catch (tokenError) {
            console.log('⚠️ [useAuth] Quick Auth not available, using fid-based auth');
          }

          // Create or get user in our backend system
          const response = await fetch('/api/auth/farcaster', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(authToken ? { 'X-Farcaster-Token': authToken } : {}),
            },
            body: JSON.stringify({
              fid,
              username: farcasterUser.username,
              displayName: farcasterUser.displayName,
              pfpUrl: farcasterUser.pfpUrl,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            console.log('✅ [useAuth] Backend response:', {
              user: data.user,
              hasSessionToken: !!data.sessionToken
            });
            
            setAuthState({
              isAuthenticated: true,
              sessionToken: data.sessionToken,
              user: data.user,
              isLoading: false,
            });
            
            console.log('✅ [useAuth] authState set successfully');
            hasInitialized.current = true;
          } else {
            const errorText = await response.text();
            logger.error('❌ Failed to create user session:', errorText);
            setAuthState({
              isAuthenticated: false,
              sessionToken: null,
              user: null,
              isLoading: false,
            });
          }
        } catch (error) {
          logger.error('Authentication error:', error);
          setAuthState({
            isAuthenticated: false,
            sessionToken: null,
            user: null,
            isLoading: false,
          });
        } finally {
          initializationPromise.current = null;
        }
      })();

      await initializationPromise.current;
    };

    initializeAuth();
  }, [isSDKLoaded, isInMiniApp, context, authState.isAuthenticated, authState.sessionToken, authState.user?.farcasterFid, authState.user?.displayName, authState.user?.pfpUrl, authState.user?.username]);

  return {
    ...authState,
    handleSessionExpired,
    logout,
    isInMiniApp,
  };
}
