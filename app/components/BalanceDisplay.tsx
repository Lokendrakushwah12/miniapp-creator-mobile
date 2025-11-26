"use client";
import { logger } from "../../lib/logger";

import { useQuery } from "@tanstack/react-query";
import type { EarnKit, UserBalance } from "@earnkit/earn";
import TopUpDialog from "./top-up-dialog";
import { Button } from "./ui/button";
import { useAuthContext } from "../contexts/AuthContext";

interface BalanceDisplayProps {
    activeAgent: EarnKit;
    feeModelType: "free-tier" | "credit-based";
}

export default function BalanceDisplay({ activeAgent, feeModelType }: BalanceDisplayProps) {
    const { isAuthenticated, context } = useAuthContext();
    
    // Get wallet address from Farcaster context verifications (custody address)
    // Note: In Farcaster miniapps, wallet operations go through sdk.wallet actions
    const walletAddress = (context?.user as { custody_address?: string })?.custody_address;

    logger.log('💰 BalanceDisplay render:', {
        isAuthenticated,
        hasWallet: !!walletAddress,
        walletAddress: walletAddress ? `${walletAddress.substring(0, 6)}...` : 'none',
        feeModelType,
        hasActiveAgent: !!activeAgent,
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

    // Show message if not authenticated or no wallet
    if (!isAuthenticated || !walletAddress) {
        return (
            <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>Connect wallet in Warpcast to view balance</span>
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
                    className="px-3 py-1.5 text-xs font-medium border-black-20 text-black-60 hover:text-black hover:border-black-30 hover:bg-black-5 transition-colors cursor-pointer rounded-3xl"
                >
                    Top Up
                </Button>
            </TopUpDialog>
        </div>
    );
}
