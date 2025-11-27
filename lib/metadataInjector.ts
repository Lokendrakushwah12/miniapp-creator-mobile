import { logger } from './logger';

/**
 * Helper function to find matching closing brace
 */
function findMatchingBrace(content: string, startIndex: number): number {
  let depth = 0;
  for (let i = startIndex; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Injects dynamic metadata into layout.tsx file for generated apps
 * Replaces app name in metadata with the actual project name
 */
export function injectDynamicMetadata(
  layoutContent: string,
  appName: string,
  appDescription?: string,
  baseUrl?: string,
  iconUrl?: string
): string {
  try {
    // Sanitize appName to prevent issues with special characters in strings
    const sanitizedAppName = appName.replace(/"/g, '\\"').replace(/\n/g, ' ');
    
    // Default description if not provided
    const description = (appDescription || `A Farcaster miniapp: ${sanitizedAppName}`).replace(/"/g, '\\"').replace(/\n/g, ' ');
    
    // Use baseUrl if provided, otherwise construct from app name
    const appUrl = baseUrl || `https://${sanitizedAppName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}.minidev.fun`;
    
    // Use static OG image from the app's public folder
    const ogImageUrl = `${appUrl}/og.png`;

    // The new metadata object to inject
    const newMetadataContent = `export const metadata: Metadata = {
  metadataBase: new URL('${appUrl}'),
  title: "${sanitizedAppName} | Farcaster Miniapp",
  description: "${description}",
  keywords: [
    "${sanitizedAppName}",
    "Farcaster",
    "miniapp",
    "web3"
  ],
  authors: [{ name: "${sanitizedAppName}" }],
  robots: "index, follow",
  alternates: {
    canonical: '${appUrl}',
  },
  openGraph: {
    title: "${sanitizedAppName} | Farcaster Miniapp",
    siteName: "${sanitizedAppName}",
    url: "${appUrl}",
    type: "website",
    locale: "en_US",
    description: "${description}",
    images: [
      {
        url: "${ogImageUrl}",
        width: 1200,
        height: 630,
        alt: "${sanitizedAppName} Preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "${sanitizedAppName} | Farcaster Miniapp",
    description: "${description}",
    images: [
      {
        url: "${ogImageUrl}",
        alt: "${sanitizedAppName} Preview",
      },
    ],
  },
}`;

    // Find the metadata declaration start
    const metadataStartPattern = /export\s+const\s+metadata\s*:\s*Metadata\s*=\s*\{/;
    const match = layoutContent.match(metadataStartPattern);
    
    // Check if metadata already exists
    if (match && match.index !== undefined) {
      const openBraceIndex = match.index + match[0].length - 1; // Index of the opening {
      const closeBraceIndex = findMatchingBrace(layoutContent, openBraceIndex);
      
      if (closeBraceIndex !== -1) {
        // Replace the entire metadata object
        const beforeMetadata = layoutContent.slice(0, match.index);
        const afterMetadata = layoutContent.slice(closeBraceIndex + 1);
        
        logger.log(`✅ Injected dynamic metadata for app: ${sanitizedAppName}`);
        return beforeMetadata + newMetadataContent + afterMetadata;
      }
    }
    
    // No metadata found - add it after imports
    logger.warn(`⚠️ No metadata found in layout.tsx, adding new metadata`);
    
    // Find the last import statement and add metadata after it
    const importPattern = /(import[^;]+;)/g;
    const imports = layoutContent.match(importPattern) || [];
    const lastImport = imports[imports.length - 1] || '';
    const afterImports = layoutContent.indexOf(lastImport) + lastImport.length;
    
    const metadataCode = `

${newMetadataContent};
`;
    
    return layoutContent.slice(0, afterImports) + metadataCode + layoutContent.slice(afterImports);
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
  baseUrl?: string,
  iconUrl?: string
): { filename: string; content: string }[] {
  return files.map(file => {
    // Only process layout.tsx files
    if (file.filename.includes('layout.tsx') || file.filename.includes('app/layout.tsx') || file.filename.includes('src/app/layout.tsx')) {
      logger.log(`📝 Processing metadata for file: ${file.filename}`);
      return {
        filename: file.filename,
        content: injectDynamicMetadata(file.content, appName, appDescription, baseUrl, iconUrl)
      };
    }
    return file;
  });
}
