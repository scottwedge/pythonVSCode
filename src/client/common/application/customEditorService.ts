// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';

import { ICommandManager, ICustomEditorService } from './types';

@injectable()
export class CustomEditorService implements ICustomEditorService {
    constructor(@inject(ICommandManager) private commandManager: ICommandManager) {}

    public get supportsCustomEditors(): boolean {
        try {
            return vscode.window.registerWebviewCustomEditorProvider !== undefined;
        } catch {
            return false;
        }
    }

    public registerWebviewCustomEditorProvider(viewType: string, provider: vscode.WebviewCustomEditorProvider, options?: vscode.WebviewPanelOptions): vscode.Disposable {
        return vscode.window.registerWebviewCustomEditorProvider(viewType, provider, options);
    }

    public async openEditor(file: vscode.Uri): Promise<void> {
        await this.commandManager.executeCommand('vscode.open', file);
    }
}
