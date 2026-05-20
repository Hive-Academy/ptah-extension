/**
 * SubscriptionModule barrel export
 *
 * TASK_2025_123: Subscription management API
 */
export { SubscriptionModule } from './subscription.module';
export { SubscriptionService } from './subscription.service';
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
