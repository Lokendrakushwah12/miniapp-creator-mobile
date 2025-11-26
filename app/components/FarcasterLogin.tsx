'use client';

import { useAuthContext } from '../contexts/AuthContext';
import { Icons } from './sections/icons';
import Image from 'next/image';

export function FarcasterLogin() {
    const { isLoading, isInMiniApp } = useAuthContext();

    if (isLoading) {
        return (
            <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden font-funnel-sans">
                {/* Background with grid pattern */}
                <div className="absolute inset-0 bg-[#0A0B1A]"></div>
                <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:25px_25px]"></div>

                <div className="relative flex flex-col items-center gap-4">
                    <div className="animate-spin h-8 w-8 border-2 border-white border-t-transparent rounded-full"></div>
                    <p className="text-white/70 text-sm">Connecting to Farcaster...</p>
                </div>
            </div>
        );
    }

    // If not in MiniApp, show instruction to open in Farcaster
    if (!isInMiniApp) {
        return (
            <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden font-funnel-sans">
                {/* Background with grid pattern */}
                <div className="absolute inset-0 bg-[#0A0B1A]"></div>
                <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:25px_25px]"></div>

                <div className="relative bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl p-8 max-w-md w-full border border-white/20">
                    {/* Logo and Header */}
                    <div className="text-center mb-8">
                        <div className="flex items-center justify-center gap-3 mb-6">
                            <Icons.earnySmallGrayIcon className="w-8 h-8 text-gray-900" />
                            <span className="text-3xl font-funnel-display font-bold text-gray-900">Minidev</span>
                        </div>
                        
                        {/* Farcaster Logo */}
                        <div className="mb-6 flex justify-center">
                            <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-lg">
                                <Image 
                                    src="/farcaster.svg" 
                                    alt="Farcaster" 
                                    width={80} 
                                    height={80}
                                    className="w-full h-full"
                                />
                            </div>
                        </div>
                        
                        <h1 className="text-xl font-funnel-sans font-semibold text-gray-800 mb-3">
                            Open in Farcaster
                        </h1>
                        <p className="text-sm text-gray-600 leading-relaxed">
                            Minidev is a Farcaster mini app. Please open this app inside Farcaster to continue.
                        </p>
                    </div>

                    {/* Instructions */}
                    <div className="space-y-4 mb-8">
                        <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                            <div className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-medium">
                                1
                            </div>
                            <p className="text-sm text-gray-700">
                                Open the <strong>Farcaster</strong> app on your phone
                            </p>
                        </div>
                        
                        <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                            <div className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-medium">
                                2
                            </div>
                            <p className="text-sm text-gray-700">
                                Search for <strong>&quot;Minidev&quot;</strong> in the mini apps section
                            </p>
                        </div>
                        
                        <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                            <div className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-medium">
                                3
                            </div>
                            <p className="text-sm text-gray-700">
                                Open the app and start building!
                            </p>
                        </div>
                    </div>

                    {/* Login to Farcaster button */}
                    <a
                        href="https://farcaster.xyz/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full bg-[#6A3CFF] text-white py-3 px-4 rounded-xl font-funnel-sans font-medium hover:bg-[#5930D9] focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-2 transition-all duration-200 shadow-lg cursor-pointer flex items-center justify-center gap-2"
                    >
                        <Image 
                            src="/farcaster.svg" 
                            alt="Farcaster" 
                            width={20} 
                            height={20}
                            className="w-5 h-5 brightness-0 invert"
                        />
                        Login to Farcaster
                    </a>

                    {/* Footer */}
                    <div className="mt-6 text-center">
                        <p className="text-xs text-gray-400">
                            Powered by <strong>Farcaster</strong>
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // This shouldn't be reached if user is authenticated
    return (
        <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden font-funnel-sans">
            <div className="absolute inset-0 bg-[#0A0B1A]"></div>
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:25px_25px]"></div>

            <div className="relative flex flex-col items-center gap-4">
                <div className="animate-spin h-8 w-8 border-2 border-white border-t-transparent rounded-full"></div>
                <p className="text-white/70 text-sm">Authenticating...</p>
            </div>
        </div>
    );
}

