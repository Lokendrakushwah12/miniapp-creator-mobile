'use client';
import { logger } from "../../lib/logger";
import { useState, useEffect, useRef } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { sdk } from '@farcaster/miniapp-sdk';

interface PublishModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectUrl?: string;
    projectId?: string;
}

interface ImageUploadProps {
    label: string;
    type: 'icon' | 'splash';
    value: string;
    onChange: (url: string) => void;
    hint: string;
    previewSize?: 'small' | 'large';
}

function ImageUpload({ label, type, value, onChange, hint, previewSize = 'small' }: ImageUploadProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('type', type);

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Upload failed');
            }

            onChange(result.url);
            logger.log(`✅ ${type} uploaded:`, result.url);
        } catch (err) {
            logger.error(`❌ ${type} upload error:`, err);
            setError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setIsUploading(false);
            // Reset input so same file can be selected again
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleRemove = () => {
        onChange('');
        setError(null);
    };

    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
                {label} <span className="text-red-500">*</span>
            </label>
            
            <div className="space-y-2">
                {value ? (
                    // Preview uploaded image
                    <div className="relative inline-block">
                        <img
                            src={value}
                            alt={`${type} preview`}
                            className={`rounded-lg border border-gray-200 object-cover ${
                                previewSize === 'small' ? 'w-20 h-20' : 'w-full h-32'
                            }`}
                        />
                        <button
                            type="button"
                            onClick={handleRemove}
                            className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors cursor-pointer"
                            title="Remove image"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                ) : (
                    // Upload button
                    <div
                        onClick={() => fileInputRef.current?.click()}
                        className={`border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-colors ${
                            previewSize === 'small' ? 'w-20 h-20' : 'w-full h-32'
                        } ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                        {isUploading ? (
                            <div className="flex flex-col items-center">
                                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-gray-600 mb-1"></div>
                                <span className="text-xs text-gray-500">Uploading...</span>
                            </div>
                        ) : (
                            <>
                                <svg className="w-6 h-6 text-gray-400 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                </svg>
                                <span className="text-xs text-gray-500">Upload</span>
                            </>
                        )}
                    </div>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                    onChange={handleFileSelect}
                    className="hidden"
                />

                {error && (
                    <p className="text-xs text-red-600">{error}</p>
                )}

                <p className="text-xs text-gray-500">{hint}</p>
            </div>
        </div>
    );
}

export function PublishModal({ isOpen, onClose, projectUrl, projectId }: PublishModalProps) {
    const [currentStep, setCurrentStep] = useState<'form' | 'publishing' | 'success'>('form');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [manifestUrl, setManifestUrl] = useState<string | null>(null);
    
    // Form fields for manifest
    const [appName, setAppName] = useState('');
    const [iconUrl, setIconUrl] = useState('');
    const [subtitle, setSubtitle] = useState('');
    const [description, setDescription] = useState('');
    const [splashImageUrl, setSplashImageUrl] = useState('');
    const [splashBackgroundColor, setSplashBackgroundColor] = useState('#ffffff');
    const [primaryCategory, setPrimaryCategory] = useState('');
    
    // Get authentication from context (includes isInMiniApp check)
    const { sessionToken, isAuthenticated, isInMiniApp, isLoading: authLoading } = useAuthContext();

    // HomeUrl is always the project URL - uneditable
    const homeUrl = projectUrl || '';

    // Extract domain from projectUrl (without https:// and without trailing /)
    const getDomain = () => {
        if (!projectUrl) return '';
        return projectUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    };

    // Reset form when modal opens with new project
    useEffect(() => {
        if (isOpen) {
            setCurrentStep('form');
            setError(null);
            setManifestUrl(null);
        }
    }, [isOpen, projectUrl]);

    // Handle the full publish flow with account association
    const handlePublish = async () => {
        logger.log('handlePublish called with:', { projectId, projectUrl, isInMiniApp });

        // Validate required form fields
        if (!appName.trim()) {
            setError('App name is required');
            return;
        }
        if (!iconUrl.trim()) {
            setError('App icon is required - please upload an image');
            return;
        }
        if (!homeUrl.trim()) {
            setError('Home URL is required - please ensure your project is deployed');
            return;
        }
        if (!subtitle.trim()) {
            setError('Subtitle is required');
            return;
        }
        if (!description.trim()) {
            setError('Description is required');
            return;
        }
        if (!splashImageUrl.trim()) {
            setError('Splash image is required - please upload an image');
            return;
        }
        if (!splashBackgroundColor.trim()) {
            setError('Splash Background Color is required');
            return;
        }
        if (!primaryCategory.trim()) {
            setError('Primary Category is required');
            return;
        }

        if (!projectId) {
            logger.error('❌ Project ID is missing');
            setError('Project ID is missing. Please ensure your project is loaded correctly.');
            return;
        }

        if (!projectUrl) {
            logger.error('❌ Project URL is missing');
            setError('Project URL is missing. Please ensure your project is deployed.');
            return;
        }

        if (!isInMiniApp) {
            setError('Publishing requires running in a Farcaster miniapp to sign the manifest.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setCurrentStep('publishing');

        try {
            logger.log('📤 Starting publish flow...');

            // Check authentication
            if (!isAuthenticated || !sessionToken) {
                logger.error('❌ Not authenticated');
                throw new Error('Not authenticated. Please sign in first.');
            }

            logger.log('✅ Authentication verified');

            // Step 1: Sign manifest using Farcaster SDK
            logger.log('🔐 Signing manifest with Farcaster SDK...');
            const domain = getDomain();
            
            let accountAssociation: { header: string; payload: string; signature: string };
            try {
                const signResult = await sdk.experimental.signManifest({
                    domain: domain,
                });
                accountAssociation = signResult;
                logger.log('✅ Manifest signed successfully');
            } catch (signError: unknown) {
                const error = signError as { name?: string; message?: string };
                logger.error('❌ Failed to sign manifest:', error);
                
                if (error?.name === 'RejectedByUser') {
                    throw new Error('You cancelled the signing request. Please try again to publish your app.');
                } else if (error?.name === 'InvalidDomain') {
                    throw new Error('Invalid domain. Please check your project URL.');
                } else {
                    throw new Error(error?.message || 'Failed to sign manifest with Farcaster');
                }
            }

            // Step 2: Construct manifest with account association
            const manifest = {
                accountAssociation: accountAssociation,
                frame: {
                    version: '1',
                    name: appName.trim(),
                    iconUrl: iconUrl.trim(),
                    homeUrl: homeUrl.trim(),
                    imageUrl: iconUrl.trim(), // Use iconUrl as imageUrl
                    buttonTitle: 'Launch',
                    subtitle: subtitle.trim(),
                    description: description.trim(),
                    splashImageUrl: splashImageUrl.trim(),
                    splashBackgroundColor: splashBackgroundColor.trim(),
                    primaryCategory: primaryCategory.trim(),
                }
            };

            logger.log('📋 Manifest constructed with account association');

            // Step 3: Publish to API
            logger.log('📤 Sending manifest to API...');
            const response = await fetch('/api/publish', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionToken}`
                },
                body: JSON.stringify({
                    projectId,
                    manifest
                })
            });

            logger.log('API response status:', response.status);

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                    logger.error('API error response:', errorData);
                } catch {
                    const textError = await response.text();
                    logger.error('API error (non-JSON):', textError);
                    errorMessage = textError || errorMessage;
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();
            logger.log('API response body:', result);

            if (!result || typeof result !== 'object') {
                throw new Error('Invalid response format from server');
            }

            if (!result.success) {
                throw new Error(result.error || 'Failed to publish');
            }

            logger.log('✅ Publish successful:', result);
            setManifestUrl(result.manifestUrl);
            setCurrentStep('success');
        } catch (err) {
            logger.error('Publish error:', err);

            let errorMessage = '';
            if (err instanceof Error) {
                errorMessage = err.message;
            } else {
                errorMessage = 'Failed to publish. Please try again.';
            }

            setError(errorMessage);
            setCurrentStep('form'); // Back to form
        } finally {
            setIsLoading(false);
        }
    };

    // Reset form when modal closes
    const handleClose = () => {
        setCurrentStep('form');
        setError(null);
        setManifestUrl(null);
        setIsLoading(false);
        setAppName('');
        setIconUrl('');
        setSubtitle('');
        setDescription('');
        setSplashImageUrl('');
        setSplashBackgroundColor('#ffffff');
        setPrimaryCategory('');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <div>
                        <h2 className="text-2xl font-funnel-display font-semibold text-black">
                            Publish to Farcaster Registry
                        </h2>
                        <p className="text-gray-600 mt-1">
                            {currentStep === 'form' && 'Fill in your app details'}
                            {currentStep === 'publishing' && 'Publishing your app...'}
                            {currentStep === 'success' && 'Your app is published!'}
                        </p>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={isLoading}
                        className={`p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-900 ${isLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {/* Form Step */}
                    {currentStep === 'form' && (
                        <div className="space-y-4">
                            {/* Authentication Warning */}
                            {!isAuthenticated && (
                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                    <p className="text-sm text-yellow-800 font-medium">
                                        ⚠️ You need to be signed in to publish. Please authenticate first.
                                    </p>
                                </div>
                            )}

                            {/* MiniApp Warning */}
                            {!authLoading && !isInMiniApp && (
                                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                                    <p className="text-sm text-orange-800 font-medium">
                                        ⚠️ Publishing requires running inside a Farcaster miniapp to sign your manifest.
                                    </p>
                                </div>
                            )}

                            {error && (
                                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                    <p className="text-sm text-red-800">{error}</p>
                                </div>
                            )}

                            {/* Info Section */}
                            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                    <svg className="w-6 h-6 text-purple-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-semibold text-purple-900 mb-2">
                                            One-Click Publishing
                                        </h3>
                                        <p className="text-sm text-purple-900">
                                            Fill in your app details and upload images below. When you click Publish, we&apos;ll sign your manifest using your Farcaster account and deploy everything automatically.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Required Fields */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-gray-900">App Details</h3>
                                
                                {/* App Name */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        App Name <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="My Awesome App"
                                        value={appName}
                                        onChange={(e) => {
                                            setAppName(e.target.value);
                                            setError(null);
                                        }}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">The display name of your app</p>
                                </div>

                                {/* Icon Upload */}
                                <ImageUpload
                                    label="App Icon"
                                    type="icon"
                                    value={iconUrl}
                                    onChange={(url) => {
                                        setIconUrl(url);
                                        setError(null);
                                    }}
                                    hint="Square image, will be resized to 512x512px. PNG, JPEG, WebP or GIF."
                                    previewSize="small"
                                />

                                {/* Home URL - Read Only */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Home URL <span className="text-green-600">✓</span>
                                    </label>
                                    <input
                                        type="url"
                                        value={homeUrl}
                                        disabled
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 cursor-not-allowed"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        Your deployed project URL (automatically set)
                                    </p>
                                </div>
                            </div>

                            {/* Additional Required Fields */}
                            <div className="space-y-4 pt-4 border-t border-gray-200">
                                
                                {/* Subtitle */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Subtitle <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="A brief tagline for your app"
                                        value={subtitle}
                                        onChange={(e) => setSubtitle(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Short tagline or subtitle</p>
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Description <span className="text-red-500">*</span>
                                    </label>
                                    <textarea
                                        placeholder="Describe what your app does..."
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        rows={3}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Brief description of your app</p>
                                </div>

                                {/* Splash Image Upload */}
                                <ImageUpload
                                    label="Splash Image"
                                    type="splash"
                                    value={splashImageUrl}
                                    onChange={(url) => {
                                        setSplashImageUrl(url);
                                        setError(null);
                                    }}
                                    hint="Loading screen image. Max 1200px width. PNG, JPEG, WebP or GIF."
                                    previewSize="large"
                                />

                                {/* Splash Background Color */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Splash Background Color <span className="text-red-500">*</span>
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="color"
                                            value={splashBackgroundColor}
                                            onChange={(e) => setSplashBackgroundColor(e.target.value)}
                                            className="h-10 w-16 border border-gray-300 rounded-lg cursor-pointer"
                                        />
                                        <input
                                            type="text"
                                            placeholder="#ffffff"
                                            value={splashBackgroundColor}
                                            onChange={(e) => setSplashBackgroundColor(e.target.value)}
                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                        />
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">Background color for splash screen (hex code)</p>
                                </div>

                                {/* Primary Category */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Primary Category <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                        value={primaryCategory}
                                        onChange={(e) => setPrimaryCategory(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    >
                                        <option value="">Select a category...</option>
                                        <option value="games">Games</option>
                                        <option value="social">Social</option>
                                        <option value="defi">DeFi</option>
                                        <option value="nft">NFT</option>
                                        <option value="utility">Utility</option>
                                        <option value="entertainment">Entertainment</option>
                                        <option value="productivity">Productivity</option>
                                        <option value="other">Other</option>
                                    </select>
                                    <p className="text-xs text-gray-500 mt-1">App category for discovery</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Publishing Step */}
                    {currentStep === 'publishing' && (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-black mb-4"></div>
                            <h3 className="text-xl font-semibold text-black mb-2">
                                Publishing Your App...
                            </h3>
                            <p className="text-gray-600 text-center max-w-md mb-4">
                                Please approve the signing request in Farcaster to link your account.
                            </p>
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md">
                                <div className="flex items-center gap-2 text-sm text-blue-800">
                                    <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                    </svg>
                                    <span>Waiting for Farcaster signature...</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Success Step */}
                    {currentStep === 'success' && (
                        <div className="flex flex-col items-center justify-center py-8">
                            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h3 className="text-2xl font-semibold text-black mb-2">Published Successfully!</h3>
                            <p className="text-gray-600 text-center mb-6">
                                Your app is now registered on Farcaster with your account association!
                            </p>

                            {manifestUrl && (
                                <div className="w-full bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Manifest URL
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 text-sm text-gray-800 bg-white p-2 rounded border border-gray-300 break-all">
                                            {manifestUrl}
                                        </code>
                                        <a
                                            href={manifestUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-2 bg-black text-white rounded hover:bg-gray-800 transition-colors cursor-pointer"
                                            title="Open manifest"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                        </a>
                                    </div>
                                </div>
                            )}

                            <div className="w-full bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                                <p className="text-sm text-green-800 mb-2">
                                    <strong>✅ What&apos;s been done:</strong>
                                </p>
                                <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
                                    <li>Manifest created with your app details</li>
                                    <li>Account association signed with your Farcaster account</li>
                                    <li>Deployed to <code className="bg-green-100 px-1 rounded">/.well-known/farcaster.json</code></li>
                                    <li>App redeployed to Vercel with manifest</li>
                                </ul>
                            </div>

                            <div className="w-full bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                <p className="text-sm text-yellow-800 mb-2">
                                    <strong>🚀 Next Step: Submit to Farcaster Registry</strong>
                                </p>
                                <p className="text-sm text-yellow-800 mb-3">
                                    Your app is ready! Submit it to Farcaster&apos;s registry to make it discoverable.
                                </p>
                                <ol className="text-sm text-yellow-800 space-y-1 list-decimal list-inside mb-3">
                                    <li>Visit the Farcaster Registry</li>
                                    <li>Submit your manifest URL</li>
                                    <li>Wait for approval (usually takes a few days)</li>
                                </ol>
                                <a
                                    href="https://farcaster.xyz/~/developers/mini-apps/registry"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors text-sm font-medium"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                    Submit to Farcaster Registry
                                </a>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
                    {currentStep === 'form' && (
                        <>
                            <button
                                onClick={handleClose}
                                className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handlePublish}
                                disabled={
                                    isLoading ||
                                    !isAuthenticated ||
                                    !isInMiniApp ||
                                    !appName.trim() ||
                                    !iconUrl.trim() ||
                                    !homeUrl.trim() ||
                                    !subtitle.trim() ||
                                    !description.trim() ||
                                    !splashImageUrl.trim() ||
                                    !splashBackgroundColor.trim() ||
                                    !primaryCategory.trim()
                                }
                                className={`px-6 py-2 bg-black text-white rounded-lg font-medium transition-colors ${
                                    isLoading ||
                                    !isAuthenticated ||
                                    !isInMiniApp ||
                                    !appName.trim() ||
                                    !iconUrl.trim() ||
                                    !homeUrl.trim() ||
                                    !subtitle.trim() ||
                                    !description.trim() ||
                                    !splashImageUrl.trim() ||
                                    !splashBackgroundColor.trim() ||
                                    !primaryCategory.trim()
                                        ? 'opacity-50 cursor-not-allowed'
                                        : 'hover:bg-gray-800 cursor-pointer'
                                }`}
                                title={
                                    !isAuthenticated
                                        ? 'Please sign in first'
                                        : !isInMiniApp
                                            ? 'Must be running in Farcaster miniapp'
                                            : (!appName.trim() ||
                                               !iconUrl.trim() ||
                                               !homeUrl.trim() ||
                                               !subtitle.trim() ||
                                               !description.trim() ||
                                               !splashImageUrl.trim() ||
                                               !splashBackgroundColor.trim() ||
                                               !primaryCategory.trim())
                                                ? 'Please fill in all required fields'
                                                : 'Publish to Farcaster'
                                }
                            >
                                {!isAuthenticated ? 'Sign In Required' : !isInMiniApp ? 'Farcaster Required' : 'Publish & Sign'}
                            </button>
                        </>
                    )}
                    {currentStep === 'publishing' && (
                        <div className="w-full flex justify-center">
                            <span className="text-sm text-gray-600">Please approve the signing request...</span>
                        </div>
                    )}
                    {currentStep === 'success' && (
                        <div className="w-full flex justify-end">
                            <button
                                onClick={handleClose}
                                className="px-6 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors cursor-pointer"
                            >
                                Done
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
