import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import { SearchResult, GeneratorOptions } from '../../../types/index.js';

export class GeneratorService {
    constructor() {
        // Register handlebars helpers
        Handlebars.registerHelper('add', (a, b) => a + b);
        Handlebars.registerHelper('eq', (a, b) => a === b);
    }

    async generate(result: SearchResult, options: GeneratorOptions) {
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

    private async generateMarkdown(result: SearchResult, options: GeneratorOptions) {
        const domain = (result.metadata as any).domain || new URL(result.url).hostname.replace(/\./g, '-');
        const targetDir = path.join(options.outputDir, 'markdown', domain);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const templatePath = path.join(process.cwd(), 'templates/tc-markdown.hbs');
        const templateSource = fs.readFileSync(templatePath, 'utf-8');
        const template = Handlebars.compile(templateSource);

        const output = template(result);
        const urlPath = new URL(result.url).pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'index';
        const date = new Date().toISOString().split('T')[0];
        fs.writeFileSync(path.join(targetDir, `test-cases-${urlPath}-${date}.md`), output);
        console.log(`[Generator] Created markdown report in ${targetDir}`);
    }

    private async generatePlaywright(result: SearchResult, options: GeneratorOptions) {
        const domain = (result.metadata as any).domain || new URL(result.url).hostname.replace(/\./g, '-');
        const targetDir = path.join(options.outputDir, 'playwright', domain);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const templatePath = path.join(process.cwd(), 'templates/playwright.hbs');
        const templateSource = fs.readFileSync(templatePath, 'utf-8');
        const template = Handlebars.compile(templateSource);

        const output = template(result);
        const urlPath = new URL(result.url).pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'index';
        fs.writeFileSync(path.join(targetDir, `${domain}-${urlPath}.spec.ts`), output);
        console.log(`[Generator] Created playwright spec in ${targetDir}`);
    }

    private async generateJson(result: SearchResult, options: GeneratorOptions) {
        const domain = (result.metadata as any).domain || new URL(result.url).hostname.replace(/\./g, '-');
        const targetDir = path.join(options.outputDir, 'json', domain);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const urlPath = new URL(result.url).pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'index';
        fs.writeFileSync(path.join(targetDir, `${domain}-${urlPath}.json`), JSON.stringify(result, null, 2));
        console.log(`[Generator] Created JSON metadata in ${targetDir}`);
    }
}
