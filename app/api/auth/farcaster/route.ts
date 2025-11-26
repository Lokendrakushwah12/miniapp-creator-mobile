import { logger } from "../../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { authenticateFarcasterUser } from "../../../../lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { fid, username, displayName, pfpUrl } = await request.json();

    console.log('📨 [API /auth/farcaster] Received auth request:', {
      fid,
      username,
      displayName,
      pfpUrl
    });

    if (!fid) {
      return NextResponse.json(
        { success: false, message: "Farcaster FID is required" },
        { status: 400 }
      );
    }

    // Optional: Verify the Farcaster token if provided
    const farcasterToken = request.headers.get('X-Farcaster-Token');
    if (farcasterToken) {
      console.log('🔑 [API /auth/farcaster] Farcaster Quick Auth token provided');
      // In production, you could verify this token with Farcaster's auth server
      // For now, we trust the context from the miniapp SDK
    }

    const result = await authenticateFarcasterUser(fid, username, displayName, pfpUrl);
    
    if (!result.success) {
      console.log('❌ [API /auth/farcaster] Auth failed:', result.error);
      return NextResponse.json(
        { success: false, message: result.error },
        { status: 500 }
      );
    }
    
    console.log('📤 [API /auth/farcaster] Auth result:', {
      success: result.success,
      user: {
        id: result.user.id,
        displayName: result.user.displayName,
        pfpUrl: result.user.pfpUrl,
        username: result.user.username
      }
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("Farcaster auth error:", error);
    return NextResponse.json(
      { success: false, message: "Authentication failed" },
      { status: 500 }
    );
  }
}

