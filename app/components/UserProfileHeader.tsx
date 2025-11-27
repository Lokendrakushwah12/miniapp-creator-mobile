'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useAuthContext } from '../contexts/AuthContext';
import BalanceDisplay from './BalanceDisplay';
import type { EarnKit } from '@earnkit/earn';


interface UserProfileHeaderProps {
  onOpenSidebar?: () => void;
  activeAgent?: EarnKit | null;
  feeModelType?: "free-tier" | "credit-based";
}

export function UserProfileHeader({ onOpenSidebar, activeAgent, feeModelType = "credit-based" }: UserProfileHeaderProps) {
  const { user, handleSessionExpired, walletAddress } = useAuthContext();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown]);

  // Format wallet address
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Get user display name
  const getUserDisplay = () => {
    if (user?.displayName) return user.displayName;
    if (user?.username) return `@${user.username}`;
    return `FID: ${user?.farcasterFid}`;
  };
  
  // Get user profile picture URL
  const getUserPfpUrl = () => {
    return user?.pfpUrl;
  };

  const handleLogout = () => {
    handleSessionExpired();
    setShowDropdown(false);
  };

  return (
    <div className="sticky top-0 left-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-20">
      <div className="flex items-center gap-3">
        {/* Sidebar Toggle Button */}
        <button
          onClick={onOpenSidebar}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="Toggle Projects"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* User Profile - Clickable with Dropdown */}
        <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-3 hover:bg-gray-50 rounded-lg px-2 py-1 transition-colors max-w-[240px] md:max-w-[200px] lg:max-w-[220px] xl:max-w-[240px]"
        >
          {getUserPfpUrl() ? (
            <Image 
              src={getUserPfpUrl()!} 
              alt="Profile"
              width={40}
              height={40}
              className="w-10 h-10 rounded-full object-cover"
              unoptimized
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <span className="text-white font-medium text-sm">
                {getUserDisplay().charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="hidden xl:flex flex-col text-left min-w-0 flex-1">
            <span className="text-sm font-medium text-black truncate">
              {getUserDisplay()}
            </span>
            {walletAddress ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-black-60 font-mono">
                  {formatAddress(walletAddress)}
                </span>
                <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] rounded-full font-medium">
                  Farcaster
                </span>
              </div>
            ) : (
              <span className="text-xs text-gray-400">
                FID: {user?.farcasterFid}
              </span>
            )}
          </div>
          {/* Dropdown Arrow */}
          <svg 
            className={`w-4 h-4 text-gray-600 transition-transform ${showDropdown ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown Menu */}
        {showDropdown && (
          <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg py-2 z-50">
            {/* User Info Section - Only shows on screens below xl (since it's in header on xl+) */}
            <div className="px-4 py-3 border-b border-gray-100 xl:hidden">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-gray-900 break-words">
                  {getUserDisplay()}
                </span>
                {walletAddress ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 font-mono break-all">
                        {walletAddress}
                      </span>
                    </div>
                    <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] rounded-full font-medium w-fit">
                      Farcaster Connected
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">
                    FID: {user?.farcasterFid}
                  </span>
                )}
              </div>
            </div>
            
            {/* Logout Option */}
            <button
              onClick={handleLogout}
              className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-red-50 transition-colors text-left"
            >
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="text-sm font-medium text-red-600">Logout</span>
            </button>
          </div>
        )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Balance and Top-up */}
        {activeAgent && (
          <BalanceDisplay
            activeAgent={activeAgent}
            feeModelType={feeModelType}
          />
        )}
      </div>
    </div>
  );
}
