import { afterEach, describe, expect, it } from 'vitest';
import type { BoardStateDto, InstanceSettingsAdminDto } from '@retro/shared';
import { Client, makeApp, signUp, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

describe('instance settings (Customize)', () => {
  it('starts from the launch settings in the environment', async () => {
    t = await makeApp({ env: { SITE_NAME: 'Hawkeye Retros', DEFAULT_THEME: 'forest', DEFAULT_ACCENT: '#ffcd00', DEFAULT_ANONYMOUS: 'false', DEFAULT_TEMPLATE: 'mad-sad-glad' } });
    const cfg = (await new Client(t.app).get('/api/auth/config')).body;
    expect(cfg.site.name).toBe('Hawkeye Retros');
    expect(cfg.site.theme.tokens.accent).toBe('#ffcd00');

    const { client } = await signUp(t.app, 'Admin');
    const team = (await client.post('/api/teams', { name: 'T' })).body;
    const { boardId } = (await client.post(`/api/teams/${team.id}/current`)).body;
    const s = (await client.get(`/api/boards/${boardId}`)).body as BoardStateDto;
    expect(s.columns.map(c => c.title)).toEqual(['Mad', 'Sad', 'Glad']);
    expect(s.board.settings.allowAnonymous).toBe(false);
    expect(Object.keys(s.board.settings).sort()).toEqual(['allowAnonymous', 'locked', 'theme']);
  });

  it('lets admins override, reset, and add templates for every team', async () => {
    t = await makeApp();
    const admin = await signUp(t.app, 'Admin');
    const user = await signUp(t.app, 'User');
    expect((await user.client.get('/api/admin/settings')).status).toBe(403);

    const before = (await admin.client.get('/api/admin/settings')).body as InstanceSettingsAdminDto;
    expect(before.settings.siteName).toBe('Retro Board');
    expect(before.overridden).toEqual([]);

    const tpl = (await admin.client.post('/api/admin/templates', {
      name: 'Rose / Thorn / Bud', columns: [{ title: 'Rose', color: '#ef4444' }, { title: 'Thorn', color: '#22c55e' }, { title: 'Bud', color: '#3b82f6' }],
    })).body;
    const after = (await admin.client.patch('/api/admin/settings', {
      siteName: 'Our Retros', defaultTemplateId: tpl.id, allowAnonymous: false, signup: 'closed',
    })).body as InstanceSettingsAdminDto;
    expect(after.settings).toMatchObject({ siteName: 'Our Retros', defaultTemplateId: tpl.id, allowAnonymous: false, signup: 'closed' });
    expect(after.overridden.sort()).toEqual(['allowAnonymous', 'defaultTemplateId', 'signup', 'siteName']);

    // sign-up rule applies straight away
    const stranger = new Client(t.app);
    expect((await stranger.post('/api/auth/signup', { email: 'x@y.co', name: 'X', password: 'longenough1' })).status).toBe(403);

    // teams see the instance template and new boards use it
    const team = (await user.client.post('/api/teams', { name: 'Crew' })).body;
    const tpls = (await user.client.get(`/api/teams/${team.id}/templates`)).body;
    expect(tpls.find((x: { id: string }) => x.id === tpl.id)).toMatchObject({ instance: true });
    const { boardId } = (await user.client.post(`/api/teams/${team.id}/current`)).body;
    const s = (await user.client.get(`/api/boards/${boardId}`)).body as BoardStateDto;
    expect(s.columns.map(c => c.title)).toEqual(['Rose', 'Thorn', 'Bud']);
    expect(s.board.settings.allowAnonymous).toBe(false);
    // only instance admins can delete an instance template
    expect((await user.client.del(`/api/templates/${tpl.id}`)).status).toBe(403);

    const reset = (await admin.client.patch('/api/admin/settings', { reset: ['siteName', 'signup'] })).body as InstanceSettingsAdminDto;
    expect(reset.settings.siteName).toBe('Retro Board');
    expect(reset.settings.signup).toBe('open');
    expect((await new Client(t.app).get('/api/auth/config')).body.site.name).toBe('Retro Board');
  });
});
