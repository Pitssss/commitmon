import * as vscode from 'vscode';
import { GitExtension, API as GitAPI, Repository } from './git';

let statusBarItem: vscode.StatusBarItem;
let commitCountToday = 0;
let lastKnownCommitHash: string | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log('CommitMon extension is now active in Antigravity!');

  // 1. Create Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'commitmon.showStatus';
  context.subscriptions.push(statusBarItem);
  updateStatusBar();
  statusBarItem.show();

  // 2. Initialize Git API
  const gitApi = await getGitAPI();
  if (gitApi) {
    setupGitWatchers(gitApi, context);
  } else {
    vscode.window.showWarningMessage('CommitMon: VS Code Git extension not detected or disabled.');
  }

  // 3. Register Commands
  const startCmd = vscode.commands.registerCommand('commitmon.start', () => {
    vscode.window.showInformationMessage('CommitMon is active and monitoring git commits.');
    updateStatusBar();
  });

  const showStatusCmd = vscode.commands.registerCommand('commitmon.showStatus', async () => {
    const token = await context.secrets.get('commitmon.ghToken');
    const ghUser = context.globalState.get<string>('commitmon.ghUser');
    const authStatus = token ? `Connected (@${ghUser || 'GitHub User'})` : 'Not Connected';

    const message = `CommitMon Status:\n- Today's commits tracked: ${commitCountToday}\n- Last commit: ${lastKnownCommitHash?.substring(0, 7) || 'None'}\n- GitHub: ${authStatus}`;

    if (token) {
      const choice = await vscode.window.showInformationMessage(message, 'Disconnect GitHub');
      if (choice === 'Disconnect GitHub') {
        await vscode.commands.executeCommand('commitmon.clearGithubToken');
      }
    } else {
      const choice = await vscode.window.showInformationMessage(message, 'Connect GitHub');
      if (choice === 'Connect GitHub') {
        await vscode.commands.executeCommand('commitmon.setGithubToken');
      }
    }
  });

  const setGithubTokenCmd = vscode.commands.registerCommand('commitmon.setGithubToken', async () => {
    await configureGitHubAuth(context);
  });

  const clearGithubTokenCmd = vscode.commands.registerCommand('commitmon.clearGithubToken', async () => {
    await disconnectGitHubAuth(context);
  });

  context.subscriptions.push(startCmd, showStatusCmd, setGithubTokenCmd, clearGithubTokenCmd);
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

    const disposable = repo.state.onDidChange(() => {
      const currentCommit = repo.state.HEAD?.commit;
      if (currentCommit && currentCommit !== lastKnownCommitHash) {
        lastKnownCommitHash = currentCommit;
        commitCountToday += 1;
        updateStatusBar();
        vscode.window.showInformationMessage(
          `CommitMon: New commit detected (${currentCommit.substring(0, 7)})!`
        );
      }
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
  statusBarItem.text = `$(git-commit) CommitMon: ${commitCountToday} today`;
  statusBarItem.tooltip = `CommitMon: ${commitCountToday} commit(s) recorded in this session. Click for details.`;
}

/**
 * Step 6: GitHub Authentication with PAT Fallback & Token Validation
 */
async function configureGitHubAuth(context: vscode.ExtensionContext): Promise<string | undefined> {
  // 1. Try standard VS Code / Antigravity GitHub auth session
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

  // 2. Fallback: Prompt user for Personal Access Token (PAT)
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

  // 3. Verify token with GitHub API
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

