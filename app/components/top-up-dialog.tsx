"use client";
import { logger } from "../../lib/logger";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { useAuthContext } from "../contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import type { EarnKit, TopUpOption, UserBalance } from "@earnkit/earn";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { keccak256, toBytes, encodeFunctionData, parseAbi } from "viem";
import { base } from "viem/chains";
import { sdk } from "@farcaster/miniapp-sdk";

interface EscrowContract {
    address: string;
    depositFunction: {
        name: string;
        signature: string;
        agentIdParam: string;
    };
    network: {
        chainId: number;
        name: string;
        rpcUrl: string;
    };
}

interface TopUpDialogProps {
    activeAgent: EarnKit;
    feeModelType: "free-tier" | "credit-based";
    onSuccess: (newBalance: UserBalance) => void;
    children: React.ReactNode;
}

export default function TopUpDialog({
    activeAgent,
    feeModelType,
    onSuccess,
    children,
}: TopUpDialogProps) {
    const [topUpOptions, setTopUpOptions] = useState<TopUpOption[] | null>(null);
    const [escrowContract, setEscrowContract] = useState<EscrowContract | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [open, setOpen] = useState<boolean>(false);
    const [processingOption, setProcessingOption] = useState<string | null>(null);

    const { isAuthenticated, walletAddress } = useAuthContext();
    const queryClient = useQueryClient();

    // Data Fetching - fetch top-up details when dialog opens
    useEffect(() => {
        if (open && !topUpOptions) {
            const fetchTopUpDetails = async () => {
                setLoading(true);
                try {
                    const response = await activeAgent.getTopUpDetails();
                    logger.log(response, "api response top up details");

                    setTopUpOptions(response.options);
                    setEscrowContract(response.escrowContract);
                } catch (error) {
                    logger.error("Error fetching top-up details:", error);
                    toast.error("Failed to load top-up options. Please try again.");
                } finally {
                    setLoading(false);
                }
            };

            fetchTopUpDetails();
        }
    }, [open, activeAgent, topUpOptions]);

    // Core Logic - handle top-up transaction using Farcaster SDK wallet
    const handleTopUp = async (option: TopUpOption) => {
        // Guard clauses
        if (!isAuthenticated) {
            toast.error("Please authenticate first");
            return;
        }

        if (!walletAddress) {
            toast.error("No wallet connected. Please connect your wallet in Warpcast settings.");
            return;
        }

        if (!escrowContract) {
            toast.error("Escrow contract not loaded");
            return;
        }

        setProcessingOption(option.label);

        let txToast: string | undefined;
        try {
            txToast = toast.loading("Preparing transaction...");

            // Parse ABI for deposit function
            const abi = parseAbi([
                "function deposit(bytes32 agentId) external payable"
            ]);

            const toastSending = toast.loading("Sending transaction via Farcaster...", { id: txToast });

            const agentId = keccak256(toBytes(escrowContract.depositFunction.agentIdParam));
            
            // Encode the function data for the deposit call
            const data = encodeFunctionData({
                abi,
                functionName: 'deposit',
                args: [agentId as `0x${string}`],
            });
            
            // Use Farcaster SDK ethProvider to send the transaction
            const hash = await sdk.wallet.ethProvider.request({
                method: 'eth_sendTransaction',
                params: [{
                    to: escrowContract.address as `0x${string}`,
                    value: `0x${BigInt(option.value).toString(16)}` as `0x${string}`,
                    data,
                    chainId: `0x${base.id.toString(16)}` as `0x${string}`,
                }],
            }) as `0x${string}`;

            if (hash) {
                logger.log("Transaction hash:", hash);
                toast.dismiss(toastSending);
                toast.success("Transaction sent! Processing...", { id: txToast });

                // Submit transaction to SDK
                await activeAgent.submitTopUpTransaction({
                    txHash: hash,
                    walletAddress: walletAddress,
                    amountInUSD: option.amountInUSD,
                    amountInEth: option.amountInEth,
                    creditsToTopUp: option.creditsToTopUp,
                });
                logger.log("submitTopUpTransaction");

                // Get current balance for polling comparison
                const currentBalance = await activeAgent.getBalance({
                    walletAddress: walletAddress,
                });
                logger.log(currentBalance, "currentBalance");

                // Poll for balance update
                activeAgent.pollForBalanceUpdate({
                    walletAddress: walletAddress,
                    initialBalance: currentBalance,
                    onConfirmation: (newBalance: UserBalance) => {
                        toast.success("Top-up successful! Balance updated.", { id: txToast });
                        // Invalidate balance query to trigger refetch
                        queryClient.invalidateQueries({ queryKey: ["balance"] });
                        onSuccess(newBalance);
                        setOpen(false);
                    },
                    onTimeout: () => {
                        toast.error(
                            "Transaction timeout. Please check your balance manually.",
                            {
                                id: txToast,
                            },
                        );
                    },
                });
            } else {
                toast.error("Transaction was not completed", { id: txToast });
            }
        } catch (error) {
            logger.log("Top-up error:", error);
            toast.error("Top-up failed. See console for details.");
        } finally {
            setProcessingOption(null);
            toast.dismiss();
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="rounded-3xl border-black-20 bg-white shadow-lg font-funnel-sans">
                <DialogHeader className="text-left">
                    {feeModelType === "credit-based" ? (
                        <>
                            <DialogTitle className="text-lg font-semibold text-black">
                                Buy Credits
                            </DialogTitle>
                            <DialogDescription className="text-sm text-black-60">
                                Select a package to add credits to your balance.
                            </DialogDescription>
                        </>
                    ) : (
                        <>
                            <DialogTitle className="text-lg font-semibold text-black">
                                Add Funds
                            </DialogTitle>
                            <DialogDescription className="text-sm text-black-60">
                                Select an amount to add to your ETH balance for this agent.
                            </DialogDescription>
                        </>
                    )}
                </DialogHeader>

                <div className="space-y-3">
                    {loading ? (
                        <div className="text-center py-6">
                            <div className="inline-flex items-center gap-2 text-sm text-black-60">
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-black-20 border-t-black-60"></div>
                                Loading options...
                            </div>
                        </div>
                    ) : topUpOptions && topUpOptions.length > 0 ? (
                        <div className="space-y-2">
                            {feeModelType === "credit-based"
                                ? // Credit-Based Agent UI
                                topUpOptions.map((option, index) => (
                                    <div
                                        key={`${option.label}-${option.amountInEth}-${index}`}
                                        className="flex items-center justify-between p-4 border border-black-20 rounded-xl bg-white transition-colors"
                                    >
                                        <div className="flex flex-col">
                                            <span className="font-medium text-black text-sm">
                                                {option.label}
                                            </span>
                                            <span className="text-xs text-black-60">
                                                {option.amountInEth ? parseFloat(option.amountInEth).toFixed(5) : 0} ETH
                                            </span>
                                        </div>
                                        <Button
                                            onClick={() => handleTopUp(option)}
                                            disabled={processingOption === option.label || !walletAddress}
                                            className="shrink-0 px-4 py-2 text-xs font-medium rounded-3xl bg-black hover:bg-pink group-hover:bg-pink text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed transition-colors"
                                        >
                                            {processingOption === option.label
                                                ? "Processing..."
                                                : "Buy"}
                                        </Button>
                                    </div>
                                ))
                                : // Free-Tier Agent UI
                                topUpOptions.map((option, index) => (
                                    <Button
                                        key={`${option.label}-${option.amountInEth}-${index}`}
                                        onClick={() => handleTopUp(option)}
                                        disabled={processingOption === option.label || !walletAddress}
                                        className="w-full p-4 text-sm font-medium rounded-xl border border-black-20 bg-white text-black hover:bg-black-5 hover:border-black-30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {processingOption === option.label
                                            ? "Processing..."
                                            : option.label}
                                    </Button>
                                ))}
                        </div>
                    ) : (
                        <div className="text-center py-6">
                            <span className="text-sm text-black-60">
                                No top-up options available.
                            </span>
                        </div>
                    )}
                    
                    {!walletAddress && (
                        <div className="text-center py-3 text-sm text-amber-600 bg-amber-50 rounded-lg">
                            Connect your wallet in Warpcast settings to top up.
                        </div>
                    )}
                </div>

            </DialogContent>
        </Dialog>
    );
}
