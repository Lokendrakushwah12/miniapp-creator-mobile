'use client';

import { useAuthContext } from '../contexts/AuthContext';
import { Icons } from './sections/icons';

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
                        
                        {/* Farcaster Icon */}
                        <div className="mb-6 flex justify-center">
                            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-lg">
                                <svg className="w-12 h-12 text-white" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M18.24 2.4H5.76C3.8865 2.4 2.4 3.8865 2.4 5.76v12.48c0 1.8735 1.4865 3.36 3.36 3.36h12.48c1.8735 0 3.36-1.4865 3.36-3.36V5.76c0-1.8735-1.4865-3.36-3.36-3.36zm-1.92 13.44c0 .528-.432.96-.96.96H8.64c-.528 0-.96-.432-.96-.96V8.16c0-.528.432-.96.96-.96h6.72c.528 0 .96.432.96.96v7.68z"/>
                                </svg>
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

                    {/* Download Farcaster button */}
                    <a
                        href="https://farcaster.xyz/download"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full bg-purple-600 text-white py-3 px-4 rounded-xl font-funnel-sans font-medium hover:bg-purple-700 focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-2 transition-all duration-200 shadow-lg cursor-pointer flex items-center justify-center gap-2"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download Farcaster
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

