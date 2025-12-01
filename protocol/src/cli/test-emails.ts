import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFile } from 'fs/promises';

config({ path: resolve(__dirname, '../../.env.development') });

import { connectionRequestTemplate } from '../lib/email/templates/connection-request';
import { connectionAcceptedTemplate } from '../lib/email/templates/connection-accepted';
import { weeklyNewsletterTemplate } from '../lib/email/templates/weekly-newsletter';
import { sendEmail } from '../lib/email/email';

import { vibeCheck, OtherUserData } from '../agents/external/vibe_checker/index';

async function logEmailToFile(title: string, to: string | string[], subject: string, html: string, text: string) {
    const separator = '='.repeat(80);
    const content = `
${separator}
${title}
${separator}
To: ${Array.isArray(to) ? to.join(', ') : to}
Subject: ${subject}

--- TEXT CONTENT ---
${text}

--- HTML CONTENT ---
${html}

`;
    await writeFile('email-debug.md', content, { flag: 'a' });
}

async function main() {
    console.log('Starting email test script (Mock Mode with Real AI)...');

    // Clear previous debug file
    await writeFile('email-debug.md', '# Email Test Debug Output\n');

    const user1 = { name: 'Alice', email: 'alice@example.com' };
    const user2 = { name: 'Bob', email: 'bob@example.com' };

    // Mock Data for Vibe Check
    const mockData: OtherUserData = {
        id: 'user-123',
        name: 'Alice',
        intro: 'Building scalable coordination tools for DAOs.',
        intentPairs: [
            {
                stake: 10,
                contextUserIntent: {
                    id: 'intent-1',
                    payload: 'I am looking for scalable coordination tools',
                    createdAt: new Date()
                },
                targetUserIntent: {
                    id: 'intent-2',
                    payload: 'I am building scalable coordination tools',
                    createdAt: new Date()
                }
            }
        ],
        initiatorName: 'Bob'
    };

    try {
        // Generate Synthesis using Real AI
        console.log('Generating synthesis via vibeCheck...');
        const vibeResult = await vibeCheck(mockData);

        if (!vibeResult.success) {
            throw new Error(`Vibe check failed: ${vibeResult.error}`);
        }

        const synthesis = vibeResult.synthesis || "Fallback synthesis";
        const subject = vibeResult.subject || "Fallback subject";

        console.log(`Generated Subject: ${subject}`);

        // Test 1: Connection Request
        console.log('\n--- Testing Connection Request Email ---');
        const reqTemplate = connectionRequestTemplate(user1.name, user2.name, synthesis, subject);
        await logEmailToFile('Connection Request', user2.email, reqTemplate.subject, reqTemplate.html, reqTemplate.text);

        await sendEmail({
            to: user2.email,
            subject: reqTemplate.subject,
            html: reqTemplate.html,
            text: reqTemplate.text
        });
        console.log('✅ Connection Request Email Processed');

        // Test 2: Connection Accepted
        console.log('\n--- Testing Connection Accepted Email ---');
        const accTemplate = connectionAcceptedTemplate(user1.name, user2.name, synthesis);
        await logEmailToFile('Connection Accepted', [user1.email, user2.email], accTemplate.subject, accTemplate.html, accTemplate.text);

        await sendEmail({
            to: [user1.email, user2.email],
            subject: accTemplate.subject,
            html: accTemplate.html,
            text: accTemplate.text
        });
        console.log('✅ Connection Accepted Email Processed');

        // Test 3: Weekly Newsletter
        console.log('\n--- Testing Weekly Newsletter Email ---');
        const mockMatches = [
            {
                name: user1.name,
                role: 'Software Engineer',
                reasoning: 'Matches your interest in decentralized protocols.'
            },
            {
                name: 'Charlie',
                role: 'Product Designer',
                reasoning: 'Working on similar UI patterns for agentic workflows.'
            }
        ];

        const newsTemplate = weeklyNewsletterTemplate(user2.name, mockMatches);
        await logEmailToFile('Weekly Newsletter', user2.email, newsTemplate.subject, newsTemplate.html, newsTemplate.text);

        await sendEmail({
            to: user2.email,
            subject: newsTemplate.subject,
            html: newsTemplate.html,
            text: newsTemplate.text
        });
        console.log('✅ Weekly Newsletter Email Processed');

        console.log('\n🎉 Debug output written to protocol/email-debug.md');

    } catch (error) {
        console.error('Test failed:', error);
    }

    process.exit(0);
}

main();
