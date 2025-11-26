"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { useAuthContext } from "@/contexts/AuthContext";
import { useSidebarContext } from "@/components/SidebarContext";
import { Button } from "./ui/button";

interface UserProfileHeaderProps {
  onOpenSidebar?: () => void;
}

export function UserProfileHeader({ onOpenSidebar }: UserProfileHeaderProps) {
  const { user, logout, isInMiniApp } = useAuthContext();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { toggleSidebar } = useSidebarContext();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showDropdown]);

  // Get user display name
  const getUserDisplay = () => {
    if (user?.displayName) return user.displayName;
    if (user?.username) return `@${user.username}`;
    return user?.farcasterFid ? `FID: ${user.farcasterFid}` : "minidev_user";
  };

  // Get user profile picture URL
  const getUserPfpUrl = () => {
    return user?.pfpUrl;
  };

  const handleLogout = () => {
    logout();
    setShowDropdown(false);
  };

  return (
    <div className="sticky h-[65px] top-0 left-0 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between z-20">
      <div className="flex items-center">
        {/* Sidebar Toggle Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSidebar ?? toggleSidebar}
          title="Toggle Projects"
        >
          <svg
            className="w-5 h-5 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </Button>

        {/* User Profile - Clickable with Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-3 hover:bg-gray-50 rounded-lg px-2 py-1 transition-colors"
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
            <div className="flex flex-col text-left">
              <span className="text-sm font-medium text-black">
                {getUserDisplay()}
              </span>
              {user?.username && user?.displayName && (
                <span className="text-xs text-gray-500">
                  @{user.username}
                </span>
              )}
            </div>
            {/* Dropdown Arrow */}
            <svg
              className={`w-4 h-4 text-gray-600 transition-transform ${
                showDropdown ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </Button>

          {/* Dropdown Menu */}
          {showDropdown && (
            <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg py-2 z-50">
              {/* Farcaster Profile Info */}
              {isInMiniApp && user?.farcasterFid && (
                <div className="px-4 py-2.5 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <Image
                      src="/farcaster.svg"
                      alt="Farcaster"
                      width={16}
                      height={16}
                      className="w-4 h-4"
                    />
                    <span className="text-xs text-gray-500">
                      Connected via Farcaster
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 mt-1 block">
                    FID: {user.farcasterFid}
                  </span>
                </div>
              )}

              {/* Logout Option */}
              <button
                onClick={handleLogout}
                className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-red-50 transition-colors text-left"
              >
                <svg
                  className="w-5 h-5 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                <span className="text-sm font-medium text-red-600">Logout</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Farcaster Badge */}
      {isInMiniApp && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 rounded-full">
          <Image
            src="/farcaster.svg"
            alt="Farcaster"
            width={16}
            height={16}
            className="w-4 h-4"
          />
          <span className="text-xs font-medium text-purple-700">Miniapp</span>
        </div>
      )}
    </div>
  );
}
