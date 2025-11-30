import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { 
  getGrowthMetrics, 
  getDailyUserSignups, 
  getDailyActiveUsers, 
  getDailyDeployments 
} from "../../../../lib/database";

const JWT_SECRET = new TextEncoder().encode(
  process.env.ADMIN_JWT_SECRET || "minidev-dashboard-secret-key-change-in-production"
);

// Middleware to verify admin token
async function verifyAdminToken(req: NextRequest): Promise<boolean> {
  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) return false;

    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload.role === "admin";
  } catch {
    return false;
  }
}

// GET: Fetch growth metrics with chart data
export async function GET(req: NextRequest) {
  try {
    const isAuthorized = await verifyAdminToken(req);
    if (!isAuthorized) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Fetch all data in parallel
    const [metrics, userSignups, activeUsers, deployments] = await Promise.all([
      getGrowthMetrics(),
      getDailyUserSignups(30),
      getDailyActiveUsers(30),
      getDailyDeployments(30),
    ]);

    return NextResponse.json({
      success: true,
      metrics,
      chartData: {
        userSignups,
        activeUsers,
        deployments,
      },
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}

