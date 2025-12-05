import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    sendConnectionRequestEmail,
    sendConnectionAcceptedEmail
} from '../notification.sender';
import * as emailModule from '../transport.helper';
import * as templatesModule from '../templates/connection-request.template'; // We need to mock specific templates now
import * as connectionAcceptedTemplateModule from '../templates/connection-accepted.template';

// Mock dependencies
vi.mock('../transport.helper', () => ({
    sendEmail: vi.fn()
}));

vi.mock('../templates/connection-request.template', () => ({
    connectionRequestTemplate: vi.fn(() => ({ subject: 'Request Subject', html: '<p>Request HTML</p>', text: 'Request Text' }))
}));
vi.mock('../templates/connection-accepted.template', () => ({
    connectionAcceptedTemplate: vi.fn(() => ({ subject: 'Accepted Subject', html: '<p>Accepted HTML</p>', text: 'Accepted Text' }))
}));


describe('Email Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('sendConnectionRequestEmail', () => {
        it('should call sendEmail with correct arguments', async () => {
            const to = 'test@example.com';
            const initiatorName = 'Alice';
            const receiverName = 'Bob';
            const synthesisHtml = '<p>Synthesis</p>';
            const subject = 'Connection Request';

            await sendConnectionRequestEmail(to, initiatorName, receiverName, synthesisHtml, subject);

            expect(templatesModule.connectionRequestTemplate).toHaveBeenCalledWith(initiatorName, receiverName, synthesisHtml, subject);
            expect(emailModule.sendEmail).toHaveBeenCalledWith({
                to,
                subject: 'Request Subject',
                html: '<p>Request HTML</p>',
                text: 'Request Text'
            });
        });
    });

    describe('sendConnectionAcceptedEmail', () => {
        it('should call sendEmail with correct arguments', async () => {
            const to = ['alice@example.com', 'bob@example.com'];
            const initiatorName = 'Alice';
            const accepterName = 'Bob';
            const synthesisHtml = '<p>Intro</p>';

            await sendConnectionAcceptedEmail(to, initiatorName, accepterName, synthesisHtml);

            expect(connectionAcceptedTemplateModule.connectionAcceptedTemplate).toHaveBeenCalledWith(initiatorName, accepterName, synthesisHtml);
            expect(emailModule.sendEmail).toHaveBeenCalledWith({
                to,
                subject: 'Accepted Subject',
                html: '<p>Accepted HTML</p>',
                text: 'Accepted Text'
            });
        });
    });

});

