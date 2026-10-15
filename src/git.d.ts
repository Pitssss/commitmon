import { Uri, Event, Disposable } from 'vscode';

export interface GitExtension {
  readonly enabled: boolean;
  onDidChangeEnablement: Event<boolean>;
  getAPI(version: 1): API;
}

export interface API {
  readonly state: 'uninitialized' | 'initialized';
  readonly onDidChangeState: Event<'uninitialized' | 'initialized'>;
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
  getRepository(uri: Uri): Repository | null;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
  readonly ui: RepositoryUI;
  commit(message: string, opts?: any): Promise<void>;
  log(options?: any): Promise<Commit[]>;
}

export interface RepositoryUI {
  readonly selected: boolean;
  readonly onDidChange: Event<void>;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly refs: Ref[];
  readonly remotes: Remote[];
  readonly submodules: Submodule[];
  readonly rebaseCommit: Commit | undefined;
  readonly mergeChanges: Change[];
  readonly indexChanges: Change[];
  readonly workingTreeChanges: Change[];
  readonly onDidChange: Event<void>;
}

export interface Branch {
  readonly name?: string;
  readonly commit?: string;
  readonly type: number;
  readonly upstream?: { name: string; remote: string };
  readonly ahead?: number;
  readonly behind?: number;
}

export interface Ref {
  readonly name?: string;
  readonly commit?: string;
  readonly type: number;
}

export interface Remote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
  readonly isReadOnly: boolean;
}

export interface Submodule {
  readonly name: string;
  readonly path: string;
  readonly url: string;
}

export interface Change {
  readonly uri: Uri;
  readonly originalUri: Uri;
  readonly status: number;
}

export interface Commit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
  readonly authorDate?: Date;
  readonly commitDate?: Date;
  readonly authorName?: string;
  readonly authorEmail?: string;
}
