/**
 * SubscriptionModule barrel export
 *
 * TASK_2025_123: Subscription management API
 */

// Module
export { SubscriptionModule } from './subscription.module';

// Service (for use in other modules)
export { SubscriptionService } from './subscription.service';

// DTOs
export {
  ValidateCheckoutDto,
  SubscriptionStatusResponseDto,
  ValidateCheckoutResponseDto,
  ReconcileResponseDto,
  PortalSessionResponseDto,
  PortalSessionErrorDto,
  type SubscriptionDetails,
  type ReconcileChanges,
  type PaddleSubscriptionInfo,
} from './dto';
