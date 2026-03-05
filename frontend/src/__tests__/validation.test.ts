import { describe, it, expect } from 'vitest';
import { isAllowedUrl, MAX_INPUT_TEXT_LENGTH, MAX_PDF_BASE64_LENGTH } from '@/lib/validation';

// ═══════════════════════════════════════════════════════════
// isAllowedUrl — SSRF protection
// ═══════════════════════════════════════════════════════════
describe('isAllowedUrl', () => {
    // ── Should ALLOW ──
    it('allows normal HTTP URLs', () => {
        expect(isAllowedUrl('http://example.com')).toBe(true);
    });

    it('allows normal HTTPS URLs', () => {
        expect(isAllowedUrl('https://www.google.com/search?q=test')).toBe(true);
    });

    it('allows Vietnamese job sites', () => {
        expect(isAllowedUrl('https://www.vietnamworks.com/viec-lam/developer')).toBe(true);
        expect(isAllowedUrl('https://www.topcv.vn/viec-lam/python-dev')).toBe(true);
    });

    it('allows LinkedIn job URLs', () => {
        expect(isAllowedUrl('https://www.linkedin.com/jobs/view/123456')).toBe(true);
    });

    // ── Should BLOCK ──
    it('blocks localhost', () => {
        expect(isAllowedUrl('http://localhost:8080')).toBe(false);
    });

    it('blocks 127.0.0.1', () => {
        expect(isAllowedUrl('http://127.0.0.1:3000')).toBe(false);
    });

    it('blocks 0.0.0.0', () => {
        expect(isAllowedUrl('http://0.0.0.0:8000')).toBe(false);
    });

    it('blocks IPv6 loopback', () => {
        expect(isAllowedUrl('http://[::1]:8080')).toBe(false);
    });

    it('blocks private IP 10.x.x.x', () => {
        expect(isAllowedUrl('http://10.0.0.1')).toBe(false);
    });

    it('blocks private IP 192.168.x.x', () => {
        expect(isAllowedUrl('http://192.168.1.1')).toBe(false);
    });

    it('blocks private IP 172.16-31.x.x', () => {
        expect(isAllowedUrl('http://172.16.0.1')).toBe(false);
        expect(isAllowedUrl('http://172.31.255.255')).toBe(false);
    });

    it('blocks AWS metadata endpoint', () => {
        expect(isAllowedUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    });

    it('blocks GCP metadata endpoint', () => {
        expect(isAllowedUrl('http://metadata.google.internal')).toBe(false);
    });

    it('blocks .internal domains', () => {
        expect(isAllowedUrl('http://service.internal')).toBe(false);
    });

    it('blocks .local domains', () => {
        expect(isAllowedUrl('http://myservice.local')).toBe(false);
    });

    it('blocks .localhost domains', () => {
        expect(isAllowedUrl('http://app.localhost')).toBe(false);
    });

    it('blocks FTP protocol', () => {
        expect(isAllowedUrl('ftp://example.com/file.txt')).toBe(false);
    });

    it('blocks file protocol', () => {
        expect(isAllowedUrl('file:///etc/passwd')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isAllowedUrl('')).toBe(false);
    });

    it('returns false for invalid URL', () => {
        expect(isAllowedUrl('not-a-url')).toBe(false);
    });

    it('returns false for javascript protocol', () => {
        expect(isAllowedUrl('javascript:alert(1)')).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════
describe('validation constants', () => {
    it('MAX_INPUT_TEXT_LENGTH is 50000', () => {
        expect(MAX_INPUT_TEXT_LENGTH).toBe(50_000);
    });

    it('MAX_PDF_BASE64_LENGTH is 7000000', () => {
        expect(MAX_PDF_BASE64_LENGTH).toBe(7_000_000);
    });
});
