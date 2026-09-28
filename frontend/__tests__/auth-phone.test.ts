import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn(), verify: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithOtp: mocks.send, verifyOtp: mocks.verify } } }));
import { normalizePhoneNumber, sendPhoneCode, verifyPhoneCode } from '@/lib/auth-phone';
beforeEach(() => { mocks.send.mockReset().mockResolvedValue({ error: null }); mocks.verify.mockReset().mockResolvedValue({ error: null }); });
describe('phone authentication', () => {
  it('normalizes international numbers and rejects incomplete numbers before sending', async () => {
    expect(normalizePhoneNumber('+91 (98765) 43210')).toBe('+919876543210');
    for (const number of ['123', '9876543210', '+01234567890', '+911234567890123456']) await expect(sendPhoneCode(number)).rejects.toThrow('country code');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(await sendPhoneCode('+91 98765 43210')).toBe('+919876543210');
    expect(mocks.send).toHaveBeenCalledWith({ phone: '+919876543210' });
  });
  it('verifies the code against the number that received it using SMS OTP', async () => {
    await verifyPhoneCode('+919876543210', '123456');
    expect(mocks.verify).toHaveBeenCalledWith({ phone: '+919876543210', token: '123456', type: 'sms' });
    await expect(verifyPhoneCode('+919876543210', '123')).rejects.toThrow('6-digit');
    expect(mocks.verify).toHaveBeenCalledTimes(1);
  });
  it('surfaces disabled providers, rate limits and invalid OTP errors', async () => {
    mocks.send.mockResolvedValue({ error: new Error('SMS provider disabled') });
    await expect(sendPhoneCode('+919876543210')).rejects.toThrow('SMS provider disabled');
    mocks.verify.mockResolvedValue({ error: new Error('Token expired') });
    await expect(verifyPhoneCode('+919876543210', '123456')).rejects.toThrow('Token expired');
  });
});
