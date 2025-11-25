'use client';

import { useEffect } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

/**
 * Component to initialize Farcaster SDK and call ready()
 * This must be called to hide the splash screen in Farcaster miniapps
 */
export function FarcasterSDKInit() {
  useEffect(() => {
    const initializeSDK = async () => {
      try {
        // Call ready() to signal that the app is ready and hide the splash screen
        await sdk.actions.ready();
        
        console.log('✅ Farcaster SDK ready');
      } catch (error) {
        // Only log errors, don't break the app if not in Farcaster context
        console.log('Farcaster SDK ready call:', error);
      }
    };

    initializeSDK();
  }, []);

  // This component doesn't render anything
  return null;
}

