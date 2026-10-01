// The Google Calendar sign-in asks for exactly the scopes declared on the OAuth consent screen:
// anything extra (like the broader calendar.readonly) shows people "Google hasn't verified this app".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authUrl } from '../src/providers/google.ts';

test('google calendar sign-in asks for events read/write and the calendar list only', () => {
  const url = new URL(authUrl({ GOOGLE_CLIENT_ID: 'fake-client.apps.googleusercontent.com' } as never, 'https://kinwall.example/api/oauth/google/callback', 'state', 'challenge'));
  assert.deepEqual(url.searchParams.get('scope')!.split(' ').sort(), [
    'email',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    'openid',
  ]);
});
