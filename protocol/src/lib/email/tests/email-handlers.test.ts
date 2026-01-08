import { describe, it, expect, jest, beforeEach, mock } from 'bun:test';
import { sendConnectionRequestEmail, sendConnectionAcceptedEmail } from '../notification.sender';
import * as emailModule from '../transport.helper';
import * as templatesModule from '../templates/connection-request.template'; // We need to mock specific templates now
import * as connectionAcceptedTemplateModule from '../templates/connection-accepted.template';

// Mock dependencies
mock.module('../transport.helper', () => ({
  sendEmail: jest.fn()
}));

mock.module('../templates/connection-request.template', () => ({
  connectionRequestTemplate: jest.fn(() => ({ subject: 'Request Subject', html: '<p>Request HTML</p>', text: 'Request Text' }))
}));
mock.module('../templates/connection-accepted.template', () => ({
  connectionAcceptedTemplate: jest.fn(() => ({ subject: 'Accepted Subject', html: '<p>Accepted HTML</p>', text: 'Accepted Text' }))
}));

mock.module('../../db', () => ({
  default: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        leftJoin: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([{
              id: 'test-user-id',
              onboarding: { completedAt: new Date() },
              settings: { preferences: { connectionUpdates: true }, unsubscribeToken: 'token' }
            }]))
          }))
        }))
      }))
    })),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        returning: jest.fn(() => Promise.resolve([{}]))
      }))
    }))
  }
}));


describe('Email Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendConnectionRequestEmail', () => {
    it('should call sendEmail with correct arguments', async () => {
      const to = 'test@example.com';
      const initiatorName = 'Alice';
      const receiverName = 'Bob';
      const synthesisHtml = '<p>Synthesis</p>';
      const subject = 'Connection Request';

      await sendConnectionRequestEmail(to, initiatorName, receiverName, synthesisHtml, subject);

      const unsubscribeUrl = "https://index.network.api/api/notifications/unsubscribe?token=token&type=connectionUpdates";
      expect(templatesModule.connectionRequestTemplate).toHaveBeenCalledWith(initiatorName, receiverName, synthesisHtml, subject, unsubscribeUrl);
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

      const unsubscribeUrl = "https://index.network.api/api/notifications/unsubscribe?token=token&type=connectionUpdates";
      expect(connectionAcceptedTemplateModule.connectionAcceptedTemplate).toHaveBeenCalledWith(initiatorName, accepterName, synthesisHtml, unsubscribeUrl);
      expect(emailModule.sendEmail).toHaveBeenCalledWith({
        to,
        subject: 'Accepted Subject',
        html: '<p>Accepted HTML</p>',
        text: 'Accepted Text'
      });
    });
  });

});
