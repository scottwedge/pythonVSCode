// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { Disposable, Event, EventEmitter, Uri, WebviewCustomEditorEditingDelegate, WebviewCustomEditorProvider, WebviewPanel } from 'vscode';

import { ICustomEditorService, IWorkspaceService } from '../../common/application/types';
import { IAsyncDisposable, IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry } from '../../common/types';
import { createDeferred } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { IServiceContainer } from '../../ioc/types';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Identifiers, Settings, Telemetry } from '../constants';
import { ILoadableNotebookStorage, INotebookEdit, INotebookEditor, INotebookEditorProvider, INotebookServerOptions, INotebookStorageChange } from '../types';

@injectable()
export class NativeEditorProvider implements INotebookEditorProvider, WebviewCustomEditorProvider, WebviewCustomEditorEditingDelegate<INotebookEdit>, IAsyncDisposable {
    public static readonly customEditorViewType = 'NativeEditorProvider.ipynb';
    public get onDidChangeActiveNotebookEditor(): Event<INotebookEditor | undefined> {
        return this._onDidChangeActiveNotebookEditor.event;
    }
    private readonly _onDidChangeActiveNotebookEditor = new EventEmitter<INotebookEditor | undefined>();
    private readonly _editEventEmitter = new EventEmitter<{ readonly resource: Uri; readonly edit: INotebookEdit }>();
    private openedEditors: Set<INotebookEditor> = new Set<INotebookEditor>();
    private storage: Map<string, Promise<ILoadableNotebookStorage>> = new Map<string, Promise<ILoadableNotebookStorage>>();
    private storageChangedHandlers: Map<string, Disposable> = new Map<string, Disposable>();
    private _onDidOpenNotebookEditor = new EventEmitter<INotebookEditor>();
    private executedEditors: Set<string> = new Set<string>();
    private notebookCount: number = 0;
    private openedNotebookCount: number = 0;
    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(IWorkspaceService) workspace: IWorkspaceService,
        @inject(IConfigurationService) private configuration: IConfigurationService,
        @inject(ICustomEditorService) private customEditorService: ICustomEditorService
    ) {
        asyncRegistry.push(this);

        // Look through the file system for ipynb files to see how many we have in the workspace. Don't wait
        // on this though.
        const findFilesPromise = workspace.findFiles('**/*.ipynb');
        if (findFilesPromise && findFilesPromise.then) {
            findFilesPromise.then(r => (this.notebookCount += r.length));
        }

        // Register for the custom editor service.
        customEditorService.registerWebviewCustomEditorProvider(NativeEditorProvider.customEditorViewType, this, { enableFindWidget: true, retainContextWhenHidden: true });
    }

    public save(resource: Uri): Thenable<void> {
        return this.getStorage(resource).then(async s => {
            if (s) {
                await s.save();
            }
        });
    }
    public saveAs(resource: Uri, targetResource: Uri): Thenable<void> {
        return this.getStorage(resource).then(async s => {
            if (s) {
                await s.saveAs(targetResource);
            }
        });
    }
    public get onEdit(): Event<{ readonly resource: Uri; readonly edit: INotebookEdit }> {
        return this._editEventEmitter.event;
    }
    public applyEdits(_resource: Uri, _edits: readonly INotebookEdit[]): Thenable<void> {
        return Promise.resolve();
    }
    public undoEdits(_resource: Uri, _edits: readonly INotebookEdit[]): Thenable<void> {
        return Promise.resolve();
    }
    public async resolveWebviewEditor(resource: Uri, panel: WebviewPanel) {
        // Get the storage
        const storage = await this.getStorage(resource);

        // Create a new editor
        const editor = this.serviceContainer.get<INotebookEditor>(INotebookEditor);

        // Indicate opened
        this.openedEditor(editor);

        // Load it (should already be visible)
        return editor.load(storage, panel);
    }
    public get editingDelegate(): WebviewCustomEditorEditingDelegate<unknown> | undefined {
        return this;
    }

    public get onDidOpenNotebookEditor(): Event<INotebookEditor> {
        return this._onDidOpenNotebookEditor.event;
    }

    public async dispose(): Promise<void> {
        // Send a bunch of telemetry
        if (this.openedNotebookCount) {
            sendTelemetryEvent(Telemetry.NotebookOpenCount, undefined, { count: this.openedNotebookCount });
        }
        if (this.executedEditors.size) {
            sendTelemetryEvent(Telemetry.NotebookRunCount, undefined, { count: this.executedEditors.size });
        }
        if (this.notebookCount) {
            sendTelemetryEvent(Telemetry.NotebookWorkspaceCount, undefined, { count: this.notebookCount });
        }
    }
    public get activeEditor(): INotebookEditor | undefined {
        return this.editors.find(e => e.visible && e.active);
    }

    public get editors(): INotebookEditor[] {
        return [...this.openedEditors];
    }

    public async open(file: Uri): Promise<INotebookEditor> {
        // Create a deferred promise that will fire when the notebook
        // actually opens
        const deferred = createDeferred<INotebookEditor>();

        // Sign up for open event once it does open
        let disposable: Disposable | undefined;
        const handler = (e: INotebookEditor) => {
            if (e.file === file) {
                if (disposable) {
                    disposable.dispose();
                }
                deferred.resolve(e);
            }
        };
        disposable = this.onDidOpenNotebookEditor(handler);

        // Send an open command.
        this.customEditorService.openEditor(file);

        // Promise should resolve when the file opens.
        return deferred.promise;
    }

    public async show(file: Uri): Promise<INotebookEditor | undefined> {
        return this.open(file);
    }

    @captureTelemetry(Telemetry.CreateNewNotebook, undefined, false)
    public async createNew(contents?: string): Promise<INotebookEditor> {
        // Create a new URI for the dummy file using our root workspace path
        const uri = await this.getNextNewNotebookUri();

        // Update number of notebooks in the workspace
        this.notebookCount += 1;

        // Set these contents into the storage before the file opens
        await this.getStorage(uri, contents);

        return this.open(uri);
    }

    public async getNotebookOptions(): Promise<INotebookServerOptions> {
        const settings = this.configuration.getSettings();
        let serverURI: string | undefined = settings.datascience.jupyterServerURI;
        const useDefaultConfig: boolean | undefined = settings.datascience.useDefaultConfigForJupyter;

        // For the local case pass in our URI as undefined, that way connect doesn't have to check the setting
        if (serverURI.toLowerCase() === Settings.JupyterServerLocalLaunch) {
            serverURI = undefined;
        }

        return {
            enableDebugging: true,
            uri: serverURI,
            useDefaultConfig,
            purpose: Identifiers.HistoryPurpose // Share the same one as the interactive window. Just need a new session
        };
    }

    private closedEditor(editor: INotebookEditor): void {
        this.openedEditors.delete(editor);
    }

    private openedEditor(editor: INotebookEditor): void {
        this.openedNotebookCount += 1;
        if (!this.executedEditors.has(editor.file.fsPath)) {
            editor.executed(this.onExecuted.bind(this));
        }
        this.disposables.push(editor.onDidChangeViewState(this.onChangedViewState, this));
        this.openedEditors.add(editor);
        editor.closed.bind(this.closedEditor.bind(this));
        this._onDidOpenNotebookEditor.fire(editor);
    }

    private onChangedViewState(): void {
        this._onDidChangeActiveNotebookEditor.fire(this.activeEditor);
    }

    private onExecuted(editor: INotebookEditor): void {
        if (editor) {
            this.executedEditors.add(editor.file.fsPath);
        }
    }

    private async storageChanged(file: Uri, change: INotebookStorageChange): Promise<void> {
        // If the file changes, update our storage
        if (change.oldFile && change.newFile) {
            this.storage.delete(change.oldFile.toString());
            this.storage.set(change.newFile.toString(), Promise.resolve(change.storage as ILoadableNotebookStorage));
        }
        // If the cells change, tell VS code about it
        if (change.newCells && change.isDirty) {
            this._editEventEmitter.fire({ resource: file, edit: { contents: change.newCells } });
        }
    }

    private getStorage(file: Uri, contents?: string): Promise<ILoadableNotebookStorage> {
        const key = file.toString();
        let storagePromise = this.storage.get(key);
        if (!storagePromise) {
            const storage = this.serviceContainer.get<ILoadableNotebookStorage>(ILoadableNotebookStorage);
            if (!this.storageChangedHandlers.has(key)) {
                this.storageChangedHandlers.set(key, storage.changed(this.storageChanged.bind(this, file)));
            }
            storagePromise = storage.load(file, contents).then(_v => {
                return storage;
            });

            this.storage.set(key, storagePromise);
        }
        return storagePromise;
    }

    private async getNextNewNotebookUri(): Promise<Uri> {
        // See if we have any untitled storage already
        const untitledStorage = [...this.storage.keys()].filter(k => Uri.parse(k).scheme === 'untitled');

        // Just use the length (don't bother trying to fill in holes). We never remove storage objects from
        // our map, so we'll keep creating new untitled notebooks.
        const fileName = `${localize.DataScience.untitledNotebookFileName()}-${untitledStorage.length + 1}.ipynb`;
        const fileUri = Uri.file(fileName);

        // Turn this back into an untitled
        return fileUri.with({ scheme: 'untitled', path: fileName });
    }
}
