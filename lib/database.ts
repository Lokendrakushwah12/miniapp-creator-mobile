import { logger } from "./logger";
import { db, users, projects, projectFiles, projectPatches, projectDeployments, userSessions, chatMessages, generationJobs, apiUsage, payments } from '../db';
import { eq, and, desc, sql, gte, count, countDistinct, sum } from 'drizzle-orm';

// Type definition for generation job context
export interface GenerationJobContext {
  prompt: string;
  existingProjectId?: string;
  useMultiStage?: boolean;
  sessionId?: string;          // Session ID for transferring in-memory messages
  conversationHistory?: Array<{ role: string; content: string; phase?: string; timestamp?: number }>;  // Full conversation history
  // Follow-up edit specific fields
  isFollowUp?: boolean;        // Flag to identify follow-up edits vs initial generation
  useDiffBased?: boolean;      // Whether to use diff-based pipeline
}

// User management functions
export async function createUser(farcasterFid: number, username?: string, displayName?: string, pfpUrl?: string) {
  const [user] = await db.insert(users).values({
    farcasterFid,
    username,
    displayName,
    pfpUrl,
  }).returning();
  return user;
}

export async function getUserByFarcasterFid(farcasterFid: number) {
  try {
    
    // Add a timeout to prevent hanging
    const queryPromise = db.select().from(users).where(eq(users.farcasterFid, farcasterFid));
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database query timeout')), 10000)
    );
    
    const [user] = await Promise.race([queryPromise, timeoutPromise]) as typeof users.$inferSelect[];
    return user;
  } catch (error) {
    logger.error('❌ getUserByFarcasterFid error:', error);
    throw error;
  }
}

export async function getUserById(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  return user;
}

// Project management functions
export async function createProject(
  userId: string,
  name: string,
  description?: string,
  previewUrl?: string,
  customId?: string,
  appType: 'farcaster' | 'web3' = 'farcaster'
) {
  const [project] = await db.insert(projects).values({
    id: customId, // Use custom ID if provided, otherwise let database generate one
    userId,
    name,
    description,
    previewUrl,
    appType,
  }).returning();
  return project;
}

export async function getProjectById(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  return project;
}

export async function getProjectsByUserId(userId: string) {
  return await db.select().from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.status, 'active')))
    .orderBy(desc(projects.updatedAt));
}

export async function updateProject(projectId: string, updates: Partial<typeof projects.$inferInsert>) {
  const [project] = await db.update(projects)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(projects.id, projectId))
    .returning();
  return project;
}

export async function deleteProject(projectId: string) {
  await db.update(projects)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

// Project files management
export async function saveProjectFiles(projectId: string, files: { filename: string; content: string }[]) {
  logger.log(`\n${"=".repeat(60)}`);
  logger.log(`💾 SAVING PROJECT FILES TO DATABASE`);
  logger.log(`📁 Project ID: ${projectId}`);
  logger.log(`📂 Total files to save: ${files.length}`);
  logger.log(`${"=".repeat(60)}\n`);
  
  // Delete existing files for this project
  logger.log(`🗑️  Deleting existing files for project ${projectId}...`);
  const deletedFiles = await db.delete(projectFiles).where(eq(projectFiles.projectId, projectId)).returning();
  logger.log(`✅ Deleted ${deletedFiles.length} existing files`);
  
  // Filter out files that might cause encoding issues
  const safeFiles = files.filter(file => {
    // Check for potential encoding issues
    if (file.content.includes('\0') || file.content.includes('\x00')) {
      logger.log(`⚠️ Skipping file with null bytes: ${file.filename}`);
      return false;
    }
    return true;
  });
  
  logger.log(`📁 Saving ${safeFiles.length} safe files to database (${files.length - safeFiles.length} filtered out)`);
  
  // Insert new files
  const fileRecords = safeFiles.map(file => ({
    projectId,
    filename: file.filename,
    content: file.content,
    version: 1,
  }));
  
  const inserted = await db.insert(projectFiles).values(fileRecords).returning();
  logger.log(`✅ Successfully inserted ${inserted.length} files into database`);
  logger.log(`📝 Sample filenames:`, inserted.slice(0, 5).map(f => f.filename));
  logger.log(`${"=".repeat(60)}\n`);
  
  return inserted;
}

export async function getProjectFiles(projectId: string) {
  logger.log(`\n📥 FETCHING PROJECT FILES FROM DATABASE`);
  logger.log(`📁 Project ID: ${projectId}`);
  
  const files = await db.select().from(projectFiles)
    .where(eq(projectFiles.projectId, projectId))
    .orderBy(projectFiles.filename);
  
  logger.log(`✅ Fetched ${files.length} files from database`);
  if (files.length > 0) {
    logger.log(`📝 Sample filenames:`, files.slice(0, 5).map(f => f.filename));
    logger.log(`📅 Last updated:`, files[0].updatedAt);
  }
  logger.log(`${"=".repeat(60)}\n`);
  
  return files;
}

export async function updateProjectFile(projectId: string, filename: string, content: string) {
  const [file] = await db.update(projectFiles)
    .set({ content, updatedAt: new Date() })
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.filename, filename)))
    .returning();
  return file;
}

// Upsert a single project file (insert if doesn't exist, update if exists)
export async function upsertProjectFile(projectId: string, filename: string, content: string) {
  logger.log(`🔄 Upserting file: ${filename} for project ${projectId}`);
  
  // Check if file exists
  const existingFile = await db.select().from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.filename, filename)))
    .limit(1);
  
  if (existingFile.length > 0) {
    // Update existing file
    logger.log(`📝 File exists, updating: ${filename}`);
    const [updated] = await db.update(projectFiles)
      .set({ content, updatedAt: new Date() })
      .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.filename, filename)))
      .returning();
    return updated;
  } else {
    // Insert new file
    logger.log(`➕ File doesn't exist, inserting: ${filename}`);
    const [inserted] = await db.insert(projectFiles)
      .values({
        projectId,
        filename,
        content,
        version: 1,
      })
      .returning();
    return inserted;
  }
}

// Delete a single project file from database
export async function deleteProjectFile(projectId: string, filename: string) {
  logger.log(`🗑️ Deleting file: ${filename} from project ${projectId}`);
  
  const [deleted] = await db.delete(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.filename, filename)))
    .returning();
  
  if (deleted) {
    logger.log(`✅ File deleted: ${filename}`);
  } else {
    logger.log(`⚠️ File not found for deletion: ${filename}`);
  }
  
  return deleted;
}

// Patch management
export async function savePatch(
  projectId: string,
  patchData: Record<string, unknown>,
  description?: string
) {
  const [patch] = await db.insert(projectPatches).values({
    projectId,
    patchData,
    description,
  }).returning();
  return patch;
}

export async function getProjectPatches(projectId: string) {
  return await db.select().from(projectPatches)
    .where(eq(projectPatches.projectId, projectId))
    .orderBy(desc(projectPatches.appliedAt));
}

export async function revertPatch(patchId: string) {
  const [patch] = await db.update(projectPatches)
    .set({ revertedAt: new Date() })
    .where(eq(projectPatches.id, patchId))
    .returning();
  return patch;
}

// Deployment management
export async function createDeployment(
  projectId: string,
  platform: string,
  deploymentUrl: string,
  status: string = 'pending',
  buildLogs?: string,
  contractAddresses?: { [key: string]: string }
) {
  const [deployment] = await db.insert(projectDeployments).values({
    projectId,
    platform,
    deploymentUrl,
    status,
    buildLogs,
    contractAddresses: contractAddresses || null,
  }).returning();
  return deployment;
}

export async function updateDeployment(
  deploymentId: string,
  updates: Partial<typeof projectDeployments.$inferInsert>
) {
  const [deployment] = await db.update(projectDeployments)
    .set(updates)
    .where(eq(projectDeployments.id, deploymentId))
    .returning();
  return deployment;
}

export async function getProjectDeployments(projectId: string) {
  return await db.select().from(projectDeployments)
    .where(eq(projectDeployments.projectId, projectId))
    .orderBy(desc(projectDeployments.createdAt));
}

// Session management
export async function createUserSession(userId: string, sessionToken: string, expiresAt: Date) {
  const [session] = await db.insert(userSessions).values({
    userId,
    sessionToken,
    expiresAt,
  }).returning();
  return session;
}

export async function getSessionByToken(sessionToken: string) {
  const [session] = await db.select().from(userSessions)
    .where(and(
      eq(userSessions.sessionToken, sessionToken),
      // Check if session is not expired
      // This would need a proper date comparison in a real implementation
    ));
  return session;
}

export async function deleteSession(sessionToken: string) {
  await db.delete(userSessions).where(eq(userSessions.sessionToken, sessionToken));
}

export async function deleteExpiredSessions() {
//   const now = new Date();
  // This would need proper date comparison in a real implementation
  // For now, we'll implement a simple cleanup by deleting all sessions
  // In production, you'd use: lt(userSessions.expiresAt, now)
  await db.delete(userSessions);
}

// Add this function to get user by session token
export async function getUserBySessionToken(sessionToken: string) {
  const [session] = await db
    .select({
      id: userSessions.id,
      userId: userSessions.userId,
      expiresAt: userSessions.expiresAt,
      createdAt: userSessions.createdAt,
    })
    .from(userSessions)
    .where(eq(userSessions.sessionToken, sessionToken));

  if (!session) return null;

  // Get user details
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId));

  return user ? { ...user, expiresAt: session.expiresAt } : null;
}

// Add function to update user info
export async function updateUser(
  userId: string,
  updates: {
    username?: string;
    displayName?: string;
    pfpUrl?: string;
  }
) {
  console.log('🗄️  [database.ts] updateUser called with:', {
    userId,
    updates
  });
  
  // Convert undefined to null for database - Drizzle might ignore undefined values
  const updatePayload: Record<string, string | null | Date> = {
    updatedAt: new Date(),
  };
  
  // Explicitly handle each field to convert undefined to null
  if ('username' in updates) {
    updatePayload.username = updates.username ?? null;
  }
  if ('displayName' in updates) {
    updatePayload.displayName = updates.displayName ?? null;
  }
  if ('pfpUrl' in updates) {
    updatePayload.pfpUrl = updates.pfpUrl ?? null;
    console.log('🗄️  [database.ts] Setting pfpUrl to:', updates.pfpUrl ?? null);
  }
  
  console.log('🗄️  [database.ts] Update payload being sent to DB:', updatePayload);
  
  const [user] = await db
    .update(users)
    .set(updatePayload)
    .where(eq(users.id, userId))
    .returning();

  console.log('🗄️  [database.ts] User returned from DB after update:', {
    id: user.id,
    displayName: user.displayName,
    pfpUrl: user.pfpUrl,
    username: user.username
  });

  return user;
}

// Chat message management functions
export async function saveChatMessage(
  projectId: string,
  role: 'user' | 'ai',
  content: string,
  phase?: string,
  changedFiles?: string[]
) {
  const [message] = await db.insert(chatMessages).values({
    projectId,
    role,
    content,
    phase,
    changedFiles: changedFiles ? changedFiles : null,
  }).returning();
  return message;
}

export async function getProjectChatMessages(projectId: string) {
  return await db.select().from(chatMessages)
    .where(eq(chatMessages.projectId, projectId))
    .orderBy(chatMessages.timestamp);
}

export async function migrateChatMessages(fromProjectId: string, toProjectId: string) {
  // Get all chat messages from the source project
  const messages = await db.select().from(chatMessages)
    .where(eq(chatMessages.projectId, fromProjectId));
  
  if (messages.length === 0) {
    logger.log(`No chat messages to migrate from ${fromProjectId} to ${toProjectId}`);
    return [];
  }
  
  // Update the projectId for all messages
  const updatedMessages = messages.map(msg => ({
    ...msg,
    projectId: toProjectId
  }));
  
  // Delete old messages and insert with new projectId
  await db.delete(chatMessages).where(eq(chatMessages.projectId, fromProjectId));
  
  const migratedMessages = await db.insert(chatMessages).values(updatedMessages).returning();
  
  logger.log(`✅ Migrated ${migratedMessages.length} chat messages from ${fromProjectId} to ${toProjectId}`);
  return migratedMessages;
}

export async function clearProjectChatMessages(projectId: string) {
  await db.delete(chatMessages).where(eq(chatMessages.projectId, projectId));
}

// Generation job management functions
export async function createGenerationJob(
  userId: string,
  prompt: string,
  context: Record<string, unknown>,
  projectId?: string,
  appType: 'farcaster' | 'web3' = 'farcaster'
) {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours from now

  const [job] = await db.insert(generationJobs).values({
    userId,
    projectId: projectId || null,
    appType,
    prompt,
    context,
    expiresAt,
  }).returning();
  return job;
}

export async function getGenerationJobById(jobId: string) {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
  return job;
}

export async function updateGenerationJobStatus(
  jobId: string,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  result?: Record<string, unknown>,
  error?: string
) {
  const updates: Record<string, unknown> = { status };

  if (status === 'processing' && !result) {
    updates.startedAt = new Date();
  }

  if (status === 'completed' || status === 'failed') {
    updates.completedAt = new Date();
  }

  if (result !== undefined) {
    updates.result = result;
  }

  if (error !== undefined) {
    updates.error = error;
  }

  const [job] = await db.update(generationJobs)
    .set(updates)
    .where(eq(generationJobs.id, jobId))
    .returning();
  return job;
}

export async function getPendingGenerationJobs(limit: number = 10) {
  return await db.select().from(generationJobs)
    .where(eq(generationJobs.status, 'pending'))
    .orderBy(generationJobs.createdAt)
    .limit(limit);
}

export async function deleteExpiredGenerationJobs() {
  const now = new Date();
  await db.delete(generationJobs)
    .where(sql`${generationJobs.expiresAt} < ${now}`);
}

export async function getUserGenerationJobs(userId: string, limit: number = 20) {
  return await db.select().from(generationJobs)
    .where(eq(generationJobs.userId, userId))
    .orderBy(desc(generationJobs.createdAt))
    .limit(limit);
}

// ============================================
// API Usage Tracking Functions
// ============================================

export async function saveApiUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  stage?: string,
  userId?: string,
  projectId?: string
) {
  try {
    const [usage] = await db.insert(apiUsage).values({
      userId: userId || null,
      projectId: projectId || null,
      model,
      stage,
      inputTokens,
      outputTokens,
      costUsd: costUsd.toFixed(6),
    }).returning();
    return usage;
  } catch (error) {
    logger.error('Failed to save API usage:', error);
    // Don't throw - we don't want to fail the main operation if tracking fails
    return null;
  }
}

// ============================================
// Payment Tracking Functions
// ============================================

export async function savePayment(
  amountUsd: number,
  creditsPurchased: number,
  userId?: string,
  walletAddress?: string,
  transactionHash?: string,
  status: string = 'completed'
) {
  const [payment] = await db.insert(payments).values({
    userId: userId || null,
    walletAddress,
    amountUsd: amountUsd.toFixed(2),
    creditsPurchased,
    transactionHash,
    status,
  }).returning();
  return payment;
}

export async function getPaymentsByUserId(userId: string) {
  return await db.select().from(payments)
    .where(eq(payments.userId, userId))
    .orderBy(desc(payments.createdAt));
}

// ============================================
// Dashboard Metrics Functions
// ============================================

export interface GrowthMetrics {
  totalUsers: number;
  dau: number;
  mau: number;
  peakActiveHour: { hour: string; count: number } | null;
  paidUsers: number;
  recurringUsers: number;
  deploymentsSuccess: number;
  deploymentsFailed: number;
  publishedApps: number;
  avgFailsPerUser: number;
}

export interface RevenueMetrics {
  dailyPayers: number;
  totalPayers: number;
  recurringPayers: number;
  totalApiCost: number;
  dailyApiCost: number;
  totalRevenue: number;
  dailyRevenue: number;
}

export async function getGrowthMetrics(): Promise<GrowthMetrics> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Total users
  const [totalUsersResult] = await db.select({ count: count() }).from(users);
  const totalUsers = totalUsersResult?.count || 0;

  // DAU - distinct users with sessions in last 24 hours
  const [dauResult] = await db
    .select({ count: countDistinct(userSessions.userId) })
    .from(userSessions)
    .where(gte(userSessions.createdAt, oneDayAgo));
  const dau = dauResult?.count || 0;

  // MAU - distinct users with sessions in last 30 days
  const [mauResult] = await db
    .select({ count: countDistinct(userSessions.userId) })
    .from(userSessions)
    .where(gte(userSessions.createdAt, thirtyDaysAgo));
  const mau = mauResult?.count || 0;

  // Peak active hour (sessions grouped by hour)
  const peakHourResult = await db
    .select({
      hour: sql<string>`date_trunc('hour', ${userSessions.createdAt})::text`,
      count: count(),
    })
    .from(userSessions)
    .groupBy(sql`date_trunc('hour', ${userSessions.createdAt})`)
    .orderBy(desc(count()))
    .limit(1);
  const peakActiveHour = peakHourResult[0] ? { hour: peakHourResult[0].hour, count: peakHourResult[0].count } : null;

  // Paid users - users with at least one payment
  const [paidUsersResult] = await db
    .select({ count: countDistinct(payments.userId) })
    .from(payments)
    .where(eq(payments.status, 'completed'));
  const paidUsers = paidUsersResult?.count || 0;

  // Recurring users - users with more than one session
  const recurringUsersResult = await db
    .select({ userId: userSessions.userId, sessionCount: count() })
    .from(userSessions)
    .groupBy(userSessions.userId);
  const recurringUsers = recurringUsersResult.filter(r => r.sessionCount > 1).length;

  // Deployment stats
  const [successResult] = await db
    .select({ count: count() })
    .from(projectDeployments)
    .where(eq(projectDeployments.status, 'success'));
  const deploymentsSuccess = successResult?.count || 0;

  const [failedResult] = await db
    .select({ count: count() })
    .from(projectDeployments)
    .where(eq(projectDeployments.status, 'failed'));
  const deploymentsFailed = failedResult?.count || 0;

  // Published apps
  const [publishedResult] = await db
    .select({ count: count() })
    .from(projects)
    .where(sql`${projects.publishedAt} IS NOT NULL`);
  const publishedApps = publishedResult?.count || 0;

  // Average fails per user
  const failsPerUserResult = await db
    .select({
      userId: projects.userId,
      failCount: count(),
    })
    .from(projectDeployments)
    .innerJoin(projects, eq(projectDeployments.projectId, projects.id))
    .where(eq(projectDeployments.status, 'failed'))
    .groupBy(projects.userId);
  
  const avgFailsPerUser = failsPerUserResult.length > 0
    ? failsPerUserResult.reduce((sum, r) => sum + r.failCount, 0) / failsPerUserResult.length
    : 0;

  return {
    totalUsers,
    dau,
    mau,
    peakActiveHour,
    paidUsers,
    recurringUsers,
    deploymentsSuccess,
    deploymentsFailed,
    publishedApps,
    avgFailsPerUser: Math.round(avgFailsPerUser * 100) / 100,
  };
}

export async function getRevenueMetrics(): Promise<RevenueMetrics> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Daily payers
  const [dailyPayersResult] = await db
    .select({ count: countDistinct(payments.userId) })
    .from(payments)
    .where(and(
      gte(payments.createdAt, oneDayAgo),
      eq(payments.status, 'completed')
    ));
  const dailyPayers = dailyPayersResult?.count || 0;

  // Total payers
  const [totalPayersResult] = await db
    .select({ count: countDistinct(payments.userId) })
    .from(payments)
    .where(eq(payments.status, 'completed'));
  const totalPayers = totalPayersResult?.count || 0;

  // Recurring payers (users with 2+ payments)
  const payerCountsResult = await db
    .select({
      userId: payments.userId,
      paymentCount: count(),
    })
    .from(payments)
    .where(eq(payments.status, 'completed'))
    .groupBy(payments.userId);
  const recurringPayers = payerCountsResult.filter(r => r.paymentCount >= 2).length;

  // Total API cost
  const [totalApiCostResult] = await db
    .select({ total: sum(apiUsage.costUsd) })
    .from(apiUsage);
  const totalApiCost = parseFloat(totalApiCostResult?.total || '0');

  // Daily API cost
  const [dailyApiCostResult] = await db
    .select({ total: sum(apiUsage.costUsd) })
    .from(apiUsage)
    .where(gte(apiUsage.createdAt, oneDayAgo));
  const dailyApiCost = parseFloat(dailyApiCostResult?.total || '0');

  // Total revenue
  const [totalRevenueResult] = await db
    .select({ total: sum(payments.amountUsd) })
    .from(payments)
    .where(eq(payments.status, 'completed'));
  const totalRevenue = parseFloat(totalRevenueResult?.total || '0');

  // Daily revenue
  const [dailyRevenueResult] = await db
    .select({ total: sum(payments.amountUsd) })
    .from(payments)
    .where(and(
      gte(payments.createdAt, oneDayAgo),
      eq(payments.status, 'completed')
    ));
  const dailyRevenue = parseFloat(dailyRevenueResult?.total || '0');

  return {
    dailyPayers,
    totalPayers,
    recurringPayers,
    totalApiCost: Math.round(totalApiCost * 100) / 100,
    dailyApiCost: Math.round(dailyApiCost * 100) / 100,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    dailyRevenue: Math.round(dailyRevenue * 100) / 100,
  };
}

// ============================================
// Time-Series Chart Data Functions
// ============================================

export interface ChartDataPoint {
  date: string;
  value: number;
}

export interface DeploymentChartPoint {
  date: string;
  success: number;
  failed: number;
}

export interface RevenueChartPoint {
  date: string;
  revenue: number;
  cost: number;
}

/**
 * Get daily user signups for the last N days
 */
export async function getDailyUserSignups(days: number = 30): Promise<ChartDataPoint[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const result = await db
    .select({
      date: sql<string>`date_trunc('day', ${users.createdAt})::date::text`,
      value: count(),
    })
    .from(users)
    .where(gte(users.createdAt, startDate))
    .groupBy(sql`date_trunc('day', ${users.createdAt})`)
    .orderBy(sql`date_trunc('day', ${users.createdAt})`);

  // Fill in missing days with zeros
  return fillMissingDays(result, days);
}

/**
 * Get daily active users for the last N days
 */
export async function getDailyActiveUsers(days: number = 30): Promise<ChartDataPoint[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const result = await db
    .select({
      date: sql<string>`date_trunc('day', ${userSessions.createdAt})::date::text`,
      value: countDistinct(userSessions.userId),
    })
    .from(userSessions)
    .where(gte(userSessions.createdAt, startDate))
    .groupBy(sql`date_trunc('day', ${userSessions.createdAt})`)
    .orderBy(sql`date_trunc('day', ${userSessions.createdAt})`);

  return fillMissingDays(result, days);
}

/**
 * Get daily deployments (success vs failed) for the last N days
 */
export async function getDailyDeployments(days: number = 30): Promise<DeploymentChartPoint[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const result = await db
    .select({
      date: sql<string>`date_trunc('day', ${projectDeployments.createdAt})::date::text`,
      status: projectDeployments.status,
      count: count(),
    })
    .from(projectDeployments)
    .where(gte(projectDeployments.createdAt, startDate))
    .groupBy(sql`date_trunc('day', ${projectDeployments.createdAt})`, projectDeployments.status)
    .orderBy(sql`date_trunc('day', ${projectDeployments.createdAt})`);

  // Aggregate success and failed counts per day
  const dateMap = new Map<string, { success: number; failed: number }>();
  
  for (const row of result) {
    if (!dateMap.has(row.date)) {
      dateMap.set(row.date, { success: 0, failed: 0 });
    }
    const entry = dateMap.get(row.date)!;
    if (row.status === 'success') {
      entry.success = row.count;
    } else if (row.status === 'failed') {
      entry.failed = row.count;
    }
  }

  // Fill missing days
  const filledData: DeploymentChartPoint[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    const existing = dateMap.get(dateStr);
    filledData.push({
      date: dateStr,
      success: existing?.success || 0,
      failed: existing?.failed || 0,
    });
  }

  return filledData;
}

/**
 * Get daily API costs for the last N days
 */
export async function getDailyApiCosts(days: number = 30): Promise<ChartDataPoint[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const result = await db
    .select({
      date: sql<string>`date_trunc('day', ${apiUsage.createdAt})::date::text`,
      value: sql<string>`COALESCE(SUM(${apiUsage.costUsd}), 0)`,
    })
    .from(apiUsage)
    .where(gte(apiUsage.createdAt, startDate))
    .groupBy(sql`date_trunc('day', ${apiUsage.createdAt})`)
    .orderBy(sql`date_trunc('day', ${apiUsage.createdAt})`);

  const chartData = result.map(r => ({
    date: r.date,
    value: Math.round(parseFloat(r.value) * 100) / 100,
  }));

  return fillMissingDays(chartData, days);
}

/**
 * Get daily revenue for the last N days
 */
export async function getDailyRevenue(days: number = 30): Promise<ChartDataPoint[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const result = await db
    .select({
      date: sql<string>`date_trunc('day', ${payments.createdAt})::date::text`,
      value: sql<string>`COALESCE(SUM(${payments.amountUsd}), 0)`,
    })
    .from(payments)
    .where(and(
      gte(payments.createdAt, startDate),
      eq(payments.status, 'completed')
    ))
    .groupBy(sql`date_trunc('day', ${payments.createdAt})`)
    .orderBy(sql`date_trunc('day', ${payments.createdAt})`);

  const chartData = result.map(r => ({
    date: r.date,
    value: Math.round(parseFloat(r.value) * 100) / 100,
  }));

  return fillMissingDays(chartData, days);
}

/**
 * Get combined revenue and cost data for the last N days
 */
export async function getDailyRevenueVsCost(days: number = 30): Promise<RevenueChartPoint[]> {
  const [revenueData, costData] = await Promise.all([
    getDailyRevenue(days),
    getDailyApiCosts(days),
  ]);

  // Combine into single data points
  const combined: RevenueChartPoint[] = [];
  for (let i = 0; i < revenueData.length; i++) {
    combined.push({
      date: revenueData[i].date,
      revenue: revenueData[i].value,
      cost: costData[i]?.value || 0,
    });
  }

  return combined;
}

/**
 * Get daily payer count for the last N days
 */
export async function getDailyPayers(days: number = 30): Promise<ChartDataPoint[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const result = await db
    .select({
      date: sql<string>`date_trunc('day', ${payments.createdAt})::date::text`,
      value: countDistinct(payments.userId),
    })
    .from(payments)
    .where(and(
      gte(payments.createdAt, startDate),
      eq(payments.status, 'completed')
    ))
    .groupBy(sql`date_trunc('day', ${payments.createdAt})`)
    .orderBy(sql`date_trunc('day', ${payments.createdAt})`);

  return fillMissingDays(result, days);
}

/**
 * Helper function to fill in missing days with zero values
 */
function fillMissingDays(data: ChartDataPoint[], days: number): ChartDataPoint[] {
  const dateMap = new Map<string, number>();
  for (const point of data) {
    dateMap.set(point.date, point.value);
  }

  const filledData: ChartDataPoint[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    filledData.push({
      date: dateStr,
      value: dateMap.get(dateStr) || 0,
    });
  }

  return filledData;
}
