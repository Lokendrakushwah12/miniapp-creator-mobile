import { logger } from "../../../lib/logger";
import { NextRequest, NextResponse } from 'next/server';
import { db, projects } from '../../../db';
import { eq } from 'drizzle-orm';
import { getUserBySessionToken, getProjectFiles, upsertProjectFile } from '../../../lib/database';
import { config } from '../../../lib/config';
import { notifyPublishComplete } from '../../../lib/notificationService';
import { injectDynamicMetadata } from '../../../lib/metadataInjector';
  
// Validate manifest structure
function validateManifest(manifest: unknown): { valid: boolean; error?: string } {
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, error: 'Manifest must be an object' };
  }

  const manifestObj = manifest as Record<string, unknown>;

  // Check for either miniapp or frame field
  if (!manifestObj.miniapp && !manifestObj.frame) { 
    return { valid: false, error: 'Manifest must contain either "miniapp" or "frame" field' };
  }

  // Validate accountAssociation structure if it exists and is not null
  // accountAssociation can be null for direct publishing without Farcaster wallet signature
  if ('accountAssociation' in manifestObj && manifestObj.accountAssociation !== null) {
    const accountAssociation = manifestObj.accountAssociation as Record<string, unknown>;
    // Only validate if accountAssociation is provided and not explicitly null
    if (accountAssociation.header !== null || accountAssociation.payload !== null || accountAssociation.signature !== null) {
      // If any field is provided, all must be provided
      if (!accountAssociation.header || !accountAssociation.payload || !accountAssociation.signature) {
        return { valid: false, error: 'accountAssociation must contain header, payload, and signature (or be null for direct publishing)' };
      }
    }
  }

  // Validate miniapp required fields if present
  if (manifestObj.miniapp) {
    const miniapp = manifestObj.miniapp as Record<string, unknown>;
    const requiredFields = ['version', 'name', 'iconUrl', 'homeUrl'];

    for (const field of requiredFields) {
      if (!miniapp[field]) {
        return { valid: false, error: `Missing required field in miniapp: ${field}` };
      }
    }
  }

  // Validate frame required fields if present
  if (manifestObj.frame) {
    const frame = manifestObj.frame as Record<string, unknown>;
    const requiredFields = ['version', 'name', 'iconUrl', 'homeUrl'];

    for (const field of requiredFields) {
      if (!frame[field]) {
        return { valid: false, error: `Missing required field in frame: ${field}` };
      }
    }
  }

  return { valid: true };
}

// POST: Publish manifest
export async function POST(req: NextRequest) {
  try {
    logger.log('\n========================================');
    logger.log('📤 PUBLISH API REQUEST RECEIVED');
    logger.log('========================================');

    // Parse request body
    let requestBody;
    try {
      requestBody = await req.json();
      logger.log('✅ Request body parsed successfully');
    } catch (parseError) {
      logger.error('❌ Failed to parse request body:', parseError);
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { projectId, manifest } = requestBody;
    logger.log('📦 Request data:', {
      projectId,
      hasManifest: !!manifest,
      manifestKeys: manifest ? Object.keys(manifest) : []
    });

    // Validate required fields
    if (!projectId) {
      return NextResponse.json(
        { success: false, error: 'Missing projectId' },
        { status: 400 }
      );
    }

    if (!manifest) {
      return NextResponse.json(
        { success: false, error: 'Missing manifest' },
        { status: 400 }
      );
    }

    // Verify session token
    const authHeader = req.headers.get('authorization');
    const sessionToken = authHeader?.replace('Bearer ', '');

    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization token' },
        { status: 401 }
      );
    }

    // Verify session token and get user
    const user = await getUserBySessionToken(sessionToken);

    if (!user) {
      logger.error('❌ Session verification failed: Invalid or expired token');
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session' },
        { status: 401 }
      );
    }

    // Check if session is expired
    if (user.expiresAt && new Date() > new Date(user.expiresAt)) {
      logger.error('❌ Session expired');
      return NextResponse.json(
        { success: false, error: 'Session expired' },
        { status: 401 }
      );
    }

    const userId = user.id;
    logger.log('✅ Session verified for user:', userId);

    // Validate manifest structure
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      logger.error('❌ Manifest validation failed:', validation.error);
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    logger.log('✅ Manifest validation passed');

    // Check if project exists and belongs to user
    const projectRecords = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (projectRecords.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Project not found' },
        { status: 404 }
      );
    }

    const project = projectRecords[0];

    if (project.userId !== userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Project does not belong to user' },
        { status: 403 }
      );
    }

    logger.log('✅ Project ownership verified');

    // Create farcaster.json content
    const farcasterJsonContent = JSON.stringify(manifest, null, 2);
    const filename = 'public/.well-known/farcaster.json';

    // Save to DATABASE (source of truth)
    try {
      // Update projects table with manifest metadata
      await db
        .update(projects)
        .set({
          farcasterManifest: manifest,
          publishedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      logger.log('✅ Projects table updated with manifest');

      // Save manifest file to projectFiles table so it appears in file tree
      await upsertProjectFile(projectId, filename, farcasterJsonContent);

      logger.log('✅ Manifest file saved to database');
    } catch (error) {
      logger.error('❌ Failed to update database:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to save manifest to database' },
        { status: 500 }
      );
    }

    // Extract app metadata from manifest for OG tags
    const miniappData = manifest.miniapp || manifest.frame;
    const appName = miniappData?.name || project.name || 'Miniapp';
    const appDescription = miniappData?.subtitle || miniappData?.splashScreenDescription || `A Farcaster miniapp`;
    const appIconUrl = miniappData?.iconUrl;
    
    logger.log('📝 Extracted app metadata for OG tags:', { appName, appDescription, appIconUrl });

    // Trigger FULL redeploy to Vercel with the manifest file
    try {
      // Use PREVIEW_AUTH_TOKEN instead of user session token for preview host authentication
      const previewAuthToken = config.preview.authToken;
      if (!previewAuthToken) {
        logger.warn('⚠️ PREVIEW_AUTH_TOKEN not configured, skipping preview update');
      } else {
        logger.log('🚀 Triggering full Vercel redeploy with manifest file...');
        
        // Read all project files from DATABASE (not filesystem)
        // This ensures we get the user's latest edits from the code editor
        const dbFiles = await getProjectFiles(projectId);
        logger.log(`📦 Fetched ${dbFiles.length} files from database for Vercel redeploy`);
        
        if (dbFiles.length === 0) {
          logger.warn('⚠️ No files found in database for project, skipping redeploy');
        } else {
          // Convert files to object format for direct API call
          const filesObject: { [key: string]: string } = {};
          
          // Process files and inject OG metadata into layout.tsx
          const projectUrl = project.vercelUrl || project.previewUrl || undefined;
          
          for (const file of dbFiles) {
            let content = file.content;
            
            // Inject dynamic OG metadata into layout.tsx
            if (file.filename.includes('layout.tsx') && (file.filename.includes('app/') || file.filename === 'layout.tsx')) {
              logger.log(`📝 Injecting OG metadata into ${file.filename}`);
              content = injectDynamicMetadata(content, appName, appDescription, projectUrl, appIconUrl);
              
              // Also save the updated layout.tsx to database
              await upsertProjectFile(projectId, file.filename, content);
              logger.log(`✅ Updated ${file.filename} with OG metadata in database`);
            }
            
            filesObject[file.filename] = content;
          }
          
          // Make direct API call to /deploy endpoint to force fresh Vercel deployment
          const previewApiBase = config.preview.apiBase;
          // Ensure URL has protocol
          const baseUrl = previewApiBase.startsWith('http') 
            ? previewApiBase 
            : `http://${previewApiBase}`;
          const deployUrl = `${baseUrl}/deploy`;
          
          logger.log(`📤 Triggering fresh Vercel deployment to: ${deployUrl}`);
          logger.log(`📤 Sending ${Object.keys(filesObject).length} files from database`);
          
          const deployResponse = await fetch(deployUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${previewAuthToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              hash: projectId,
              files: filesObject,
              deployToExternal: 'vercel',
              appType: project.appType || 'farcaster', // For reference only
              skipBoilerplate: true, // CRITICAL: Don't override user's files with boilerplate
              isWeb3: undefined, // Not deploying contracts
              skipContracts: true, // Contracts already deployed
              wait: false, // Don't wait for completion
            }),
          });
          
          if (!deployResponse.ok) {
            const errorText = await deployResponse.text();
            throw new Error(`Vercel deployment failed: ${deployResponse.status} ${errorText}`);
          }
          
          const previewResponse = await deployResponse.json();
          
          logger.log('✅ Vercel redeploy triggered successfully');
          logger.log(`🌐 Vercel URL: ${previewResponse.vercelUrl || previewResponse.previewUrl}`);
          
          // Update the project record with the latest Vercel URL
          if (previewResponse.vercelUrl) {
            await db
              .update(projects)
              .set({ 
                vercelUrl: previewResponse.vercelUrl,
                previewUrl: previewResponse.vercelUrl 
              })
              .where(eq(projects.id, project.id));
          }
        }
      }
    } catch (error) {
      logger.error('❌ Failed to trigger Vercel redeploy:', error);
      // Don't fail the request - continue with local manifest
    }

    // Build manifest URL
    const projectUrl = project.previewUrl || project.vercelUrl || `http://localhost:3000`;
    const manifestUrl = `${projectUrl}/.well-known/farcaster.json`;

    logger.log('✅ Publish successful:', { projectId, manifestUrl });

    // Send notification to user that publish is complete
    try {
      await notifyPublishComplete(userId, projectId, manifestUrl);
      logger.log('📬 Publish notification sent to user');
    } catch (notifyError) {
      logger.warn('⚠️ Failed to send publish notification:', notifyError);
      // Don't fail the request if notification fails
    }

    return NextResponse.json({
      success: true,
      manifestUrl,
      projectId,
      message: 'Manifest published successfully'
    });

  } catch (error) {
    logger.error('❌ Publish error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to publish manifest'
      },
      { status: 500 }
    );
  }
}
