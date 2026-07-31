import { createRequire } from 'node:module';

import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const moderation = require('../../scripts/issue-attachment-moderation.cjs');

describe('issue attachment moderation', () => {
  test('detects unsafe GitHub issue attachment URLs', () => {
    expect(
      moderation.findUnsafeAttachments(
        '[fix](https://github.com/user-attachments/files/29783695/eai_fix_script.zip)',
      ),
    ).toEqual([
      {
        extension: '.zip',
        url: 'https://github.com/user-attachments/files/29783695/eai_fix_script.zip',
      },
    ]);
  });

  test('ignores safe image attachments', () => {
    expect(
      moderation.findUnsafeAttachments(
        '![screenshot](https://github.com/user-attachments/files/29783695/screenshot.png)',
      ),
    ).toEqual([]);
  });

  test('deletes unsafe issue comments from unknown users', () => {
    const plan = moderation.buildModerationPlan({
      eventName: 'issue_comment',
      issue: { number: 188 },
      comment: {
        id: 4911414669,
        node_id: 'IC_kwDORh24NM8AAAABJL49jQ',
        author_association: 'NONE',
        body: '[eai_fix_script.zip](https://github.com/user-attachments/files/29783695/eai_fix_script.zip)',
      },
    });

    expect(plan).toMatchObject({
      action: 'delete-comment',
      commentId: 4911414669,
      reason: 'unsafe_issue_comment_attachment',
    });
  });

  test('does not moderate trusted maintainer comments', () => {
    const plan = moderation.buildModerationPlan({
      eventName: 'issue_comment',
      issue: { number: 188 },
      comment: {
        id: 1,
        node_id: 'node',
        author_association: 'MEMBER',
        body: '[debug.zip](https://github.com/user-attachments/files/1/debug.zip)',
      },
    });

    expect(plan).toMatchObject({
      action: 'skip',
      reason: 'trusted_author',
    });
  });

  test('warns when an issue body contains an unsafe attachment', () => {
    const plan = moderation.buildModerationPlan({
      eventName: 'issues',
      issue: {
        number: 188,
        node_id: 'issue-node',
        author_association: 'NONE',
        body: '[installer.exe](https://github.com/user-attachments/files/2/installer.exe)',
      },
    });

    expect(plan).toMatchObject({
      action: 'warn-issue',
      issueNumber: 188,
      reason: 'unsafe_issue_body_attachment',
    });
    expect(moderation.warningBody(plan)).toContain('do not open unsolicited ZIPs');
  });

  test('skips pull request comments', () => {
    const plan = moderation.buildModerationPlan({
      eventName: 'issue_comment',
      issue: { number: 10, pull_request: {} },
      comment: {
        author_association: 'NONE',
        body: '[fix.zip](https://github.com/user-attachments/files/1/fix.zip)',
      },
    });

    expect(plan).toEqual({ action: 'skip', reason: 'not_an_issue' });
  });
});
