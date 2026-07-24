export interface RequestUser {
  /**
   * User ID from WorkOS (JWT subject)
   */
  id: string;

  /**
   * User email address
   */
  email: string;

  /**
   * Tenant/Organization ID
   * Used for multi-tenant isolation in Neo4j, ChromaDB, and LangGraph workflows
   */
  tenantId: string;

  /**
   * WorkOS Organization ID (if user belongs to an organization)
   */
  organizationId?: string;

  /**
   * User roles within the tenant
   * @example ['user', 'admin']
   */
  roles: string[];

  /**
   * Fine-grained permissions
   * @example ['read:docs', 'write:docs', 'manage:users']
   */
  permissions: string[];

  /**
   * Subscription tier for the tenant
   * Used for feature gating and resource limits
   *
   * Open-source + Builders model (Community + Builders)
   * - 'community': Free tier (always valid, no license required)
   * - 'builders': Active Ptah Builders subscription
   * - 'expired': Revoked or payment failed
   */
  tier: 'community' | 'builders' | 'expired';
}

/**
 * JWT Payload structure
 * Stored in the JWT token and validated by JwtAuthGuard
 */
export interface JWTPayload {
  /**
   * Subject - User ID
   */
  sub: string;

  /**
   * User email
   */
  email: string;

  /**
   * Tenant ID for multi-tenant isolation
   */
  tenantId: string;

  /**
   * WorkOS Organization ID
   */
  organizationId?: string;

  /**
   * User roles
   */
  roles: string[];

  /**
   * User permissions
   */
  permissions: string[];

  /**
   * Subscription tier
   *
   * Open-source + Builders model (Community + Builders)
   * - 'community': Free tier (always valid)
   * - 'builders': Active Ptah Builders subscription
   * - 'expired': Revoked or payment failed
   */
  tier: 'community' | 'builders' | 'expired';

  /**
   * Issued at timestamp
   */
  iat: number;

  /**
   * Expiration timestamp
   */
  exp: number;
}

/**
 * Augment Express Request with user property
 */
declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}
