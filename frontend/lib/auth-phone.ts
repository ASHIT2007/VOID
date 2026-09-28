import { supabase } from './supabase';

export function normalizePhoneNumber(value: string): string {
  const phone = value.replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Enter your phone number with its country code, for example +91 98765 43210.');
  return phone;
}
export async function sendPhoneCode(value: string): Promise<string> {
  const phone = normalizePhoneNumber(value);
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) throw error;
  return phone;
}
export async function verifyPhoneCode(phone: string, token: string): Promise<void> {
  if (!/^\d{6}$/.test(token)) throw new Error('Enter the 6-digit code sent to your phone.');
  const { error } = await supabase.auth.verifyOtp({ phone: normalizePhoneNumber(phone), token, type: 'sms' });
  if (error) throw error;
}
