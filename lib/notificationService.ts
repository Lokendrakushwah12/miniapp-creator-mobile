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

    // Send notification via Neynar's Frame notification API
    // See: https://docs.neynar.com/docs/send-notifications-to-mini-app-users
    // Requires: NEYNAR_API_KEY env variable
    // Also requires webhookUrl in farcaster.json manifest pointing to:
    // https://api.neynar.com/f/app/<NEYNAR_CLIENT_ID>/event
    const neynarApiKey = process.env.NEYNAR_API_KEY;
    
    if (!neynarApiKey) {
      logger.warn("⚠️ NEYNAR_API_KEY not configured, skipping notification");
      return false;
    }

    // Get the frame URL (homeUrl from farcaster.json manifest)
    const frameUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://miniapp.minidev.fun/';
    
    logger.log(`📤 Attempting to send notification via Neynar:`, {
      targetFid: user.farcasterFid,
      frameUrl,
      title,
      body,
      targetUrl: notificationPayload.targetUrl,
    });

    try {
      // Use Neynar's publish frame notifications API
      // Ref: https://docs.neynar.com/reference/publish-frame-notifications
      // Neynar manages tokens automatically via the webhookUrl in your manifest
      const response = await fetch('https://api.neynar.com/v2/farcaster/frame/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': neynarApiKey,
        },
        body: JSON.stringify({
          // Target users by FID
          target_fids: [user.farcasterFid],
          // The frame URL must match the homeUrl in your farcaster.json
          frame_url: frameUrl,
          // Notification content
          notification: {
            title,
            body,
            target_url: notificationPayload.targetUrl,
          },
        }),
      });

      const responseText = await response.text();
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText };
      }

      logger.log(`📬 Neynar API response:`, {
        status: response.status,
        ok: response.ok,
        data: responseData,
      });

      if (response.ok) {
        // Check if notification was actually delivered
        const delivered = responseData?.notification?.delivered_to || [];
        const failed = responseData?.notification?.failed_to || [];
        
        if (delivered.length > 0) {
          logger.log(`✅ Notification delivered to ${delivered.length} user(s):`, delivered);
          return true;
        } else if (failed.length > 0) {
          logger.warn(`⚠️ Notification failed for ${failed.length} user(s):`, failed);
          logger.warn(`Possible reasons: User hasn't enabled notifications for this frame, or notification token expired`);
        } else {
          logger.log(`✅ Notification sent (no delivery details in response)`);
          return true;
        }
      } else {
        logger.warn(`⚠️ Neynar notification failed: ${response.status}`, responseData);
        
        // Common errors
        if (responseData?.message?.includes('no notification tokens') || 
            responseData?.message?.includes('No notification tokens')) {
          logger.warn(`⚠️ User ${user.farcasterFid} hasn't enabled notifications for this mini app`);
        }
        if (responseData?.message?.includes('invalid') || responseData?.code === 'invalid_request') {
          logger.error(`❌ Invalid request - check API key and request format`);
        }
      }
    } catch (neynarError) {
      logger.error(`⚠️ Neynar API error:`, neynarError);
    }

    // If we reach here, notification failed
    logger.log(`📬 Notification failed for FID ${user.farcasterFid}:`, {
      title,
      body,
      url: notificationPayload.targetUrl,
    });

    return false;
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

