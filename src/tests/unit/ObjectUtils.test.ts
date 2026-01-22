import { describe, it, expect } from 'vitest';
import { extractAllKeys } from '../../shared/utils/ObjectUtils.js';

describe('ObjectUtils', () => {
    describe('extractAllKeys', () => {
        it('should return empty array for non-object inputs', () => {
            expect(extractAllKeys(null)).toEqual([]);
            expect(extractAllKeys(undefined)).toEqual([]);
            expect(extractAllKeys(123)).toEqual([]);
            expect(extractAllKeys('string')).toEqual([]);
        });

        it('should extract top-level keys', () => {
            const obj = { start: 1, end: 2 };
            expect(extractAllKeys(obj)).toEqual(['start', 'end']);
        });

        it('should extract nested keys with dot notation', () => {
            const obj = {
                user: {
                    name: 'test',
                    profile: {
                        age: 30
                    }
                }
            };
            expect(extractAllKeys(obj)).toEqual([
                'user',
                'user.name',
                'user.profile',
                'user.profile.age'
            ]);
        });

        it('should handle arrays by inspecting the first element', () => {
            const obj = {
                items: [
                    { id: 1, details: { active: true } },
                    { id: 2, details: { active: false } }
                ]
            };
            // Note: logic extracts keys recursively from the first element of the array
            // but the array key itself ('items') is also included.
            // Wait, let's trace the implementation:
            // "items" is a key in top level object.
            // record['items'] is an array.
            // it recursively calls extractAllKeys(array, 'items').
            // The array logic checks obj[0] (which is { id: 1... }) and recursively calls with prefix 'items'

            // Expected:
            // 'items' (from top level loop)
            // 'items.id' (from recursion on first element)
            // 'items.details'
            // 'items.details.active'

            expect(extractAllKeys(obj)).toEqual([
                'items',
                'items.id',
                'items.details',
                'items.details.active'
            ]);
        });

        it('should handle direct array input', () => {
            const arr = [{ id: 1, name: 'test' }];
            expect(extractAllKeys(arr)).toEqual(['id', 'name']);
        });

        it('should handle empty arrays', () => {
            expect(extractAllKeys([])).toEqual([]);
        });

        it('should handle mixed types in object', () => {
            const obj = {
                a: 1,
                b: 'string',
                c: null,
                d: { e: true }
            };
            // c is null, so typeof c is 'object' (JS quirk), but !obj check in recursion handles it.
            // Wait:
            // loop key='c'
            // push 'c'
            // value = null
            // if (value && typeof value === 'object') -> null is falsy, so fails check.
            // Correct.

            expect(extractAllKeys(obj)).toEqual(['a', 'b', 'c', 'd', 'd.e']);
        });
    });
});
