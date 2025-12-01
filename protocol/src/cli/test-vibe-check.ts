import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../.env.development') });

import { vibeCheck, OtherUserData } from '../agents/external/vibe_checker/index';

async function main() {
    console.log('Starting vibeCheck test...');

    if (!process.env.OPENROUTER_API_KEY) {
        console.error('Error: OPENROUTER_API_KEY is missing in .env.development');
        process.exit(1);
    }

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
        console.log('Calling vibeCheck with mock data...');
        const result = await vibeCheck(mockData);

        console.log('\n--- Vibe Check Result ---');
        console.log('Success:', result.success);
        if (result.success) {
            console.log('Subject:', result.subject);
            console.log('Synthesis:', result.synthesis);
        } else {
            console.error('Error:', result.error);
        }

    } catch (error) {
        console.error('Test failed:', error);
    }
}

main();
