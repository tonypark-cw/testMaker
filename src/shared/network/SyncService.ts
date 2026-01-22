import { Prisma, PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { SearchResult } from '../../types/index.js';

/**
 * SyncService
 * Handles batching local JSON results to the remote database using Prisma Upsert.
 */
export class SyncService {
    private prisma: PrismaClient;

    constructor() {
        if (!process.env.DATABASE_URL) {
            console.warn('[SyncService] ⚠️ DATABASE_URL is not set. Sync will perform a dry-run or fail gracefully.');
        }
        // [FIX] Use default constructor, rely on schema's datasource db { url = env("DATABASE_URL") }
        this.prisma = new PrismaClient({
            log: ['warn', 'error']
        });
    }

    /**
     * Sync all JSON files from a directory to the DB
     */
    async syncDirectory(jsonDir: string, environment: string, baseUrl: string) {
        console.log(`[SyncService] 🔄 Starting sync for directory: ${jsonDir}`);

        if (!fs.existsSync(jsonDir)) {
            console.warn(`[SyncService] ⚠️ Directory not found: ${jsonDir}`);
            return;
        }

        // 1. Create or get an Execution record for this sync session
        const execution = await this.prisma.execution.create({
            data: {
                environment,
                baseUrl,
                status: 'completed'
            }
        });

        const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json'));
        let successCount = 0;
        let errorCount = 0;

        for (const file of files) {
            try {
                const filePath = path.join(jsonDir, file);
                const content = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SearchResult;

                await this.syncResult(content, execution.id);
                successCount++;
            } catch (e) {
                console.error(`[SyncService] ❌ Failed to sync file ${file}:`, e);
                errorCount++;
            }
        }

        console.log(`[SyncService] ✅ Sync complete. Success: ${successCount}, Errors: ${errorCount}`);
        await this.prisma.$disconnect();
    }

    /**
     * Sync a single SearchResult to the DB using Upsert
     */
    private async syncResult(result: SearchResult, executionId: string) {
        const domain = new URL(result.url).hostname;

        // 1. Ensure Page exists
        await this.prisma.page.upsert({
            where: { url: result.url },
            update: { domain },
            create: { url: result.url, domain }
        });

        // 2. Generate content hash (if not present)
        const contentHash = result.timestamp || Date.now().toString(); // Fallback to timestamp if hash not explicitly provided

        // 3. Upsert Capture
        await this.prisma.capture.upsert({
            where: {
                pageUrl_hash: {
                    pageUrl: result.url,
                    hash: contentHash
                }
            },
            update: {
                elementsData: result.elements as unknown as Prisma.InputJsonValue,
                screenshotPath: result.screenshotPath,
                executionId: executionId
            },
            create: {
                pageUrl: result.url,
                hash: contentHash,
                elementsData: result.elements as unknown as Prisma.InputJsonValue,
                screenshotPath: result.screenshotPath,
                executionId: executionId
            }
        });
    }
}
