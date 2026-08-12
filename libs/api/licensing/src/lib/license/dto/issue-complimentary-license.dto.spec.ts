import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IssueComplimentaryLicenseDto } from './issue-complimentary-license.dto';

/**
 * Boundary validation for the complimentary-license request body.
 *
 * Focus: the Early-Adopter change that lets the admin target a recipient by
 * `email` as an alternative to `userId`, enforced as an EXACTLY-ONE-OF (XOR)
 * rule, with the email lowercased/trimmed at the boundary.
 */
const USER_ID = '11111111-1111-4111-8111-111111111111';

function base(): Record<string, unknown> {
  return {
    durationPreset: '1y',
    plan: 'builders',
    reason: 'Founding contributor reward',
  };
}

async function validationErrorProps(
  payload: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(IssueComplimentaryLicenseDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('IssueComplimentaryLicenseDto — recipient identifier', () => {
  it('accepts a userId alone', async () => {
    const props = await validationErrorProps({ ...base(), userId: USER_ID });
    expect(props).toHaveLength(0);
  });

  it('accepts an email alone', async () => {
    const props = await validationErrorProps({
      ...base(),
      email: 'lead@example.com',
    });
    expect(props).toHaveLength(0);
  });

  it('rejects when BOTH userId and email are provided', async () => {
    const props = await validationErrorProps({
      ...base(),
      userId: USER_ID,
      email: 'lead@example.com',
    });
    // The XOR constraint lives on durationPreset (an always-validated field).
    expect(props).toContain('durationPreset');
  });

  it('rejects when NEITHER userId nor email is provided', async () => {
    const props = await validationErrorProps(base());
    expect(props).toContain('durationPreset');
  });

  it('rejects a malformed email', async () => {
    const props = await validationErrorProps({
      ...base(),
      email: 'not-an-email',
    });
    expect(props).toContain('email');
  });

  it('rejects a non-UUID userId', async () => {
    const props = await validationErrorProps({
      ...base(),
      userId: 'not-a-uuid',
    });
    expect(props).toContain('userId');
  });

  it('lowercases and trims the email at the boundary', async () => {
    const dto = plainToInstance(IssueComplimentaryLicenseDto, {
      ...base(),
      email: '  Lead@Example.COM  ',
    });
    expect(dto.email).toBe('lead@example.com');
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('still hard-locks plan to builders', async () => {
    const props = await validationErrorProps({
      ...base(),
      userId: USER_ID,
      plan: 'community',
    });
    expect(props).toContain('plan');
  });
});
