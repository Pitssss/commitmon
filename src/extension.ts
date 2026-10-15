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
    const authStatus = token ? 'Personal Access Token Configured' : 'No GitHub Token Stored';
    vscode.window.showInformationMessage(
      `CommitMon Status:\n- Today's commits tracked: ${commitCountToday}\n- Last commit: ${lastKnownCommitHash?.substring(0, 7) || 'None'}\n- Auth: ${authStatus}`
    );
  });

  const setGithubTokenCmd = vscode.commands.registerCommand('commitmon.setGithubToken', async () => {
    await configureGitHubAuth(context);
  });

  context.subscriptions.push(startCmd, showStatusCmd, setGithubTokenCmd);
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
  const watchRepo = (repo: Repository) => {
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

  git.repositories.forEach(watchRepo);
  git.onDidOpenRepository((repo) => watchRepo(repo), null, context.subscriptions);
}

function updateStatusBar() {
  statusBarItem.text = `$(git-commit) CommitMon: ${commitCountToday} today`;
  statusBarItem.tooltip = `CommitMon: ${commitCountToday} commit(s) recorded in this session. Click for details.`;
}

/**
 * Step 6: GitHub Authentication with PAT Fallback
 */
async function configureGitHubAuth(context: vscode.ExtensionContext): Promise<string | undefined> {
  try {
    // Attempt standard VS Code / Antigravity GitHub auth session
    const session = await vscode.authentication.getSession('github', ['read:user', 'repo'], {
      createIfNone: false
    });

    if (session?.accessToken) {
      vscode.window.showInformationMessage(`CommitMon: Authenticated as GitHub user ${session.account.label}`);
      return session.accessToken;
    }
  } catch (err) {
    console.warn('Standard GitHub authentication provider unavailable or failed, falling back to PAT:', err);
  }

  // Fallback: Prompt user for Personal Access Token (PAT)
  const token = await vscode.window.showInputBox({
    title: 'CommitMon GitHub Authentication Fallback',
    prompt: 'Enter a fine-grained GitHub Personal Access Token (PAT) with read-only permissions',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'Paste your personal access token here'
  });

  if (token) {
    await context.secrets.store('commitmon.ghToken', token);
    vscode.window.showInformationMessage('CommitMon: GitHub token saved securely to SecretStorage!');
    return token;
  }

  return undefined;
}
