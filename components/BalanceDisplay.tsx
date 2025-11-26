"use client";
import { logger } from '@/lib/logger';

import { useQuery } from "@tanstack/react-query";
import type { EarnKit, UserBalance } from "@earnkit/earn";
import TopUpDialog from "./top-up-dialog";
import { Button } from "./ui/button";
import { useAuthContext } from "@/contexts/AuthContext";
import sdk from "@farcaster/miniapp-sdk";
import { useState, useEffect } from "react";

interface BalanceDisplayProps {
    activeAgent: EarnKit;
    feeModelType: "free-tier" | "credit-based";
}

export default function BalanceDisplay({ activeAgent, feeModelType }: BalanceDisplayProps) {
    const { isAuthenticated, isInMiniApp } = useAuthContext();
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [isLoadingWallet, setIsLoadingWallet] = useState(true);

    // Get wallet address from Farcaster SDK
    useEffect(() => {
        const getWalletAddress = async () => {
            if (!isInMiniApp) {
                setIsLoadingWallet(false);
                return;
            }

            try {
                // Use Farcaster SDK's Ethereum provider to get the wallet address
                const provider = sdk.wallet.ethProvider;
                if (provider) {
                    const accounts = await provider.request({ method: 'eth_accounts' }) as string[];
                    if (accounts && accounts.length > 0) {
                        setWalletAddress(accounts[0]);
                    }
                }
            } catch (error) {
                logger.log('Failed to get wallet address from Farcaster:', error);
            } finally {
                setIsLoadingWallet(false);
            }
        };

        getWalletAddress();
    }, [isInMiniApp]);

    logger.log('💰 BalanceDisplay render:', {
        isAuthenticated,
        isInMiniApp,
        walletAddress: walletAddress ? `${walletAddress.substring(0, 6)}...` : 'none',
        feeModelType,
        hasActiveAgent: !!activeAgent,
        isLoadingWallet
    });

    // Balance fetching with React Query (only if activeAgent exists)
    const { data: balance, isLoading: loading, refetch: refetchBalance } = useQuery<UserBalance>({
        queryKey: ["balance", feeModelType, walletAddress],
        queryFn: async () => {
            if (!walletAddress || !activeAgent) throw new Error("Wallet not connected or agent not available");
            return activeAgent.getBalance({ walletAddress });
        },
        enabled: !!activeAgent && !!walletAddress && isAuthenticated,
        placeholderData: { eth: "0", credits: "0" },
        staleTime: 1000 * 30, // 30 seconds
        refetchInterval: 1000 * 60, // Refetch every minute
    });

    const handleBalanceUpdate = () => {
        // React Query will automatically refetch, but we can also trigger it manually
        refetchBalance();
    };

    // If no activeAgent (credits disabled), show nothing
    if (!activeAgent) {
        return null;
    }

    // Show loading state
    if (isLoadingWallet) {
        return (
            <div className="flex items-center gap-2">
                <span className="text-sm text-black-60">Loading...</span>
            </div>
        );
    }

    // Show message if not in miniapp or no wallet
    if (!isInMiniApp || !walletAddress) {
        return (
            <div className="flex items-center gap-2">
                <span className="text-sm text-black-60">
                    {!isInMiniApp ? "Open in Warpcast" : "No wallet connected"}
                </span>
            </div>
        );
    }

    // Show balance and top-up when authenticated and credits enabled
    return (
        <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
                <span className="text-sm text-black-60">
                    Balance: {loading ? "..." : balance ? `${balance.credits} Credits` : "0 Credits"}
                </span>
            </div>
            <TopUpDialog
                activeAgent={activeAgent}
                feeModelType={feeModelType}
                onSuccess={handleBalanceUpdate}
            >
                <Button
                    variant="outline"
                    size="sm"
                    className="px-3 py-1.5 text-xs font-medium border-black-20 text-black-60 hover:text-black hover:border-black-30 hover:bg-black-5 transition-colors cursor-pointer"
                >
                    Top Up
                </Button>
            </TopUpDialog>
        </div>
    );
}
