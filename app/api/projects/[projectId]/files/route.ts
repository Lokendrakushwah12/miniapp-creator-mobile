import { logger } from "../../../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { redeployToVercel } from "@/lib/previewManager";
import { getProjectById, getProjectFiles, upsertProjectFile } from "@/lib/database";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    // Verify authentication
    const auth = await authenticateRequest(req);
    if (!auth.isAuthorized || !auth.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId } = await params;
    const { filePath, content, redeploy } = await req.json();

    if (!filePath || content === undefined) {
      return NextResponse.json(
        { error: "filePath and content are required" },
        { status: 400 }
      );
    }

    // Security check: prevent directory traversal
    if (filePath.includes("..") || filePath.startsWith("/")) {
      return NextResponse.json(
        { error: "Invalid file path" },
        { status: 400 }
      );
    }

    logger.log(`📝 Updating file: ${filePath} in project: ${projectId}`);
    logger.log(`🔄 Redeploy requested: ${redeploy}`);

    // Save to DATABASE (source of truth)
    try {
      await upsertProjectFile(projectId, filePath, content);
      logger.log(`✅ File saved to database: ${filePath}`);
    } catch (dbError) {
      logger.error(`❌ Failed to save file to database:`, dbError);
      return NextResponse.json(
        { error: "Failed to save file to database" },
        { status: 500 }
      );
    }

    // If redeploy is requested, trigger a new deployment
    if (redeploy) {
      logger.log(`🚀 Triggering redeployment for project: ${projectId}`);

      try {
        // Read all files from DATABASE (source of truth)
        const dbFiles = await getProjectFiles(projectId);
        const files = dbFiles.map(f => ({ filename: f.filename, content: f.content }));
        logger.log(`📦 Fetched ${files.length} files from database for redeployment`);

        // Get project's app type from database
        const project = await getProjectById(projectId);
        const appType = (project?.appType as 'farcaster' | 'web3') || 'farcaster';
        logger.log(`🎯 Project app type: ${appType}`);

        // Use PREVIEW_AUTH_TOKEN to authenticate with orchestrator
        const previewAuthToken = process.env.PREVIEW_AUTH_TOKEN || '';

        // Trigger redeployment with skipBoilerplate to preserve user's code
        const previewData = await redeployToVercel(
          projectId,
          files,
          previewAuthToken,
          appType,
          undefined // isWeb3
        );

        logger.log(`✅ Redeployment triggered`);
        logger.log(`🌐 Preview URL: ${previewData.vercelUrl}`);

        return NextResponse.json({
          success: true,
          message: "File updated and redeployment triggered",
          filePath,
          deploymentUrl: previewData.vercelUrl,
          status: "deployed"
        });
      } catch (deployError) {
        logger.error(`❌ Redeployment failed:`, deployError);
        return NextResponse.json({
          success: false,
          message: "File updated but redeployment failed",
          filePath,
          error: deployError instanceof Error ? deployError.message : String(deployError)
        }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      message: "File updated successfully",
      filePath
    });
  } catch (error) {
    logger.error("Error updating file:", error);
    return NextResponse.json(
      { error: "Failed to update file" },
      { status: 500 }
    );
  }
}
