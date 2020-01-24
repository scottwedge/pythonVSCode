// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { Event, EventEmitter, TextDocument, TextEditor, Uri, WebviewCustomEditorEditingDelegate, WebviewCustomEditorProvider, WebviewPanel } from 'vscode';

import { ICommandManager, ICustomEditorService, IDocumentManager, IWorkspaceService } from '../../common/application/types';
import { JUPYTER_LANGUAGE } from '../../common/constants';
import { IFileSystem } from '../../common/platform/types';
import { IAsyncDisposable, IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { IServiceContainer } from '../../ioc/types';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Identifiers, Settings, Telemetry } from '../constants';
import { IDataScienceErrorHandler, INotebookEditor, INotebookEditorProvider, INotebookServerOptions } from '../types';

export class CustomNativeEditorProvider implements INotebookEditorProvider, WebviewCustomEditorProvider, WebviewCustomEditorEditingDelegate<INotebookEdit> {
    public static readonly customEditorViewType = 'NativeEditorProvider.ipynb';
    private readonly _onDidChangeActiveNotebookEditor = new EventEmitter<INotebookEditor | undefined>();
    private readonly _editEventEmitter = new EventEmitter<{ readonly resource: Uri; readonly edit: INotebookEdit }>();
    private activeEditors: Map<string, Set<INotebookEditor>> = new Map<string, Set<INotebookEditor>>();
    private _onDidOpenNotebookEditor = new EventEmitter<INotebookEditor>();
    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(IWorkspaceService) private workspace: IWorkspaceService,
        @inject(IConfigurationService) private configuration: IConfigurationService,
        @inject(IFileSystem) private fileSystem: IFileSystem,
        @inject(IDocumentManager) private documentManager: IDocumentManager,
        @inject(ICommandManager) private readonly cmdManager: ICommandManager,
        @inject(IDataScienceErrorHandler) private dataScienceErrorHandler: IDataScienceErrorHandler,
        @inject(ICustomEditorService) private customEditorService: ICustomEditorService
    ) {
        if (this.customEditorService.supportsCustomEditors) {
            this.customEditorService.registerWebviewCustomEditorProvider(CustomNativeEditorProvider.customEditorViewType, this, {
                enableFindWidget: true,
                retainContextWhenHidden: true
            });
        }
    }
    public save(resource: Uri): Thenable<void> {
        throw new Error('Method not implemented.');
    }
    public saveAs(resource: Uri, targetResource: Uri): Thenable<void> {
        throw new Error('Method not implemented.');
    }
    public get onEdit(): Event<{ readonly resource: Uri; readonly edit: INotebookEdit }> {
        return this._editEventEmitter.event;
    }
    public applyEdits(resource: Uri, edits: readonly INotebookEdit[]): Thenable<void> {
        throw new Error('Method not implemented.');
    }
    public undoEdits(resource: Uri, edits: readonly INotebookEdit[]): Thenable<void> {
        throw new Error('Method not implemented.');
    }
    public resolveWebviewEditor(resource: Uri, webview: WebviewPanel): Thenable<void> {
        throw new Error('Method not implemented.');
    }
    public get editingDelegate(): WebviewCustomEditorEditingDelegate<unknown> | undefined {
        return this;
    }

    public get onDidChangeActiveNotebookEditor(): Event<INotebookEditor | undefined> {
        return this._onDidChangeActiveNotebookEditor.event;
    }

    public get onDidOpenNotebookEditor(): Event<INotebookEditor> {
        return this._onDidOpenNotebookEditor.event;
    }

    public get activeEditor(): INotebookEditor | undefined {
        const active = [...this.activeEditors.entries()].find(e => e[1].active);
        if (active) {
            return active[1];
        }
    }

    public get editors(): INotebookEditor[] {
        return [...this.activeEditors.values()];
    }

    public async open(file: Uri, contents: string): Promise<INotebookEditor> {
        // Just use a vscode.open command. It should open the file.
    }

    public async show(file: Uri): Promise<INotebookEditor | undefined> {
        // See if this file is open or not already
        const editor = this.activeEditors.get(file.fsPath);
        if (editor) {
            await editor.show();
        }
        return editor;
    }

    @captureTelemetry(Telemetry.CreateNewNotebook, undefined, false)
    public async createNew(contents?: string): Promise<INotebookEditor> {
        // Create a new URI for the dummy file using our root workspace path
        const uri = await this.getNextNewNotebookUri();
        this.notebookCount += 1;
        if (contents) {
            return this.open(uri, contents);
        } else {
            return this.open(uri, '');
        }
    }

    public async getNotebookOptions(): Promise<INotebookServerOptions> {
        return {
            enableDebugging: true,
            purpose: Identifiers.HistoryPurpose // Share the same one as the interactive window. Just need a new session
        };
    }

    private onClosedEditor(e: INotebookEditor) {
        this.activeEditors.delete(e.file.fsPath);
    }

    private onOpenedEditor(e: INotebookEditor) {
        this.activeEditors.set(e.file.fsPath, e);
        this._onDidOpenNotebookEditor.fire(e);
    }

    private onSavedEditor(oldPath: string, e: INotebookEditor) {
        // Switch our key for this editor
        if (this.activeEditors.has(oldPath)) {
            this.activeEditors.delete(oldPath);
        }
        this.activeEditors.set(e.file.fsPath, e);
    }
}
