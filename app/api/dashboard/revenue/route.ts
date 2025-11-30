import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { 
  getRevenueMetrics, 
  getDailyRevenueVsCost, 
  getDailyPayers 
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

// GET: Fetch revenue metrics with chart data
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
    const [metrics, revenueVsCost, dailyPayers] = await Promise.all([
      getRevenueMetrics(),
      getDailyRevenueVsCost(30),
      getDailyPayers(30),
    ]);

    return NextResponse.json({
      success: true,
      metrics,
      chartData: {
        revenueVsCost,
        dailyPayers,
      },
    });
  } catch (error) {
    console.error("Dashboard revenue error:", error);
    return NextResponse.json(
      { error: "Failed to fetch revenue metrics" },
      { status: 500 }
    );
  }
}

