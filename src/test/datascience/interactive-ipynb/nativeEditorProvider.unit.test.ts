// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable: no-any

import { expect } from 'chai';
import { instance, mock, when } from 'ts-mockito';
import * as typemoq from 'typemoq';
import { EventEmitter, TextEditor, Uri } from 'vscode';
import { CommandManager } from '../../../client/common/application/commandManager';
import { CustomEditorService } from '../../../client/common/application/customEditorService';
import { DocumentManager } from '../../../client/common/application/documentManager';
import { ICommandManager, ICustomEditorService, IDocumentManager, IWorkspaceService } from '../../../client/common/application/types';
import { WorkspaceService } from '../../../client/common/application/workspace';
import { AsyncDisposableRegistry } from '../../../client/common/asyncDisposableRegistry';
import { ConfigurationService } from '../../../client/common/configuration/service';
import { IConfigurationService } from '../../../client/common/types';
import { NativeEditorProvider } from '../../../client/datascience/interactive-ipynb/nativeEditorProvider';
import { INotebookEditor } from '../../../client/datascience/types';
import { ServiceContainer } from '../../../client/ioc/container';
import { IServiceContainer } from '../../../client/ioc/types';

// tslint:disable: max-func-body-length
suite('Data Science - Native Editor Provider', () => {
    let workspace: IWorkspaceService;
    let configService: IConfigurationService;
    let docManager: IDocumentManager;
    let cmdManager: ICommandManager;
    let svcContainer: IServiceContainer;
    let changeActiveTextEditorEventEmitter: EventEmitter<TextEditor>;
    let editor: typemoq.IMock<INotebookEditor>;
    let customEditorService: ICustomEditorService;
    let file: Uri;

    setup(() => {
        svcContainer = mock(ServiceContainer);
        configService = mock(ConfigurationService);
        docManager = mock(DocumentManager);
        cmdManager = mock(CommandManager);
        workspace = mock(WorkspaceService);
        changeActiveTextEditorEventEmitter = new EventEmitter<TextEditor>();
        customEditorService = mock(CustomEditorService);
    });

    function createNotebookProvider(shouldOpenNotebookEditor: boolean) {
        editor = typemoq.Mock.ofType<INotebookEditor>();
        when(configService.getSettings()).thenReturn({ datascience: { useNotebookEditor: true } } as any);
        when(docManager.onDidChangeActiveTextEditor).thenReturn(changeActiveTextEditorEventEmitter.event);
        when(docManager.visibleTextEditors).thenReturn([]);
        editor.setup(e => e.closed).returns(() => new EventEmitter<INotebookEditor>().event);
        editor.setup(e => e.executed).returns(() => new EventEmitter<INotebookEditor>().event);
        editor.setup(e => (e as any).then).returns(() => undefined);
        when(svcContainer.get<INotebookEditor>(INotebookEditor)).thenReturn(editor.object);

        // Ensure the editor is created and the load and show methods are invoked.
        const invocationCount = shouldOpenNotebookEditor ? 1 : 0;
        editor
            .setup(e => e.load(typemoq.It.isAny(), typemoq.It.isAny()))
            .returns((_a1: string, f: Uri) => {
                file = f;
                return Promise.resolve();
            })
            .verifiable(typemoq.Times.exactly(invocationCount));
        editor
            .setup(e => e.show())
            .returns(() => Promise.resolve())
            .verifiable(typemoq.Times.exactly(invocationCount));
        editor.setup(e => e.file).returns(() => file);

        return new NativeEditorProvider(
            instance(svcContainer),
            instance(mock(AsyncDisposableRegistry)),
            [],
            instance(workspace),
            instance(configService),
            instance(customEditorService)
        );
    }

    test('Multiple new notebooks have new names', async () => {
        const provider = createNotebookProvider(false);
        const n1 = await provider.createNew();
        expect(n1.file.fsPath).to.be.include('Untitled-1');
        const n2 = await provider.createNew();
        expect(n2.file.fsPath).to.be.include('Untitled-2');
    });
});
