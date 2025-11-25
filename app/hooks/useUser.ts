'use client';

import { useEffect, useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

/**
 * Hook to detect if we're running in a Farcaster miniapp context
 */
export function useUser() {
  const [isMiniApp, setIsMiniApp] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkMiniApp = async () => {
      try {
        // Check if we're in a miniapp context
        const context = await sdk.context;
        setIsMiniApp((context as any).client.platformType === 'miniapp' || false);
      } catch (error) {
        // If SDK fails, we're not in a miniapp
        setIsMiniApp(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkMiniApp();
  }, []);

  return { isMiniApp, isLoading };
}

