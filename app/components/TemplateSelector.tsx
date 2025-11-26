'use client';

import Image from 'next/image';

export function TemplateSelector() {
  return (
    <div className="w-full max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="mb-4 flex justify-center">
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
        <h2 className="text-2xl font-bold text-black mb-2">Build a Farcaster Miniapp</h2>
        <p className="text-sm text-gray-600">
          Describe your app idea and we&apos;ll build it for you. Your miniapp will run inside Farcaster.
        </p>
      </div>

      <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-2xl p-5">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-purple-900 mb-1">What can you build?</h3>
            <ul className="text-sm text-purple-800 space-y-1">
              <li>• Social apps & games</li>
              <li>• Token-gated experiences</li>
              <li>• NFT galleries & minting</li>
              <li>• Community tools & bots</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

