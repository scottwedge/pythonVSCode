// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { Disposable, Event, EventEmitter, Uri, WebviewCustomEditorEditingDelegate, WebviewCustomEditorProvider, WebviewPanel } from 'vscode';

import { ICommandManager, ICustomEditorService, IWorkspaceService } from '../../common/application/types';
import { IFileSystem } from '../../common/platform/types';
import { IAsyncDisposable, IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry } from '../../common/types';
import { createDeferred } from '../../common/utils/async';
import { IServiceContainer } from '../../ioc/types';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Commands, Identifiers, Settings, Telemetry } from '../constants';
import { ILoadableNotebookStorage, INotebookEdit, INotebookEditor, INotebookEditorProvider, INotebookServerOptions } from '../types';

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
        @inject(IFileSystem) private fileSystem: IFileSystem,
        @inject(ICommandManager) private cmdManager: ICommandManager,
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
        return this.cmdManager.executeCommand(Commands.NotebookStorage_Save, resource, undefined);
    }
    public saveAs(resource: Uri, targetResource: Uri): Thenable<void> {
        return this.cmdManager.executeCommand(Commands.NotebookStorage_SaveAs, resource, targetResource, undefined);
    }
    public get onEdit(): Event<{ readonly resource: Uri; readonly edit: INotebookEdit }> {
        return this._editEventEmitter.event;
    }
    public applyEdits(_resource: Uri, _edits: readonly INotebookEdit[]): Thenable<void> {
        throw new Error('Method not implemented.');
    }
    public undoEdits(_resource: Uri, _edits: readonly INotebookEdit[]): Thenable<void> {
        throw new Error('Method not implemented.');
    }
    public resolveWebviewEditor(resource: Uri, webview: WebviewPanel): Thenable<void> {
        // Get the storage
        return this.getStorage(resource).then(s => {
            // Create a new editor
            const editor = this.serviceContainer.get<INotebookEditor>(INotebookEditor);

            // Indicate opened
            this.openedEditor(editor);

            // Load it (should already be visible)
            return editor.load(s, webview);
        });
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
        // Create a temporary file on disk to hold the contents
        const tempFile = await this.fileSystem.createTemporaryFile('ipynb');
        if (contents) {
            await this.fileSystem.writeFile(tempFile.filePath, contents, 'utf-8');
        }

        // Use an 'untitled' URI
        return this.open(Uri.parse(`untitled://${tempFile.filePath}`));
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

    private async storageChanged(file: Uri): Promise<void> {
        // When the storage changes, tell VS code about the edit
        const storage = await this.getStorage(file);
        const cells = await storage.getCells();
        this._editEventEmitter.fire({ resource: file, edit: { contents: cells } });
    }

    private getStorage(file: Uri): Promise<ILoadableNotebookStorage> {
        let storagePromise = this.storage.get(file.fsPath);
        if (!storagePromise) {
            const storage = this.serviceContainer.get<ILoadableNotebookStorage>(ILoadableNotebookStorage);
            storagePromise = storage.load(file).then(_v => {
                this.storageChangedHandlers.set(file.fsPath, storage.changed(this.storageChanged.bind(this, file)));
                return storage;
            });

            this.storage.set(file.fsPath, storagePromise);
        }
        return storagePromise;
    }
}
