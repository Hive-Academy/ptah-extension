/** The host owns secret storage and binds this token in the host integration batch. */
export interface IReviewSecretPresence {
  hasToken(): Promise<boolean>;
}
