import { logger } from "../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { authenticateFarcasterUser } from "../../../lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { farcasterFid, username, displayName, pfpUrl } = await request.json();

    console.log('📨 [API /auth] Received auth request:', {
      farcasterFid,
      username,
      displayName,
      pfpUrl
    });

    if (!farcasterFid) {
      return NextResponse.json(
        { success: false, message: "Farcaster FID is required" },
        { status: 400 }
      );
    }

    const result = await authenticateFarcasterUser(farcasterFid, username, displayName, pfpUrl);
    
    if (!result.success) {
      console.log('❌ [API /auth] Auth failed:', result.error);
      return NextResponse.json(
        { success: false, message: result.error },
        { status: 500 }
      );
    }
    
    console.log('📤 [API /auth] Auth result:', {
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
    logger.error("Auth error:", error);
    return NextResponse.json(
      { success: false, message: "Authentication failed" },
      { status: 500 }
    );
  }
}
