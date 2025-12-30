import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Handlebars from 'handlebars';
import { AnalysisResult, GeneratorOptions } from '../types/index.js';

export class Generator {
    constructor() {
        // Register handlebars helpers
        Handlebars.registerHelper('add', (a, b) => a + b);
        Handlebars.registerHelper('eq', (a, b) => a === b);
    }

    async generate(result: AnalysisResult, options: GeneratorOptions) {
        console.log(`[Generator] Generating output in ${options.outputDir}...`);

        if (!fs.existsSync(options.outputDir)) {
            fs.mkdirSync(options.outputDir, { recursive: true });
        }

        if (options.formats.includes('markdown') || options.formats.includes('both')) {
            await this.generateMarkdown(result, options);
        }

        if (options.formats.includes('playwright') || options.formats.includes('both')) {
            await this.generatePlaywright(result, options);
        }

        // Always generate JSON for caching/incremental analysis
        await this.generateJson(result, options);
    }

    private getUniqueFilename(url: string, extension: string, prefix: string = '') {
        const urlParsed = new URL(url);
        // Create a unique hash based on the full URL to handle query params/hashes
        const urlHash = crypto.createHash('md5').update(url).digest('hex').substring(0, 6);
        const urlPathName = urlParsed.pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'index';

        const fileName = `${prefix}${urlPathName}-${urlHash}.${extension}`;
        return fileName.replace(/^-/, ''); // Remove leading dash if prefix is empty
    }

    private async generateMarkdown(result: AnalysisResult, options: GeneratorOptions) {
        const domain = (result.metadata as any).domain || new URL(result.url).hostname.replace(/\./g, '-');
        const targetDir = path.join(options.outputDir, 'markdown', domain);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const templatePath = path.join(process.cwd(), 'templates/tc-markdown.hbs');
        let templateSource = '';
        try {
            templateSource = fs.readFileSync(templatePath, 'utf-8');
        } catch (e) {
            console.warn(`[Generator] Warning: Template not found at ${templatePath}. Using default.`);
            templateSource = '# Test Cases for {{url}}\n\n{{#each scenarios}}\n## {{this.title}}\n{{this.description}}\n\n{{/each}}';
        }

        const template = Handlebars.compile(templateSource);
        const output = template(result);

        const filename = this.getUniqueFilename(result.url, 'md', 'test-cases-');

        fs.writeFileSync(path.join(targetDir, filename), output);
        console.log(`[Generator] Created markdown report: ${path.join(targetDir, filename)}`);
    }

    private async generatePlaywright(result: AnalysisResult, options: GeneratorOptions) {
        const domain = (result.metadata as any).domain || new URL(result.url).hostname.replace(/\./g, '-');
        const targetDir = path.join(options.outputDir, 'playwright', domain);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const templatePath = path.join(process.cwd(), 'templates/playwright.hbs');
        let templateSource = '';
        try {
            templateSource = fs.readFileSync(templatePath, 'utf-8');
        } catch (e) {
            console.warn(`[Generator] Warning: Template not found at ${templatePath}. Using default.`);
            templateSource = 'import { test, expect } from "@playwright/test";\n\ntest("{{pageTitle}}", async ({ page }) => {\n  await page.goto("{{url}}");\n});';
        }

        const template = Handlebars.compile(templateSource);
        const output = template(result);

        const filename = this.getUniqueFilename(result.url, 'spec.ts', `${domain}-`);

        fs.writeFileSync(path.join(targetDir, filename), output);
        console.log(`[Generator] Created playwright spec: ${path.join(targetDir, filename)}`);
    }

    private async generateJson(result: AnalysisResult, options: GeneratorOptions) {
        const domain = (result.metadata as any).domain || new URL(result.url).hostname.replace(/\./g, '-');
        const targetDir = path.join(options.outputDir, 'json', domain);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const filename = this.getUniqueFilename(result.url, 'json', `${domain}-`);

        fs.writeFileSync(path.join(targetDir, filename), JSON.stringify(result, null, 2));
        console.log(`[Generator] Created JSON metadata: ${path.join(targetDir, filename)}`);
    }
}
