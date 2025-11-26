import { logger } from "../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  updatePreviewFiles,
} from "../../../lib/previewManager";
import { getProjectFiles, upsertProjectFile, deleteProjectFile } from "../../../lib/database";
import { headers } from "next/headers";

// GET: List files or fetch file content from DATABASE (source of truth)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get("file");
    const projectId = searchParams.get("projectId");
    const listFiles = searchParams.get("listFiles") === "true";

    logger.log(
      `🔍 FILES GET request - projectId: ${projectId}, filePath: ${filePath}, listFiles: ${listFiles}`
    );

    if (!projectId) {
      logger.log(`❌ Missing project ID`);
      return NextResponse.json(
        { error: "Missing project ID" },
        { status: 400 }
      );
    }

    // Handle file listing request - always from database
    if (listFiles) {
      logger.log(`📋 Listing files from database for project: ${projectId}`);
      try {
        const dbFiles = await getProjectFiles(projectId);
        const files = dbFiles.map(f => f.filename);
        logger.log(`📁 Found ${files.length} files in database`);

        const response = {
          files: files || [],
          projectId: projectId,
          totalFiles: files.length,
        };
        logger.log(`📤 Sending response with ${files.length} files`);
        return NextResponse.json(response);
      } catch (error) {
        logger.error(`❌ Error listing files from database:`, error);
        return NextResponse.json(
          { error: "Failed to list files" },
          { status: 500 }
        );
      }
    }

    // Handle file content request
    if (!filePath) {
      logger.log(`❌ Missing file path`);
      return NextResponse.json({ error: "Missing file path" }, { status: 400 });
    }

    // Security check: prevent directory traversal
    if (filePath.includes("..") || filePath.startsWith("/")) {
      logger.log(`❌ Invalid file path: ${filePath}`);
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    logger.log(`🔍 Fetching file from database: ${filePath}`);

    try {
      // Get file from database (source of truth)
      const dbFiles = await getProjectFiles(projectId);
      const dbFile = dbFiles.find(f => f.filename === filePath);
      
      if (!dbFile) {
        logger.log(`❌ File not found in database: ${filePath}`);
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }

      const content = dbFile.content;
      logger.log(`✅ Found file in database: ${filePath} (${content.length} chars)`);

      // Determine content type based on file extension
      const ext = path.extname(filePath);
      let contentType = "text/plain";

      if (ext === ".json") contentType = "application/json";
      else if (ext === ".tsx" || ext === ".ts") contentType = "text/typescript";
      else if (ext === ".jsx" || ext === ".js") contentType = "text/javascript";
      else if (ext === ".css") contentType = "text/css";
      else if (ext === ".html") contentType = "text/html";
      else if (ext === ".md") contentType = "text/markdown";

      logger.log(`📤 Sending file with content type: ${contentType}`);

      return new NextResponse(content, {
        headers: {
          "Content-Type": contentType,
        },
      });
    } catch (error) {
      logger.error(`❌ Error fetching file from database:`, error);
      return NextResponse.json(
        { error: "Failed to fetch file" },
        { status: 500 }
      );
    }
  } catch (error) {
    logger.error("❌ Error serving file:", error);
    return NextResponse.json(
      { error: "Failed to serve file" },
      { status: 500 }
    );
  }
}

// PUT: Save file content to DATABASE (source of truth)
export async function PUT(request: NextRequest) {
  try {
    const { projectId, filename, content } = await request.json();
    const accessToken = (await headers())
      .get("authorization")
      ?.replace("Bearer ", "");

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token" },
        { status: 401 }
      );
    }

    logger.log(
      `💾 PUT request - projectId: ${projectId}, filename: ${filename}`
    );

    if (!projectId || !filename || content === undefined) {
      logger.log(`❌ Missing required fields`);
      return NextResponse.json(
        { error: "Missing projectId, filename, or content" },
        { status: 400 }
      );
    }

    // Security check: prevent directory traversal
    if (filename.includes("..") || filename.startsWith("/")) {
      logger.log(`❌ Invalid file path: ${filename}`);
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    // Save to DATABASE (source of truth)
    try {
      await upsertProjectFile(projectId, filename, content);
      logger.log(`✅ File saved to database: ${filename}`);
    } catch (error) {
      logger.error(`❌ Failed to save file to database:`, error);
      return NextResponse.json(
        { error: "Failed to save file to database" },
        { status: 500 }
      );
    }

    // Update the preview with the new file (optional - for live preview)
    try {
      await updatePreviewFiles(projectId, [{ filename, content }], accessToken);
      logger.log(`✅ Preview updated with file: ${filename}`);
    } catch (error) {
      logger.warn(`⚠️ Failed to update preview (non-critical):`, error);
      // Don't fail the request - preview updates are optional
    }

    return NextResponse.json({
      success: true,
      filename,
      projectId,
      message: "File saved successfully",
    });
  } catch (error) {
    logger.error("❌ Error saving file:", error);
    return NextResponse.json({ error: "Failed to save file" }, { status: 500 });
  }
}

// DELETE: Delete a file from DATABASE (source of truth)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const filename = searchParams.get("filename");

    logger.log(
      `🗑️ DELETE request - projectId: ${projectId}, filename: ${filename}`
    );

    if (!projectId || !filename) {
      logger.log(`❌ Missing projectId or filename`);
      return NextResponse.json(
        { error: "Missing projectId or filename" },
        { status: 400 }
      );
    }

    // Security check: prevent directory traversal
    if (filename.includes("..") || filename.startsWith("/")) {
      logger.log(`❌ Invalid file path: ${filename}`);
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    // Delete from DATABASE (source of truth)
    try {
      await deleteProjectFile(projectId, filename);
      logger.log(`✅ File deleted from database: ${filename}`);

      return NextResponse.json({
        success: true,
        filename,
        projectId,
        message: "File deleted successfully",
      });
    } catch (error) {
      logger.error(`❌ Failed to delete file from database:`, error);
      return NextResponse.json(
        { error: "Failed to delete file" },
        { status: 500 }
      );
    }
  } catch (error) {
    logger.error("❌ Error deleting file:", error);
    return NextResponse.json(
      { error: "Failed to delete file" },
      { status: 500 }
    );
  }
}
