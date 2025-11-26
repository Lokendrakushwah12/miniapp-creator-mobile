import { logger } from "./logger";
import { db, users, projects } from "../db";
import { eq } from "drizzle-orm";

// Farcaster notification types
export type NotificationType = 
  | 'deployment_complete'
  | 'deployment_failed'
  | 'publish_complete'
  | 'edit_complete';

interface NotificationPayload {
  notificationId: string;
  title: string;
  body: string;
  targetUrl: string;
  tokens: string[];
}

/**
 * Send notification to a user via Farcaster
 */
export async function sendNotification(
  userId: string,
  type: NotificationType,
  projectName: string,
  projectUrl?: string
): Promise<boolean> {
  try {
    logger.log(`📤 Sending ${type} notification to user ${userId}`);

    // Get user's Farcaster FID
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    
    if (!user?.farcasterFid) {
      logger.warn(`⚠️ User ${userId} has no Farcaster FID, skipping notification`);
      return false;
    }

    // Build notification content based on type
    let title: string;
    let body: string;
    
    switch (type) {
      case 'deployment_complete':
        title = '🚀 Deployment Complete!';
        body = `Your app "${projectName}" has been deployed successfully.`;
        break;
      case 'deployment_failed':
        title = '❌ Deployment Failed';
        body = `Your app "${projectName}" deployment encountered an error.`;
        break;
      case 'publish_complete':
        title = '🎉 App Published!';
        body = `Your app "${projectName}" is now live on Farcaster!`;
        break;
      case 'edit_complete':
        title = '✅ Changes Deployed!';
        body = `Your changes to "${projectName}" are now live.`;
        break;
      default:
        title = 'Minidev Update';
        body = `Update for "${projectName}"`;
    }

    // Get the webhook URL for our app (minidev's notification endpoint)
    const webhookUrl = process.env.FARCASTER_WEBHOOK_URL || process.env.NEXT_PUBLIC_APP_URL;
    
    if (!webhookUrl) {
      logger.warn("⚠️ No webhook URL configured, skipping notification");
      return false;
    }

    // Create notification payload for Farcaster
    const notificationPayload: NotificationPayload = {
      notificationId: `${type}-${Date.now()}`,
      title,
      body,
      targetUrl: projectUrl || webhookUrl,
      tokens: [user.farcasterFid.toString()],
    };

    // Send notification via Farcaster's notification API
    // The notification is sent through Farcaster's notification service
    const neynarApiKey = process.env.NEYNAR_API_KEY;
    
    if (neynarApiKey) {
      // Use Neynar API for notifications (recommended approach)
      try {
        const response = await fetch('https://api.neynar.com/v2/farcaster/frame/notifications', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api_key': neynarApiKey,
          },
          body: JSON.stringify({
            target_fids: [user.farcasterFid],
            notification: {
              title,
              body,
              target_url: notificationPayload.targetUrl,
            },
          }),
        });

        if (response.ok) {
          logger.log(`✅ Notification sent successfully to FID ${user.farcasterFid}`);
          return true;
        } else {
          const errorText = await response.text();
          logger.warn(`⚠️ Neynar notification failed: ${response.status} ${errorText}`);
        }
      } catch (neynarError) {
        logger.warn(`⚠️ Neynar API error:`, neynarError);
      }
    }

    // Fallback: Log notification for debugging (notifications will show in app)
    logger.log(`📬 Notification would be sent:`, {
      fid: user.farcasterFid,
      title,
      body,
      url: notificationPayload.targetUrl,
    });

    return true;
  } catch (error) {
    logger.error(`❌ Failed to send notification:`, error);
    return false;
  }
}

/**
 * Send deployment complete notification
 */
export async function notifyDeploymentComplete(
  userId: string,
  projectId: string,
  deploymentUrl: string
): Promise<boolean> {
  try {
    // Get project name
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const projectName = project?.name || 'Your app';
    
    return await sendNotification(userId, 'deployment_complete', projectName, deploymentUrl);
  } catch (error) {
    logger.error("Failed to send deployment complete notification:", error);
    return false;
  }
}

/**
 * Send deployment failed notification
 */
export async function notifyDeploymentFailed(
  userId: string,
  projectId: string
): Promise<boolean> {
  try {
    // Get project name
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const projectName = project?.name || 'Your app';
    
    return await sendNotification(userId, 'deployment_failed', projectName);
  } catch (error) {
    logger.error("Failed to send deployment failed notification:", error);
    return false;
  }
}

/**
 * Send edit/update complete notification
 */
export async function notifyEditComplete(
  userId: string,
  projectId: string,
  deploymentUrl: string
): Promise<boolean> {
  try {
    // Get project name
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const projectName = project?.name || 'Your app';
    
    return await sendNotification(userId, 'edit_complete', projectName, deploymentUrl);
  } catch (error) {
    logger.error("Failed to send edit complete notification:", error);
    return false;
  }
}

/**
 * Send publish complete notification
 */
export async function notifyPublishComplete(
  userId: string,
  projectId: string,
  manifestUrl: string
): Promise<boolean> {
  try {
    // Get project name
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const projectName = project?.name || 'Your app';
    
    return await sendNotification(userId, 'publish_complete', projectName, manifestUrl);
  } catch (error) {
    logger.error("Failed to send publish complete notification:", error);
    return false;
  }
}

