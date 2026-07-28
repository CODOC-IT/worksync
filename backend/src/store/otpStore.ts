import fs from 'fs';
import path from 'path';

interface OTPRecord {
  otp: string;
  email: string;
  expiresAt: number; // Unix timestamp ms
  used: boolean;
  createdAt: number;
}

// On Vercel the filesystem is read-only except for /tmp, so we persist
// the OTP store under /tmp when running in a serverless environment.
const DATA_ROOT = process.env.VERCEL === '1'
  ? '/tmp/database'
  : path.resolve(process.cwd(), 'database');
const OTP_DB_PATH = path.resolve(DATA_ROOT, 'otp_store.json');
const OTP_EXPIRY_MS = 60 * 1000; // 1 minute

class OTPStore {
  private records: Map<string, OTPRecord> = new Map(); // key = email

  constructor() {
    this.loadFromDisk();
    // Cleanup expired OTPs every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  private loadFromDisk(): void {
    try {
      const dir = path.dirname(OTP_DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(OTP_DB_PATH)) {
        const data: OTPRecord[] = JSON.parse(fs.readFileSync(OTP_DB_PATH, 'utf-8'));
        data.forEach((r) => this.records.set(r.email.toLowerCase(), r));
      }
    } catch {
      // Start fresh
    }
  }

  private persistToDisk(): void {
    try {
      fs.writeFileSync(OTP_DB_PATH, JSON.stringify([...this.records.values()], null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[OTPStore] Failed to persist:', err.message);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [email, record] of this.records) {
      if (record.expiresAt < now || record.used) {
        this.records.delete(email);
      }
    }
    this.persistToDisk();
  }

  public generate(email: string): string {
    // 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const record: OTPRecord = {
      otp,
      email: email.toLowerCase(),
      expiresAt: Date.now() + OTP_EXPIRY_MS,
      used: false,
      createdAt: Date.now()
    };
    this.records.set(email.toLowerCase(), record);
    this.persistToDisk();
    return otp;
  }

  public verify(email: string, otp: string): { valid: boolean; reason?: string } {
    const record = this.records.get(email.toLowerCase());
    if (!record) return { valid: false, reason: 'No OTP found for this email. Please request a new one.' };
    if (record.used) return { valid: false, reason: 'This OTP has already been used. Please request a new one.' };
    if (Date.now() > record.expiresAt) {
      this.records.delete(email.toLowerCase());
      this.persistToDisk();
      return { valid: false, reason: 'OTP has expired. Please request a new one.' };
    }
    if (record.otp !== otp.trim()) return { valid: false, reason: 'Incorrect OTP. Please try again.' };

    // Mark as used
    record.used = true;
    this.persistToDisk();
    return { valid: true };
  }

  public canResend(email: string): { allowed: boolean; secondsLeft: number } {
    const record = this.records.get(email.toLowerCase());
    if (!record) return { allowed: true, secondsLeft: 0 };
    const elapsed = Date.now() - record.createdAt;
    const cooldownMs = 60 * 1000; // 60s cooldown
    if (elapsed < cooldownMs) {
      return { allowed: false, secondsLeft: Math.ceil((cooldownMs - elapsed) / 1000) };
    }
    return { allowed: true, secondsLeft: 0 };
  }
}

export const otpStore = new OTPStore();
