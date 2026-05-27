// api/src/validators/notificationValidator.ts

import { z } from 'zod/v4';

export const createNotificationSchema = z.object({
  userId: z.number().int().positive(),
  type: z.string().min(1),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  entityType: z.string().max(50).optional(),
  entityId: z.number().int().optional(),
});

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;