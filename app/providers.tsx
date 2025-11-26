'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import sdk, { type Context } from '@farcaster/miniapp-sdk';

// Farcaster context type
interface FarcasterContextType {
  context: Context.MiniAppContext | null;
  isSDKLoaded: boolean;
  isInMiniApp: boolean;
}

const FarcasterContext = createContext<FarcasterContextType>({
  context: null,
  isSDKLoaded: false,
  isInMiniApp: false,
});

export function useFarcaster() {
  return useContext(FarcasterContext);
}

function FarcasterProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<Context.MiniAppContext | null>(null);
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const [isInMiniApp, setIsInMiniApp] = useState(false);

  useEffect(() => {
    const initSDK = async () => {
      try {
        // Check if we're in a miniapp environment
        if (typeof window !== 'undefined') {
          // Load the SDK context
          const ctx = await sdk.context;
          setContext(ctx);
          setIsInMiniApp(true);
          
          // Signal that the app is ready
          sdk.actions.ready({});
          
          console.log('✅ Farcaster SDK initialized:', {
            user: ctx.user,
            client: ctx.client,
          });
        }
      } catch (error) {
        console.log('ℹ️ Not running in Farcaster miniapp environment:', error);
        setIsInMiniApp(false);
      } finally {
        setIsSDKLoaded(true);
      }
    };

    initSDK();
  }, []);

  return (
    <FarcasterContext.Provider value={{ context, isSDKLoaded, isInMiniApp }}>
      {children}
    </FarcasterContext.Provider>
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60, // 1 minute
        retry: 1,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <FarcasterProvider>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#363636',
              color: '#fff',
            },
          }}
        />
      </FarcasterProvider>
    </QueryClientProvider>
  );
}
