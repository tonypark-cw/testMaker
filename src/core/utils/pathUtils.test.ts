import { describe, it, expect } from 'vitest';
import { urlToPathName, normalizeUUIDs, filenameToRoute, calculateDepth, getDomainSegment } from './pathUtils.js';

describe('pathUtils', () => {
    describe('urlToPathName', () => {
        it('should convert simple URL to path name', () => {
            expect(urlToPathName('https://example.com/app/home')).toBe('app-home');
        });

        it('should handle root URL', () => {
            expect(urlToPathName('https://example.com/')).toBe('index');
            expect(urlToPathName('https://example.com')).toBe('index');
        });

        it('should handle trailing slashes', () => {
            expect(urlToPathName('https://example.com/app/users/')).toBe('app-users');
        });

        it('should handle invalid URLs safely', () => {
            expect(urlToPathName('not-a-url')).toBe('root');
        });
    });

    describe('normalizeUUIDs', () => {
        it('should replace dynamic UUIDs with :id', () => {
            const path = '/app/customer/550e8400-e29b-41d4-a716-446655440000/edit';
            expect(normalizeUUIDs(path)).toBe('/app/customer/:id/edit');
        });

        it('should replace long hex IDs with :id', () => {
            const path = '/app/item/1234567890abcdef1234567890abcdef/detail';
            expect(normalizeUUIDs(path)).toBe('/app/item/:id/detail');
        });
    });

    describe('filenameToRoute', () => {
        it('should convert standard screenshot filename to route', () => {
            expect(filenameToRoute('screenshot-app_home.webp')).toBe('/app/home');
            expect(filenameToRoute('screenshot-app-home.webp')).toBe('/app/home');
        });

        it('should handle golden prefix', () => {
            expect(filenameToRoute('golden_app_users.json')).toBe('/app/users');
            expect(filenameToRoute('golden_app-users.json')).toBe('/app/users');
        });

        it('should handle timestamps', () => {
            expect(filenameToRoute('app_home_2026-01-12_153000.webp')).toBe('/app/home');
            expect(filenameToRoute('app-home-20260112-1530.webp')).toBe('/app/home');
        });

        it('should handle modal prefix', () => {
            expect(filenameToRoute('modal-settings.webp')).toBe('/app/settings');
        });

        it('should handle UUIDs in filenames', () => {
            expect(filenameToRoute('app_customer_550e8400-e29b-41d4-a716-446655440000.webp')).toBe('/app/customer/:id');
        });
    });

    describe('calculateDepth', () => {
        it('should return 0 for root', () => {
            expect(calculateDepth('/')).toBe(0);
        });

        it('should return correct depth for nested paths', () => {
            expect(calculateDepth('/app/home')).toBe(2);
            expect(calculateDepth('/app/settings/profile')).toBe(3);
        });
    });

    describe('getDomainSegment', () => {
        it('should convert hostname to hyphenated segment', () => {
            expect(getDomainSegment('https://stage.ianai.co/app')).toBe('stage-ianai-co');
        });
    });
});
