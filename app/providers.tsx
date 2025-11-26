'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useState, useEffect } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

export default function Providers({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(() => new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 1000 * 60, // 1 minute
                retry: 1,
            },
        },
    }));

    // Initialize Farcaster SDK and call ready()
    useEffect(() => {
        const initializeSDK = async () => {
            try {
                // Check if we're in a MiniApp environment
                const inMiniApp = await sdk.isInMiniApp();
                
                if (inMiniApp) {
                    // Call ready() to signal that the app is ready and hide the splash screen
                    await sdk.actions.ready();
                    console.log('✅ Farcaster SDK ready');
                } else {
                    console.log('ℹ️ Not in Farcaster MiniApp environment');
                }
            } catch (error) {
                // Only log errors, don't break the app if not in Farcaster context
                console.log('Farcaster SDK initialization:', error);
            }
        };

        initializeSDK();
    }, []);

    return (
        <QueryClientProvider client={queryClient}>
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
        </QueryClientProvider>
    );
}
