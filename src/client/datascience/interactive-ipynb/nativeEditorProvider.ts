// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { Event, EventEmitter, TextDocument, TextEditor, Uri, WebviewCustomEditorProvider } from 'vscode';

import { ICommandManager, ICustomEditorService, IDocumentManager, IWorkspaceService } from '../../common/application/types';
import { JUPYTER_LANGUAGE } from '../../common/constants';
import { IFileSystem } from '../../common/platform/types';
import { IAsyncDisposable, IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { IServiceContainer } from '../../ioc/types';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Identifiers, Settings, Telemetry } from '../constants';
import { IDataScienceErrorHandler, INotebookEditor, INotebookEditorProvider, INotebookServerOptions } from '../types';
import { CustomNativeEditorProvider } from './customNativeEditorProvider';
import { HackyNativeEditorProvider } from './hackyNativeEditorProvider';

@injectable()
export class NativeEditorProvider implements INotebookEditorProvider, IAsyncDisposable {
    private executedEditors: Set<string> = new Set<string>();
    private notebookCount: number = 0;
    private openedNotebookCount: number = 0;
    private realProvider: INotebookEditorProvider;
    constructor(
        @inject(IServiceContainer) serviceContainer: IServiceContainer,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IWorkspaceService) workspace: IWorkspaceService,
        @inject(IConfigurationService) private configuration: IConfigurationService,
        @inject(IFileSystem) fileSystem: IFileSystem,
        @inject(IDocumentManager) documentManager: IDocumentManager,
        @inject(ICommandManager) cmdManager: ICommandManager,
        @inject(IDataScienceErrorHandler) dataScienceErrorHandler: IDataScienceErrorHandler,
        @inject(ICustomEditorService) customEditorService: ICustomEditorService
    ) {
        asyncRegistry.push(this);

        // Look through the file system for ipynb files to see how many we have in the workspace. Don't wait
        // on this though.
        const findFilesPromise = workspace.findFiles('**/*.ipynb');
        if (findFilesPromise && findFilesPromise.then) {
            findFilesPromise.then(r => (this.notebookCount += r.length));
        }

        if (customEditorService.supportsCustomEditors) {
            this.realProvider = new CustomNativeEditorProvider(
                serviceContainer,
                asyncRegistry,
                disposables,
                workspace,
                configuration,
                fileSystem,
                documentManager,
                cmdManager,
                dataScienceErrorHandler,
                customEditorService
            );
        } else {
            this.realProvider = new HackyNativeEditorProvider(
                serviceContainer,
                disposables,
                workspace,
                configuration,
                fileSystem,
                documentManager,
                cmdManager,
                dataScienceErrorHandler
            );
        }

        // When opening keep track of execution for our telemetry
        this.realProvider.onDidOpenNotebookEditor(this.openedEditor.bind(this));
    }

    public get onDidChangeActiveNotebookEditor(): Event<INotebookEditor | undefined> {
        return this.realProvider.onDidChangeActiveNotebookEditor;
    }
    public get onDidOpenNotebookEditor(): Event<INotebookEditor> {
        return this.realProvider.onDidOpenNotebookEditor;
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
        return this.realProvider.activeEditor;
    }

    public get editors(): INotebookEditor[] {
        return this.realProvider.editors;
    }

    public async open(file: Uri, contents: string): Promise<INotebookEditor> {
        return this.realProvider.open(file, contents);
    }

    public async show(file: Uri): Promise<INotebookEditor | undefined> {
        return this.realProvider.show(file);
    }

    @captureTelemetry(Telemetry.CreateNewNotebook, undefined, false)
    public async createNew(contents?: string): Promise<INotebookEditor> {
        return this.realProvider.createNew(contents);
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

    private openedEditor(editor: INotebookEditor): void {
        this.openedNotebookCount += 1;
        if (!this.executedEditors.has(editor.file.fsPath)) {
            editor.executed(this.onExecuted.bind(this));
        }
    }

    private onExecuted(editor: INotebookEditor): void {
        if (editor) {
            this.executedEditors.add(editor.file.fsPath);
        }
    }
}
