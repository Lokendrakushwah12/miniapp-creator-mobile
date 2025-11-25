'use client';

import { useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';
import { Button } from './ui/button';
import { useUser } from '../hooks/useUser';

interface AccountAssociationResult {
  header: string;
  payload: string;
  signature: string;
}

interface AccountAssociationProps {
  domain: string;
  onSuccess: (result: AccountAssociationResult) => void;
}

/**
 * Component for generating Farcaster account association using signManifest
 * 
 * This component allows users to sign their domain manifest for verification
 * and generates the accountAssociation credentials needed for the manifest file.
 */
export function AccountAssociation({ domain, onSuccess }: AccountAssociationProps) {
  const { isMiniApp, isLoading: userLoading } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AccountAssociationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSignManifest = async () => {
    if (!domain) {
      setError('Please enter a domain');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      // Call the experimental signManifest action
      const signResult = await sdk.experimental.signManifest({
        domain: domain.replace(/^https?:\/\//, ''), // Remove protocol if present
      });

      setResult(signResult);
      onSuccess(signResult);
      console.log('Account association generated:', signResult);
    } catch (err: any) {
      console.error('Error signing manifest:', err);
      
      if (err?.name === 'RejectedByUser') {
        setError('User rejected the signing request');
      } else if (err?.name === 'InvalidDomain') {
        setError('Invalid domain provided');
      } else {
        setError(err?.message || 'Failed to sign manifest');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    console.log(`${label} copied to clipboard`);
  };

  const copyAllAsJson = () => {
    if (!result) return;
    
    const json = JSON.stringify({
      accountAssociation: {
        header: result.header,
        payload: result.payload,
        signature: result.signature,
      }
    }, null, 2);
    
    navigator.clipboard.writeText(json);
    console.log('Account association JSON copied to clipboard');
  };

  if (userLoading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Account Association</h3>
        <p className="text-sm text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!isMiniApp) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Account Association</h3>
        <p className="text-sm text-gray-600">
          This feature is only available when running as a Farcaster miniapp.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Generate Account Association</h3>
        <p className="text-sm text-gray-600">
          Sign your domain manifest to generate account association credentials for your Farcaster miniapp.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="domain" className="block text-sm font-medium text-gray-700">
          Domain
        </label>
        <input
          id="domain"
          type="text"
          value={domain}
          readOnly
          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
        />
        <p className="text-xs text-gray-500">
          Domain will be used for account association
        </p>
      </div>

      <Button 
        onClick={handleSignManifest} 
        disabled={isLoading || !domain}
        className="w-full"
      >
        {isLoading ? 'Signing...' : 'Sign Manifest'}
      </Button>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800 font-medium">
              Account association generated successfully!
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Header:</p>
              <Button
                onClick={() => copyToClipboard(result.header, 'Header')}
                variant="outline"
                size="sm"
              >
                Copy
              </Button>
            </div>
            <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto max-h-20 break-all whitespace-pre-wrap">
              {result.header}
            </pre>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Payload:</p>
              <Button
                onClick={() => copyToClipboard(result.payload, 'Payload')}
                variant="outline"
                size="sm"
              >
                Copy
              </Button>
            </div>
            <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto max-h-20 break-all whitespace-pre-wrap">
              {result.payload}
            </pre>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Signature:</p>
              <Button
                onClick={() => copyToClipboard(result.signature, 'Signature')}
                variant="outline"
                size="sm"
              >
                Copy
              </Button>
            </div>
            <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto max-h-20 break-all whitespace-pre-wrap">
              {result.signature}
            </pre>
          </div>

          <Button 
            onClick={copyAllAsJson}
            className="w-full"
          >
            Copy All as JSON
          </Button>

          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600">
              Add these values to your <code className="text-xs bg-white px-1 py-0.5 rounded">public/.well-known/farcaster.json</code> file under the <code className="text-xs bg-white px-1 py-0.5 rounded">accountAssociation</code> field.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

