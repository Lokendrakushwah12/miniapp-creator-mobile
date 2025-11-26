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
        // Use the official SDK method to check if we're in a miniapp
        const inMiniApp = await sdk.isInMiniApp();
        console.log('📱 [useUser] Is in MiniApp:', inMiniApp);
        setIsMiniApp(inMiniApp);
      } catch (error) {
        console.log('⚠️ [useUser] Error checking miniapp status:', error);
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
