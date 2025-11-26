'use client';

import { useAuthContext } from '@/contexts/AuthContext';
import Image from 'next/image';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, isLoading, isInMiniApp } = useAuthContext();

    if (isLoading) return (
        <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden">
            {/* Background with grid pattern */}
            <div className="absolute inset-0 bg-[#0A0B1A]"></div>
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:25px_25px]"></div>

            <div className="animate-spin h-8 w-8 border-2 border-white border-t-transparent rounded-full"></div>
        </div>
    );

    // If not in miniapp or not authenticated, show a message to open in Warpcast
    if (!isInMiniApp || !isAuthenticated) {
        return (
            <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden font-funnel-sans">
                {/* Background with grid pattern */}
                <div className="absolute inset-0 bg-[#0A0B1A]"></div>
                <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:25px_25px]"></div>

                <div className="relative bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl p-8 max-w-md w-full border border-white/20 text-center">
                    {/* Logo */}
                    <div className="flex items-center justify-center gap-3 mb-6">
                        <Image
                            src="/minidevpfp.png"
                            alt="Minidev"
                            width={48}
                            height={48}
                            className="rounded-full"
                        />
                        <span className="text-3xl font-funnel-display font-bold text-gray-900">Minidev</span>
                    </div>

                    {/* Farcaster Icon */}
                    <div className="mb-6">
                        <Image
                            src="/farcaster.svg"
                            alt="Farcaster"
                            width={64}
                            height={64}
                            className="mx-auto"
                        />
                    </div>

                    <h1 className="text-xl font-semibold text-gray-900 mb-3">
                        Open in Warpcast
                    </h1>
                    
                    <p className="text-gray-600 mb-6">
                        Minidev is a Farcaster miniapp. Please open this app in Warpcast to get started.
                    </p>

                    <a 
                        href="https://warpcast.com/~/add-cast-action?name=Minidev&icon=code&actionType=post&postUrl=https://minidev.fun"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-[#8A63D2] text-white rounded-full font-medium hover:bg-[#7652C1] transition-colors"
                    >
                        <Image
                            src="/farcaster.svg"
                            alt="Farcaster"
                            width={20}
                            height={20}
                            className="brightness-0 invert"
                        />
                        Open in Warpcast
                    </a>

                    <p className="text-xs text-gray-400 mt-6">
                        Build Farcaster miniapps with AI — no coding required.
                    </p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
