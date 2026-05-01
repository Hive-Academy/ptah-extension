import { IsBoolean, IsEmail, IsOptional } from 'class-validator';

/**
 * DeleteUserDto — request body for `DELETE /api/v1/admin/users/:id`
 * (TASK_2025_292 §5.1).
 *
 * `confirmEmail` is a typed-confirmation safeguard: the admin must type the
 * target user's email before the destructive action fires. Server verifies
 * `confirmEmail.toLowerCase() === user.email.toLowerCase()` — the DTO only
 * enforces *an* email shape.
 *
 * `acknowledgePaidSubscription` is a second-step override. When the target
 * user has an active paid Paddle subscription the service returns
 * `409 ACTIVE_PAID_SUBSCRIPTION`; the admin then re-submits with this flag
 * set to `true` to force-delete.
 */
export class DeleteUserDto {
  @IsEmail()
  confirmEmail!: string;

  @IsOptional()
  @IsBoolean()
  acknowledgePaidSubscription?: boolean;
}
