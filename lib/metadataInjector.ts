import { logger } from './logger';

/**
 * Injects dynamic metadata into layout.tsx file for generated apps
 * Replaces app name in metadata with the actual project name
 */
export function injectDynamicMetadata(
  layoutContent: string,
  appName: string,
  appDescription?: string,
  baseUrl?: string
): string {
  try {
    // Default description if not provided
    const description = appDescription || `A Farcaster miniapp built with ${appName}`;
    
    // Use baseUrl if provided, otherwise construct from app name
    const appUrl = baseUrl || `https://${appName.toLowerCase().replace(/\s+/g, '-')}.minidev.fun`;
    const ogImageUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://minidev.fun'}/api/og-image?name=${encodeURIComponent(appName)}`;

    // Pattern to match metadata export (using [\s\S] instead of . with s flag for compatibility)
    const metadataPattern = /export\s+const\s+metadata\s*:\s*Metadata\s*=\s*\{([\s\S]+?)\}/;
    
    // Check if metadata already exists
    if (metadataPattern.test(layoutContent)) {
      // Replace existing metadata
      const updatedContent = layoutContent.replace(
        metadataPattern,
        `export const metadata: Metadata = {
  metadataBase: new URL('${appUrl}'),
  title: "${appName} | Farcaster Miniapp",
  description: "${description}",
  keywords: [
    "${appName}",
    "Farcaster",
    "miniapp",
    "web3"
  ],
  authors: [{ name: "${appName}" }],
  robots: "index, follow",
  alternates: {
    canonical: '${appUrl}',
  },
  openGraph: {
    title: "${appName} | Farcaster Miniapp",
    siteName: "${appName}",
    url: "${appUrl}",
    type: "website",
    locale: "en_US",
    description: "${description}",
    images: [
      {
        url: "${ogImageUrl}",
        width: 1200,
        height: 630,
        alt: "${appName} Preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "${appName} | Farcaster Miniapp",
    description: "${description}",
    images: [
      {
        url: "${ogImageUrl}",
        alt: "${appName} Preview",
      },
    ],
  },
}`
      );
      
      logger.log(`✅ Injected dynamic metadata for app: ${appName}`);
      return updatedContent;
    } else {
      // Add metadata if it doesn't exist (shouldn't happen with boilerplate, but handle it)
      logger.warn(`⚠️ No metadata found in layout.tsx, adding new metadata`);
      
      // Find the import statement and add metadata after it
      const importPattern = /(import[^;]+;)/g;
      const imports = layoutContent.match(importPattern) || [];
      const lastImport = imports[imports.length - 1] || '';
      const afterImports = layoutContent.indexOf(lastImport) + lastImport.length;
      
      const metadataCode = `
export const metadata: Metadata = {
  metadataBase: new URL('${appUrl}'),
  title: "${appName} | Farcaster Miniapp",
  description: "${description}",
  keywords: [
    "${appName}",
    "Farcaster",
    "miniapp",
    "web3"
  ],
  authors: [{ name: "${appName}" }],
  robots: "index, follow",
  alternates: {
    canonical: '${appUrl}',
  },
  openGraph: {
    title: "${appName} | Farcaster Miniapp",
    siteName: "${appName}",
    url: "${appUrl}",
    type: "website",
    locale: "en_US",
    description: "${description}",
    images: [
      {
        url: "${ogImageUrl}",
        width: 1200,
        height: 630,
        alt: "${appName} Preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "${appName} | Farcaster Miniapp",
    description: "${description}",
    images: [
      {
        url: "${ogImageUrl}",
        alt: "${appName} Preview",
      },
    ],
  },
};
`;
      
      return layoutContent.slice(0, afterImports) + metadataCode + layoutContent.slice(afterImports);
    }
  } catch (error) {
    logger.error('❌ Failed to inject metadata:', error);
    return layoutContent; // Return original if injection fails
  }
}

/**
 * Processes generated files to inject dynamic metadata
 */
export function processFilesWithMetadata(
  files: { filename: string; content: string }[],
  appName: string,
  appDescription?: string,
  baseUrl?: string
): { filename: string; content: string }[] {
  return files.map(file => {
    // Only process layout.tsx files
    if (file.filename.includes('layout.tsx') || file.filename.includes('app/layout.tsx') || file.filename.includes('src/app/layout.tsx')) {
      return {
        filename: file.filename,
        content: injectDynamicMetadata(file.content, appName, appDescription, baseUrl)
      };
    }
    return file;
  });
}

