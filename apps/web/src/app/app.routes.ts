import type { Routes } from '@angular/router';
import { instanceAdmin, signedIn, signedOut } from './core/guards';

export const routes: Routes = [
  { path: 'login', canActivate: [signedOut], title: 'Sign in · Retro Board', loadComponent: () => import('./pages/login.page').then(m => m.LoginPage) },
  // a private board's link: signing in (or a guest name) first, then straight to the board
  // no sign-in: becoming the site admin with a setup code from the server
  { path: 'claim-admin', canActivate: [signedIn], title: 'Claim Admin · Retro Board', loadComponent: () => import('./pages/claim-admin.page').then(m => m.ClaimAdminPage) },
  { path: 'b/:token', canActivate: [signedIn], title: 'Private board · Retro Board', loadComponent: () => import('./pages/private-link.page').then(m => m.PrivateLinkPage) },
  { path: 'invite/:token', title: 'Join a team · Retro Board', loadComponent: () => import('./pages/invite.page').then(m => m.InvitePage) },
  { path: '', canActivate: [signedIn], title: 'Teams · Retro Board', loadComponent: () => import('./pages/teams.page').then(m => m.TeamsPage) },
  { path: 'teams/:teamId', canActivate: [signedIn], title: 'Retro Board', loadComponent: () => import('./pages/current-board.page').then(m => m.CurrentBoardPage) },
  { path: 'teams/:teamId/history', canActivate: [signedIn], title: 'History · Retro Board', loadComponent: () => import('./pages/team.page').then(m => m.TeamPage) },
  { path: 'boards/:boardId', canActivate: [signedIn], title: 'Board · Retro Board', loadComponent: () => import('./board/board.page').then(m => m.BoardPage) },
  { path: 'settings', canActivate: [signedIn], title: 'Settings · Retro Board', loadComponent: () => import('./pages/settings.page').then(m => m.SettingsPage) },
  { path: 'admin', canActivate: [signedIn, instanceAdmin], title: 'Admin · Retro Board', loadComponent: () => import('./pages/admin.page').then(m => m.AdminPage) },
  { path: '**', redirectTo: '' },
];
