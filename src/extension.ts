import * as vscode from 'vscode';
import { GitExtension, API as GitAPI, Repository } from './git';
import { CompanionViewProvider } from './companionProvider';

let statusBarItem: vscode.StatusBarItem;
let companionProvider: CompanionViewProvider;
let lastKnownCommitHash: string | undefined;
let lastKnownAheadCount: number | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log('CommitMon (Catch \'Em All) extension is now active in Antigravity!');

  // 1. Initialize Companion Webview Provider (Sidebar & Bottom Panel)
  companionProvider = new CompanionViewProvider(context.extensionUri, context);
  context.subscriptions.push(
    companionProvider.onDidChangeState(() => updateStatusBar()),
    vscode.window.registerWebviewViewProvider(CompanionViewProvider.viewType, companionProvider),
    vscode.window.registerWebviewViewProvider(CompanionViewProvider.explorerViewType, companionProvider),
    vscode.window.registerWebviewViewProvider(CompanionViewProvider.panelViewType, companionProvider)
  );

  // 2. Create Status Bar Item (clean companion summary)
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'commitmon.openBottomPanel';
  context.subscriptions.push(statusBarItem);
  updateStatusBar();
  statusBarItem.show();

  // 3. Initialize Git API
  const gitApi = await getGitAPI();
  if (gitApi) {
    setupGitWatchers(gitApi, context);
  } else {
    vscode.window.showWarningMessage('CommitMon: VS Code Git extension not detected or disabled.');
  }

  // 4. Register Extension Commands
  const openViewCmd = vscode.commands.registerCommand('commitmon.openView', () => {
    vscode.commands.executeCommand('commitmon.companionView.focus');
  });

  const openBottomPanelCmd = vscode.commands.registerCommand('commitmon.openBottomPanel', () => {
    vscode.commands.executeCommand('commitmon.bottomPanel.focus');
  });

  const startCmd = vscode.commands.registerCommand('commitmon.start', () => {
    vscode.window.showInformationMessage('CommitMon: Active & tracking your Pokémon companion commits!');
    companionProvider.syncState();
    updateStatusBar();
  });

  const showStatusCmd = vscode.commands.registerCommand('commitmon.showStatus', async () => {
    const state = companionProvider.getState();
    const token = await context.secrets.get('commitmon.ghToken');
    const ghUser = context.globalState.get<string>('commitmon.ghUser');
    const authStatus = token ? `Connected (@${ghUser || 'GitHub User'})` : 'Not Connected';

    const message = `CommitMon Companion:\n- Companion: ${state.activePokemonName} (Lv. ${state.level})\n- Total Commits: ${state.totalCommits}\n- Caught in Pokédex: ${state.unlockedIds.length} Pokémon\n- GitHub: ${authStatus}`;

    if (token) {
      const choice = await vscode.window.showInformationMessage(message, 'Disconnect GitHub', 'Open Companion');
      if (choice === 'Disconnect GitHub') {
        await vscode.commands.executeCommand('commitmon.clearGithubToken');
      } else if (choice === 'Open Companion') {
        vscode.commands.executeCommand('commitmon.openView');
      }
    } else {
      const choice = await vscode.window.showInformationMessage(message, 'Connect GitHub', 'Open Companion');
      if (choice === 'Connect GitHub') {
        await vscode.commands.executeCommand('commitmon.setGithubToken');
      } else if (choice === 'Open Companion') {
        vscode.commands.executeCommand('commitmon.openView');
      }
    }
  });

  const setGithubTokenCmd = vscode.commands.registerCommand('commitmon.setGithubToken', async () => {
    await configureGitHubAuth(context);
  });

  const clearGithubTokenCmd = vscode.commands.registerCommand('commitmon.clearGithubToken', async () => {
    await disconnectGitHubAuth(context);
  });

  const testCommitCmd = vscode.commands.registerCommand('commitmon.testCommit', async () => {
    await companionProvider.onCommitDetected('sim-' + Math.random().toString(36).substring(2, 7));
    updateStatusBar();
  });

  const testPushCmd = vscode.commands.registerCommand('commitmon.testPush', async () => {
    await companionProvider.onPushDetected();
    updateStatusBar();
  });

  const feedBerryCmd = vscode.commands.registerCommand('commitmon.feedBerry', async () => {
    await companionProvider.feedBerry();
    updateStatusBar();
  });

  const resetProgressCmd = vscode.commands.registerCommand('commitmon.resetProgress', async () => {
    await companionProvider.resetProgress();
    updateStatusBar();
  });

  const openArenaCmd = vscode.commands.registerCommand('commitmon.openAntiGravityArena', () => {
    companionProvider.openArena();
  });

  const toggleAntiGravityCmd = vscode.commands.registerCommand('commitmon.toggleAntiGravity', async () => {
    await companionProvider.toggleAntiGravity();
    updateStatusBar();
  });

  context.subscriptions.push(
    openViewCmd,
    openBottomPanelCmd,
    openArenaCmd,
    toggleAntiGravityCmd,
    startCmd,
    showStatusCmd,
    setGithubTokenCmd,
    clearGithubTokenCmd,
    testCommitCmd,
    testPushCmd,
    feedBerryCmd,
    resetProgressCmd
  );
}

export function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}

async function getGitAPI(): Promise<GitAPI | undefined> {
  try {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
      return undefined;
    }
    const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
    return git.getAPI(1);
  } catch (err) {
    console.error('Failed to get Git extension API:', err);
    return undefined;
  }
}

function setupGitWatchers(git: GitAPI, context: vscode.ExtensionContext) {
  const watchedRepos = new Set<string>();

  const watchRepo = (repo: Repository) => {
    const repoUri = repo.rootUri.toString();
    if (watchedRepos.has(repoUri)) {
      return;
    }
    watchedRepos.add(repoUri);

    if (repo.state.HEAD?.commit) {
      lastKnownCommitHash = repo.state.HEAD.commit;
    }
    if (typeof repo.state.HEAD?.ahead === 'number') {
      lastKnownAheadCount = repo.state.HEAD.ahead;
    }

    const disposable = repo.state.onDidChange(async () => {
      const currentCommit = repo.state.HEAD?.commit;
      const currentAhead = repo.state.HEAD?.ahead ?? 0;

      // 1. Detect New Git Commit
      if (currentCommit && currentCommit !== lastKnownCommitHash) {
        lastKnownCommitHash = currentCommit;
        await companionProvider.onCommitDetected(currentCommit);
        updateStatusBar();
      }

      // 2. Detect Git Push to Remote (ahead drops from >0 to 0)
      if (lastKnownAheadCount !== undefined && lastKnownAheadCount > 0 && currentAhead === 0) {
        await companionProvider.onPushDetected();
        updateStatusBar();
      }

      lastKnownAheadCount = currentAhead;
    });

    context.subscriptions.push(disposable);
  };

  if (git.state === 'initialized') {
    git.repositories.forEach(watchRepo);
  } else {
    git.onDidChangeState((state) => {
      if (state === 'initialized') {
        git.repositories.forEach(watchRepo);
      }
    }, null, context.subscriptions);
  }

  git.onDidOpenRepository((repo) => watchRepo(repo), null, context.subscriptions);
}

function updateStatusBar() {
  if (!statusBarItem || !companionProvider) return;
  const state = companionProvider.getState();
  const name = state.activePokemonName;
  const levelText = state.isEggHatched ? `Lv.${state.level}` : 'Egg';
  const modeIcon = state.antiGravity ? '$(rocket)' : (state.flyMode ? '$(zap)' : '$(heart)');
  statusBarItem.text = `${modeIcon} ${name} (${levelText}) | $(git-commit) ${state.totalCommits}`;
  statusBarItem.tooltip = `CommitMon: ${name} (${levelText})\nTotal Commits: ${state.totalCommits}\nAnti-Gravity: ${state.antiGravity ? 'ON (Sideways/Zero-G)' : 'OFF'}\nClick to open companion sidebar.`;
}

/**
 * GitHub Authentication with PAT Fallback & Token Validation
 */
async function configureGitHubAuth(context: vscode.ExtensionContext): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession('github', ['read:user'], {
      createIfNone: true
    });

    if (session?.accessToken) {
      const username = session.account.label || 'GitHub User';
      await context.secrets.store('commitmon.ghToken', session.accessToken);
      await context.globalState.update('commitmon.ghUser', username);
      vscode.window.showInformationMessage(`CommitMon: Successfully authenticated as @${username}!`);
      return session.accessToken;
    }
  } catch (err) {
    console.warn('Standard GitHub OAuth provider unavailable in this environment, using PAT fallback:', err);
  }

  const token = await vscode.window.showInputBox({
    title: 'CommitMon: GitHub Authentication',
    prompt: 'Paste a GitHub Personal Access Token (fine-grained or classic with read:user scope)',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'ghp_xxxxxxxxxxxxxxxxxxxx'
  });

  if (!token || !token.trim()) {
    return undefined;
  }

  const cleanToken = token.trim();
  vscode.window.showInformationMessage('CommitMon: Verifying token with GitHub...');
  const username = await fetchGitHubUsername(cleanToken);

  if (username) {
    await context.secrets.store('commitmon.ghToken', cleanToken);
    await context.globalState.update('commitmon.ghUser', username);
    vscode.window.showInformationMessage(`CommitMon: Connected to GitHub as @${username}!`);
    return cleanToken;
  } else {
    vscode.window.showErrorMessage('CommitMon: Could not verify GitHub token. Check permissions or network.');
    return undefined;
  }
}

async function disconnectGitHubAuth(context: vscode.ExtensionContext) {
  await context.secrets.delete('commitmon.ghToken');
  await context.globalState.update('commitmon.ghUser', undefined);
  vscode.window.showInformationMessage('CommitMon: Disconnected from GitHub.');
}

async function fetchGitHubUsername(token: string): Promise<string | undefined> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'CommitMon-VSCode-Extension',
        Accept: 'application/vnd.github.v3+json'
      }
    });

    if (response.ok) {
      const data = (await response.json()) as { login?: string };
      return data.login;
    }
  } catch (err) {
    console.error('Failed to query GitHub API:', err);
  }
  return undefined;
}
